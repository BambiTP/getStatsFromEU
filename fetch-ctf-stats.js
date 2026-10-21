#!/usr/bin/env node
// fetch-ctf-stats.js - CTF stats for a set of tagpro.eu matches, every stat in STAT_DEFINITIONS.md
// that can be worked out from a match file.
//
// Two ways to get the matches:
//   bulk  read tagpro.eu bulk files: the local mirror (~/tagpro.eu) by default, any bulk file or
//         folder with --bulk, or downloaded from tagpro.eu's bulk endpoint with --download
//   site  download each match on its own from https://tagpro.eu/data/?match=<id>, one at a time
//
// Which matches: any mix of single ids, ranges and lists, e.g.
//   node fetch-ctf-stats.js site 3934654-3934661
//   node fetch-ctf-stats.js bulk 3934654,3934660,3934700
//   node fetch-ctf-stats.js bulk 3934654-3934661,3934700,3935000-3935010
//   node fetch-ctf-stats.js site --ids ids.txt        (ids, ranges or tagpro.eu links, any separators)
//
// Options:
//   --out FILE        per player per match rows (.csv or .json)       default ctf_stats.csv
//   --totals FILE     one row per player over all the matches, with rates and GASP/NISH (.csv or .json)
//   --all-modes       keep non-CTF matches (Marsball, gravity, ...) instead of skipping them
//   --maps FILE       tagpro.eu bulk maps file (bulk mode)               default ~/tagpro.eu/maps.json
//   --bulk PATH       bulk file, or folder of bulk files (bulk mode)     default ~/tagpro.eu
//   --download        bulk mode: fetch the id range from tagpro.eu's bulk endpoint into --cache first
//   --cache DIR       where downloads are kept and reused               default ./cache
//   --delay MS        wait between tagpro.eu requests                    default 2000
//
// Thresholds for the timeline stats are NALTP's (naltp/derived_stats.py); change them below.

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const decoder = require('./decoder.js');

const FPS = 60;
const LONG_HOLD = 20 * FPS;       // a hold this long or longer (matches the league's numbers)
const FLACCID = 2 * FPS;          // a grab lost sooner than this
const HANDOFF = 2 * FPS;          // a teammate picks the flag up sooner than this after the hold ended
const HANDOFF_HOLD = 3 * FPS;     // ...off a hold shorter than this
const GOOD_HOLD = 5 * FPS;        // ...and holds it longer than this: a good handoff
const QUICK = 2 * FPS;            // a return of a hold shorter than this
const KEY = 3 * FPS;              // the last return before a cap, if it came less than this before
const NEAR = 6 * 40;              // six tiles, in pixels: return in base / save radius
const MATCH_TOL = 2;              // frames allowed between a return and the splat or drop it caused

// GASP (TagPro League) weights; NISH uses the same ones with the totals made per minute
const GASP_O = [['cpm', 2], ['score_pct', 2], ['captures', 5], ['hold', 4]];
const GASP_D = [['rpm', 2], ['kd', 1], ['nrtpm', 2], ['returns', 4], ['prevent', 4]];
const NISH_PER_MINUTE = { captures: 'cpm', hold: 'hold_pm', returns: 'rpm', prevent: 'prevent_pm' };
const GASP_MIN_MINUTES = 10;
const NISH_MIN_MINUTES = 30;

const URL = 'https://tagpro.eu/data/';
const UA = 'bambitp-ctf-stats/1.0 (one request at a time; see https://tagpro.eu/?science)';
const MIRROR = path.join(os.homedir(), 'tagpro.eu');

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opt = { mode: argv[0], specs: [], out: 'ctf_stats.csv', totals: null, allModes: false,
    maps: path.join(MIRROR, 'maps.json'), bulk: MIRROR, download: false, cache: 'cache', delay: 2000 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) die(`${a} needs a value`); return argv[++i]; };
    if (a === '--ids') opt.specs.push(fs.readFileSync(next(), 'utf8'));
    else if (a === '--out') opt.out = next();
    else if (a === '--totals') opt.totals = next();
    else if (a === '--all-modes') opt.allModes = true;
    else if (a === '--maps') opt.maps = next();
    else if (a === '--bulk') opt.bulk = next();
    else if (a === '--download') opt.download = true;
    else if (a === '--cache') opt.cache = next();
    else if (a === '--delay') opt.delay = Number(next());
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else opt.specs.push(a);
  }
  if (!['bulk', 'site'].includes(opt.mode)) die('first argument must be "bulk" or "site"');
  return opt;
}

// "100-200, 305 ?match=400" -> sorted unique ids. Links count as their match id.
function parseIds(specs) {
  const ids = new Set();
  for (const spec of specs) {
    const text = spec.replace(/[?&]match=/g, ' ');
    for (const tok of text.split(/[\s,;]+/)) {
      const range = tok.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        let [a, b] = [Number(range[1]), Number(range[2])];
        if (a > b) [a, b] = [b, a];
        if (b - a > 5e6) die(`range ${tok} is too big`);
        for (let i = a; i <= b; i++) ids.add(i);
      } else if (/^\d+$/.test(tok)) ids.add(Number(tok));
      else if (tok) {
        const id = tok.match(/(\d{3,})/);
        if (id) ids.add(Number(id[1]));
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function die(msg) { console.error(msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- tagpro.eu requests

let lastRequest = 0;
async function request(query) {
  const wait = lastRequest + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(`${URL}?${query}`, { headers: { 'User-Agent': UA } });
  lastRequest = Date.now();
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`tagpro.eu answered ${res.status} for ?${query}; stopping instead of retrying`);
  }
  return res;
}
let delayMs = 2000;

// ---------------------------------------------------------------- bulk files

// Streams one bulk file ({"id": {match}, "id": {match}, ...}, plain or gzipped) and yields
// [id, match] for the wanted ids only. Only the wanted matches are ever parsed, so a 125,000
// match file does not have to fit in memory. Ids in a bulk file run in order, so reading stops
// once it is past the last wanted id.
async function* scanBulk(file, wanted, maxId) {
  const src = fs.createReadStream(file);
  const stream = file.endsWith('.gz') ? src.pipe(zlib.createGunzip()) : src;
  let depth = 0, inStr = false, esc = false;
  let key = null, readingKey = false, keyChars = '';
  let parts = null, from = 0;
  try {
    for await (const chunk of stream) {
      if (parts) from = 0;
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === 92) esc = true;                       // backslash
          else if (c === 34) {                                 // closing quote
            inStr = false;
            if (readingKey) {
              readingKey = false;
              key = keyChars;
              if (/^\d+$/.test(key) && Number(key) > maxId) return;
            }
          } else if (readingKey) keyChars += String.fromCharCode(c);
          continue;
        }
        if (c === 34) {
          inStr = true;
          if (depth === 1) { readingKey = true; keyChars = ''; }
        } else if (c === 123) {                                // {
          depth++;
          if (depth === 2 && wanted.has(Number(key))) { parts = []; from = i; }
        } else if (c === 125) {                                // }
          depth--;
          if (depth === 1 && parts) {
            parts.push(chunk.subarray(from, i + 1));
            const match = JSON.parse(Buffer.concat(parts).toString('utf8'));
            parts = null;
            yield [Number(key), match];
          }
        }
      }
      if (parts) parts.push(chunk.subarray(from));
    }
  } finally {
    src.destroy();
    stream.destroy();
  }
}

// the bulk files that cover any of the ids, from a mirror's manifest.json or from file names
// like matches_00000000_00124999.json.gz / bulk_4174512_4244514.json
function bulkFiles(where, ids) {
  const covers = (f) => ids.some((i) => f.first <= i && i <= f.last);
  if (fs.statSync(where).isFile()) return [where];
  const manifest = path.join(where, 'manifest.json');
  let files;
  if (fs.existsSync(manifest)) {
    files = JSON.parse(fs.readFileSync(manifest, 'utf8')).files
      .map((f) => ({ file: path.join(where, f.file), first: f.first, last: f.last }));
  } else {
    files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        const m = e.name.match(/_(\d+)_(\d+)\.json(\.gz)?$/);
        if (m) files.push({ file: p, first: Number(m[1]), last: Number(m[2]) });
      }
    };
    walk(where);
  }
  // smaller files first: the mirror's own range files before the big copies from ~/nte
  return files.filter((f) => covers(f) && fs.existsSync(f.file))
    .sort((a, b) => (a.last - a.first) - (b.last - b.first)).map((f) => f.file);
}

// tagpro.eu's bulk endpoint, in pieces of at most 100,000 ids, saved gzipped under the cache
async function downloadBulk(ids, cache) {
  fs.mkdirSync(cache, { recursive: true });
  const out = [];
  const first = ids[0], last = ids[ids.length - 1];
  for (let a = first; a <= last; a += 100000) {
    const b = Math.min(a + 99999, last);
    if (!ids.some((i) => a <= i && i <= b)) continue;
    const file = path.join(cache, `bulk_${a}_${b}.json.gz`);
    if (!fs.existsSync(file)) {
      console.error(`downloading bulk matches ${a}-${b} from tagpro.eu ...`);
      const res = await request(`bulk=matches&first=${a}&last=${b}`);
      if (!res.ok) throw new Error(`bulk download ${a}-${b} failed: HTTP ${res.status}`);
      await pipeline(res.body, zlib.createGzip(), fs.createWriteStream(file + '.part'));
      fs.renameSync(file + '.part', file);
    }
    out.push(file);
  }
  return out;
}

async function loadMaps(opt) {
  if (fs.existsSync(opt.maps)) return JSON.parse(fs.readFileSync(opt.maps, 'utf8'));
  if (!opt.download) die(`no maps file at ${opt.maps}; pass --maps FILE or --download`);
  const file = path.join(opt.cache, 'maps.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(opt.cache, { recursive: true });
    console.error('downloading bulk maps from tagpro.eu ...');
    const res = await request('bulk=maps');
    if (!res.ok) throw new Error(`maps download failed: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function* fromBulk(opt, ids) {
  const maps = await loadMaps(opt);
  const files = opt.download ? await downloadBulk(ids, opt.cache) : bulkFiles(opt.bulk, ids);
  if (!files.length) die(`no bulk file under ${opt.bulk} covers those ids (try --download)`);
  const want = new Set(ids), maxId = ids[ids.length - 1];
  for (const file of files) {
    if (!want.size) break;
    console.error(`reading ${file}`);
    for await (const [id, raw] of scanBulk(file, want, maxId)) {
      want.delete(id);
      if (raw && raw.players) yield [id, raw, maps];
      if (!want.size) break;
    }
  }
  if (want.size) console.error(`${want.size} of the ids were not in the bulk files (no such match, or not mirrored)`);
}

// ---------------------------------------------------------------- one match at a time

async function* fromSite(opt, ids) {
  const dir = path.join(opt.cache, 'matches');
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const id of ids) {
    n++;
    const file = path.join(dir, `${id}.json`);
    let text;
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
    else {
      const res = await request(`match=${id}`);
      text = res.ok ? await res.text() : '';
      let ok = false;
      try { ok = !!JSON.parse(text)?.players; } catch { /* not a match */ }
      if (!ok) { console.error(`  ${id}: no match (HTTP ${res.status})`); continue; }
      fs.writeFileSync(file, text);
    }
    if (n % 25 === 0) console.error(`  ${n} of ${ids.length}`);
    yield [id, JSON.parse(text), null];
  }
}

// ---------------------------------------------------------------- stats for one match

// where each flag stands, in pixels (tile 30 = red flag, 40 = blue flag in the decoded map)
function flagStands(tiles) {
  const out = {};
  if (!Array.isArray(tiles)) return out;
  tiles.forEach((row, y) => row.forEach((v, x) => {
    if (v === 30) out[1] = [(x + 0.5) * 40, (y + 0.5) * 40];
    if (v === 40) out[2] = [(x + 0.5) * 40, (y + 0.5) * 40];
  }));
  return out;
}

function isCtf(m) {
  if (m.map && m.map.type) return m.map.type === 'ctf';
  const s = flagStands(m.map && m.map.tiles);
  return !!(s[1] && s[2]);
}

function matchStats(id, raw, maps) {
  const m = decoder.processMatch(raw, maps, { gameinfo: true, map: true, players: true, team: true, splats: true });
  const duration = m.duration;
  const limit = (m.timeLimit || 0) * 60 * FPS;
  const ps = m.players.map((p, idx) => ({
    idx, name: p.name, auth: !!p.auth, euScore: p.score ?? 0, euPoints: p.points ?? 0,
    tags: 0, pops: 0, grabs: 0, drops: 0, captures: 0, returns: 0,
    hold: 0, prevent: 0, button: 0, block: 0,
    pups: 0, jj: 0, rb: 0, tp: 0, ts: 0,
    lh: 0, flcds: 0, ho: 0, gho: 0, goh: 0, gor: 0, coh: 0, cor: 0, otcaps: 0, qr: 0, kr: 0, rib: 0, saves: 0,
    teamTime: { 1: 0, 2: 0 }, intervals: [],
  }));

  const holds = [], returns = [], popsByTeam = { 1: [], 2: [] };
  m.players.forEach((p, idx) => {
    const s = ps[idx];
    let team = p.team || 0, since = team ? 0 : -1, hold = null;
    const open = { prevent: -1, button: -1, block: -1 };
    const leave = (t) => {
      if (since >= 0 && team) { s.teamTime[team] += t - since; s.intervals.push({ team, start: since, end: t }); }
      since = -1;
      if (hold) { hold.end = t; hold.how = 'end'; holds.push(hold); s.hold += t - hold.start; hold = null; }
    };
    const endHold = (t, how) => {
      if (!hold) return;
      hold.end = t; hold.how = how; holds.push(hold); s.hold += t - hold.start; hold = null;
    };
    for (const e of p.events) {
      const t = e.time;
      switch (e.type) {
        case 'join': team = e.team; since = t; break;
        case 'switch': leave(t); team = e.team; since = t; break;
        case 'quit': leave(t); team = 0; break;
        case 'end': leave(t); break;
        case 'grab': s.grabs++; hold = { player: idx, side: e.team, start: t }; break;
        case 'capture': s.captures++; endHold(t, 'cap'); break;
        case 'flaglessCapture': s.captures++; break;
        case 'drop': s.drops++; s.pops++; endHold(t, 'drop'); popsByTeam[e.team]?.push({ time: t, player: idx }); break;
        case 'pop': s.pops++; endHold(t, 'pop'); popsByTeam[e.team]?.push({ time: t, player: idx }); break;
        case 'return': s.returns++; s.tags++; returns.push({ time: t, player: idx, side: e.team }); break;
        case 'tag': s.tags++; break;
        case 'powerup':
          s.pups++;
          if (e.power === 1) s.jj++; else if (e.power === 2) s.rb++; else if (e.power === 4) s.tp++; else if (e.power === 8) s.ts++;
          break;
        case 'duplicatePowerup': s.pups++; break;
        case 'startPrevent': open.prevent = t; break;
        case 'startButton': open.button = t; break;
        case 'startBlock': open.block = t; break;
        case 'stopPrevent': case 'stopButton': case 'stopBlock': {
          const k = e.type.slice(4).toLowerCase();
          if (open[k] >= 0) { s[k] += t - open[k]; open[k] = -1; }
          break;
        }
      }
    }
    for (const k of Object.keys(open)) if (open[k] >= 0) s[k] += duration - open[k];
  });

  // how each possession began: picked straight back up by the same side after a short hold by
  // someone else is a handoff, any other quick pick-up is a regrab
  holds.sort((a, b) => a.start - b.start);
  const last = {};
  for (const h of holds) {
    const prev = last[h.side];
    h.from = '';
    if (prev && prev.how !== 'cap' && h.start - prev.end >= 0 && h.start - prev.end < HANDOFF) {
      if (prev.end - prev.start < HANDOFF_HOLD && prev.player !== h.player) { h.from = 'handoff'; h.giver = prev.player; }
      else h.from = 'regrab';
    }
    last[h.side] = h;
  }
  for (const h of holds) {
    const s = ps[h.player], span = h.end - h.start;
    if (span >= LONG_HOLD) s.lh++;
    if (span < FLACCID) s.flcds++;
    if (h.from === 'handoff') s.goh++;
    if (h.from === 'regrab') s.gor++;
    if (h.how === 'cap') {
      if (h.from === 'handoff') s.coh++;
      if (h.from === 'regrab') s.cor++;
      if (limit && h.end > limit) s.otcaps++;
    }
    if (h.giver !== undefined) { ps[h.giver].ho++; if (span > GOOD_HOLD) ps[h.giver].gho++; }
  }

  // splats: each team's splat list is in the order of that team's pops (drops included)
  const splats = [];
  (m.teams || []).forEach((team, ti) => {
    const side = ti + 1;
    const order = popsByTeam[side].slice().sort((a, b) => a.time - b.time);
    let k = 0;
    for (const group of team.splats || []) {
      for (const sp of group.splats) {
        const pop = order[k++];
        if (pop) splats.push({ time: pop.time, side, x: sp.x, y: sp.y });
      }
    }
  });

  const stands = flagStands(m.map && m.map.tiles);
  const capsBySide = { 1: [], 2: [] };
  for (const h of holds) if (h.how === 'cap' && capsBySide[h.side]) capsBySide[h.side].push(h.end);
  // key return: each cap credits the team's last return before it, if that came less than KEY before
  for (const side of [1, 2]) for (const c of capsBySide[side]) {
    let last = null;
    for (const r of returns) if (r.side === side && r.time <= c && (!last || r.time >= last.time)) last = r;
    if (last && c - last.time < KEY) ps[last.player].kr++;
  }
  for (const r of returns) {
    const s = ps[r.player], mine = r.side, theirs = 3 - mine;
    const stopped = holds.find((h) => h.side !== mine && Math.abs(h.end - r.time) <= MATCH_TOL && (h.how === 'drop' || h.how === 'pop'));
    if (stopped && stopped.end - stopped.start < QUICK) s.qr++;
    const at = splats.find((sp) => sp.side === theirs && Math.abs(sp.time - r.time) <= MATCH_TOL);
    if (at) {
      const near = (p) => p && (at.x - p[0]) ** 2 + (at.y - p[1]) ** 2 <= NEAR ** 2;
      if (near(stands[mine])) s.rib++;
      const holding = holds.some((h) => h.side === mine && h.start <= r.time && r.time <= h.end);
      if (!holding && near(stands[theirs])) s.saves++;
    }
  }

  const teamScore = { 1: m.teams?.[0]?.score ?? 0, 2: m.teams?.[1]?.score ?? 0 };
  const totalPups = ps.reduce((n, s) => n + s.pups, 0);
  const rows = ps.map((s) => {
    const team = s.teamTime[1] >= s.teamTime[2] ? (s.teamTime[1] ? 1 : 0) : 2;
    // enemy hold while this player was on the field
    let ha = 0;
    for (const h of holds) for (const iv of s.intervals) {
      if (iv.team === h.side) continue;
      ha += Math.max(0, Math.min(h.end, iv.end) - Math.max(h.start, iv.start));
    }
    const minutes = (s.teamTime[1] + s.teamTime[2]) / FPS / 60;
    const capsFor = team ? teamScore[team] : 0, capsAgainst = team ? teamScore[3 - team] : 0;
    return {
      match_id: id, date: m.date ? new Date(m.date * 1000).toISOString().slice(0, 10) : '',
      map: m.map?.name ?? '', official: m.official ? 1 : 0, group: m.group ? 1 : 0,
      player: s.name, auth: s.auth ? 1 : 0, team: team === 1 ? 'red' : team === 2 ? 'blue' : '',
      result: !team ? '' : capsFor > capsAgainst ? 'W' : capsFor < capsAgainst ? 'L' : 'T',
      caps_for: capsFor, caps_against: capsAgainst, cap_diff: capsFor - capsAgainst,
      minutes: round(minutes),
      tags: s.tags, pops: s.pops, grabs: s.grabs, drops: s.drops, captures: s.captures, returns: s.returns,
      hold: round(s.hold / FPS), prevent: round(s.prevent / FPS), button: round(s.button / FPS), block: round(s.block / FPS),
      pups: s.pups, juke_juice: s.jj, rolling_bomb: s.rb, tagpro: s.tp, top_speed: s.ts, pups_available: totalPups,
      long_holds: s.lh, flaccids: s.flcds, handoffs: s.ho, good_handoffs: s.gho,
      grabs_off_handoffs: s.goh, grabs_off_regrabs: s.gor,
      caps_off_handoffs: s.coh, caps_off_regrabs: s.cor, ot_caps: s.otcaps,
      quick_returns: s.qr, key_returns: s.kr, returns_in_base: s.rib, saves: s.saves,
      nr_tags: Math.max(0, s.tags - s.returns), nd_pops: Math.max(0, s.pops - s.drops),
      kept_flags: s.grabs - s.drops - s.captures, hold_against: round(ha / FPS),
      eu_score: s.euScore, eu_points: s.euPoints,
    };
  });
  for (const r of rows) Object.assign(r, rates(r));
  scoreboard(rows, duration / FPS / 60);
  return rows;
}

const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : 0);
const div = (a, b) => (b ? a / b : 0);

// the ratio and per-minute stats, from a row of totals (one match or many)
function rates(r) {
  const pm = (k) => round(div(r[k], r.minutes));
  return {
    score_pct: round(div(r.captures, r.grabs) * 100), kd: round(div(r.tags, r.pops)),
    hold_per_grab: round(div(r.hold, r.grabs)), prevent_per_return: round(div(r.prevent, r.returns)),
    prevent_per_hold_against: round(div(r.prevent, r.hold_against)),
    pup_pct: round(div(r.pups, r.pups_available) * 100),
    flaccid_pct: round(div(r.flaccids, r.grabs) * 100), chain_pct: round(div(r.good_handoffs, r.handoffs) * 100),
    spark_pct: round(div(r.captures - r.caps_off_handoffs - r.caps_off_regrabs, r.captures) * 100),
    qr_pct: round(div(r.quick_returns, r.returns) * 100), rib_pct: round(div(r.returns_in_base, r.returns) * 100),
    support: Math.floor(r.button / 5) + Math.floor(r.block / 5) * 2,
    cpm: pm('captures'), gpm: pm('grabs'), rpm: pm('returns'), tpm: pm('tags'), ppm: pm('pops'),
    dpm: pm('drops'), pupm: pm('pups'), hold_pm: pm('hold'), prevent_pm: pm('prevent'), nrtpm: pm('nr_tags'),
    hold_against_pm: pm('hold_against'), cd_pm: pm('cap_diff'),
  };
}

// the in-game scoreboard score (IPMv1.1, as tagpro-local copies it from the real client): each
// stat compared with the other eligible players in the same match, weighted, rescaled to 50 +- 20
function scoreboard(rows, gameMinutes) {
  const elig = rows.filter((r) => r.team && r.minutes >= 0.5 && div(r.minutes, gameMinutes) >= 0.15);
  for (const r of rows) r.score = r.oscore = r.dscore = '';
  if (!elig.length) return;
  const stat = {
    captures: (r) => div(r.captures, r.minutes), hold: (r) => div(r.hold, r.minutes),
    prevent: (r) => div(r.prevent, r.minutes), returns: (r) => div(r.returns, r.minutes),
    nonReturnTags: (r) => div(r.tags - r.returns, r.minutes),
    scorePercent: (r) => div(r.captures, r.grabs), kd: (r) => div(r.tags, r.pops),
  };
  const meanSd = (xs) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { mean, sd: Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length) };
  };
  const vals = {}, dist = {};
  for (const k in stat) { vals[k] = elig.map(stat[k]); dist[k] = meanSd(vals[k]); }
  const side = (w, i) => Object.entries(w).reduce((a, [k, wt]) => {
    const { mean, sd } = dist[k];
    const z = sd > 0 ? ((vals[k][i] - mean) / sd) * wt : 0;
    return a + (Number.isFinite(z) ? z : 0);
  }, 0);
  const o = elig.map((_, i) => side({ captures: 20, hold: 38, scorePercent: 42 }, i));
  const d = elig.map((_, i) => side({ kd: 18, returns: 34, prevent: 40, nonReturnTags: 8 }, i));
  const t = o.map((x, i) => (x > d[i] ? x * 2 / 3 + d[i] / 3 : d[i] > x ? x / 3 + d[i] * 2 / 3 : (x + d[i]) / 2));
  const scale = (xs) => {
    const { mean, sd } = meanSd(xs);
    return xs.map((x) => { const v = ((x - mean) / sd) * 20 + 50; return Number.isFinite(v) ? Math.round(v) : 50; });
  };
  const so = scale(o), sd = scale(d), st = scale(t);
  elig.forEach((r, i) => { r.score = st[i]; r.oscore = so[i]; r.dscore = sd[i]; });
}

// ---------------------------------------------------------------- totals, GASP and NISH

const SUMS = ['minutes', 'caps_for', 'caps_against', 'cap_diff', 'tags', 'pops', 'grabs', 'drops', 'captures',
  'returns', 'hold', 'prevent', 'button', 'block', 'pups', 'juke_juice', 'rolling_bomb', 'tagpro', 'top_speed',
  'pups_available', 'long_holds', 'flaccids', 'handoffs', 'good_handoffs', 'grabs_off_handoffs', 'grabs_off_regrabs', 'caps_off_handoffs', 'caps_off_regrabs',
  'ot_caps', 'quick_returns', 'key_returns', 'returns_in_base', 'saves', 'nr_tags', 'nd_pops', 'kept_flags', 'hold_against', 'eu_score', 'eu_points'];

function totals(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.player.toLowerCase();
    if (!by.has(k)) by.set(k, { player: r.player, games: 0, wins: 0, losses: 0, ties: 0, ...Object.fromEntries(SUMS.map((s) => [s, 0])), _score: [] });
    const t = by.get(k);
    t.games++;
    if (r.result === 'W') t.wins++; else if (r.result === 'L') t.losses++; else if (r.result === 'T') t.ties++;
    for (const s of SUMS) t[s] += r[s];
    if (r.score !== '') t._score.push(r.score);
  }
  const out = [...by.values()].map((t) => {
    for (const s of SUMS) t[s] = round(t[s]);
    const avg = t._score.length ? round(t._score.reduce((a, b) => a + b, 0) / t._score.length, 1) : '';
    delete t._score;
    return { ...t, win_pct: round(div(t.wins, t.wins + t.losses + t.ties) * 100), avg_score: avg, ...rates(t) };
  });
  gaspNish(out);
  return out.sort((a, b) => b.minutes - a.minutes);
}

// reconstructions over the players in this output, not tagproleague.com's published numbers
function gaspNish(rows) {
  const standardise = (pool, keys) => {
    const z = pool.map(() => ({}));
    for (const k of keys) {
      const col = pool.map((r) => r[k]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      const sd = Math.sqrt(col.reduce((a, x) => a + (x - mean) ** 2, 0) / col.length);
      col.forEach((v, i) => { z[i][k] = sd ? (v - mean) / sd : 0; });
    }
    return z;
  };
  const pctRank = (values) => {
    const order = values.slice().sort((a, b) => a - b), at = new Map();
    order.forEach((v, i) => at.set(v, i + 1));
    return values.map((v) => at.get(v) / values.length);
  };
  for (const r of rows) Object.assign(r, { gasp_o: '', gasp_d: '', gasp_t: '', nish: '' });

  const g = rows.filter((r) => r.minutes >= GASP_MIN_MINUTES);
  if (g.length > 1) {
    const keys = [...GASP_O, ...GASP_D].map(([k]) => k);
    const z = standardise(g, keys);
    const sum = (zi, w) => w.reduce((a, [k, wt]) => a + wt * zi[k], 0);
    const o = z.map((zi) => sum(zi, GASP_O)), d = z.map((zi) => sum(zi, GASP_D)), t = o.map((x, i) => x + d[i]);
    const [po, pd, pt] = [pctRank(o), pctRank(d), pctRank(t)];
    g.forEach((r, i) => { r.gasp_o = round(po[i] * 10); r.gasp_d = round(pd[i] * 10); r.gasp_t = round(pt[i] * 10); });
  }

  const n = rows.filter((r) => r.minutes >= NISH_MIN_MINUTES);
  if (n.length > 1) {
    const w = [...GASP_O, ...GASP_D].map(([k, wt]) => [NISH_PER_MINUTE[k] || k, wt]);
    const z = standardise(n, [...new Set(w.map(([k]) => k))]);
    const raw = z.map((zi) => w.reduce((a, [k, wt]) => a + wt * zi[k], 0));
    const hi = Math.max(...raw), lo = Math.min(...raw);
    n.forEach((r, i) => { r.nish = round(hi > lo ? ((raw[i] - lo) / (hi - lo)) * 100 : 100, 1); });
  }
}

// ---------------------------------------------------------------- output

function write(file, rows) {
  if (file.endsWith('.json')) { fs.writeFileSync(file, JSON.stringify(rows, null, 1)); return; }
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  fs.writeFileSync(file, [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  delayMs = opt.delay;
  const ids = parseIds(opt.specs);
  if (!ids.length) die('no match ids given');
  console.error(`${ids.length} match id(s), ${ids[0]} to ${ids[ids.length - 1]}, from ${opt.mode === 'site' ? 'tagpro.eu one at a time' : 'bulk files'}`);

  const rows = [];
  let done = 0, skipped = 0, failed = 0;
  const source = opt.mode === 'site' ? fromSite(opt, ids) : fromBulk(opt, ids);
  for await (const [id, raw, maps] of source) {
    try {
      const m = raw.map || !maps ? raw : { ...raw, map: maps[raw.mapId] };
      if (!opt.allModes && !isCtf(m)) { skipped++; continue; }
      rows.push(...matchStats(id, raw, maps));
      done++;
    } catch (e) {
      failed++;
      console.error(`  ${id}: could not read (${e.message})`);
    }
  }
  write(opt.out, rows);
  console.error(`${done} CTF match(es), ${rows.length} player rows -> ${opt.out}` +
    (skipped ? `; ${skipped} non-CTF skipped` : '') + (failed ? `; ${failed} unreadable` : ''));
  if (opt.totals) {
    const t = totals(rows);
    write(opt.totals, t);
    console.error(`${t.length} players -> ${opt.totals}`);
  }
}

main().catch((e) => die(e.stack || e.message));
