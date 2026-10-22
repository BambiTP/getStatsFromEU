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
//   --all             bulk mode: every match in the bulk file(s), no ids needed
//   --no-matches      don't write the per-match file (use with --totals)
//   --aliases FILE    combine players who used several names, one player per line:
//                     "Main: alt, alt", "alt, alt -> Main" or "Main, alt, alt"; or JSON {"Main": ["alt", ...]}
//   --totals FILE     one row per player over all the matches, with rates and GASP/NISH (.csv or .json)
//   --all-modes       keep non-CTF matches (Marsball, gravity, ...) instead of skipping them
//   --maps FILE       tagpro.eu bulk maps file (bulk mode)               default ~/tagpro.eu/maps.json
//   --bulk PATH       bulk file, or folder of bulk files (bulk mode)     default ~/tagpro.eu
//   --download        bulk mode: fetch the id range from tagpro.eu's bulk endpoint into --cache first
//   --cache DIR       where downloads are kept and reused               default ./cache
//   --delay MS        wait between tagpro.eu requests                    default 2000
//   --threads N       bulk mode: work out matches on N threads           default CPU cores - 1, at most 4
//
// Timeline stats follow the TagPro League's own rules (STAT_DEFINITIONS.md section 4); thresholds below.

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const decoder = require('./decoder.js');

const FPS = 60;
// timeline thresholds, fitted to the league's own numbers (tagproleague.com, MLTP S38-S39)
const LONG_HOLD = 20 * FPS;       // a hold longer than this, not still running at the end
const FLACCID = 2 * FPS;          // a hold shorter than this that ends in a drop
const HANDOFF = 2 * FPS;          // grab off a handoff: sooner than this after...
const HANDOFF_HOLD = 3 * FPS;     // ...a teammate's hold shorter than this
const PASS = 3 * FPS;             // regrabs and handoffs given: a teammate grabs sooner than this
const REGRAB_HOLD = 5 * FPS;      // regrab: off a teammate's hold longer than this
const PASS_HOLD = 2 * FPS;        // handoff given: the teammate then holds longer than this (and drops)
const GOOD_HOLD = 5 * FPS;        // good handoff: the teammate holds longer than this
const QUICK = 2 * FPS;            // quick return: the enemy held less than this
const KEY = 3 * FPS;              // key return: the last return before a cap, less than this before it
const SPLAT_SHIFT = 40;           // the league measures from the splat moved one tile right and down
const RIB_RADIUS = 5 * 40;        // return in base: less than 5 tiles from your flag
const SAVE_RADIUS = 2 * 40;       // save: less than 2 tiles from the enemy flag...
const SAVE_LAG = FPS / 2;         // ...with no teammate holding (a hold begun this recently doesn't count)
const MATCH_TOL = 2;              // frames allowed between a return and the splat or drop it caused
// TagPro Reference (tagpro-reference.com): fitted to its per-game numbers, regulation time only
const TPR_KEY = 2 * FPS;          // key return: less than this before a teammate's cap (once per cap)
const TPR_SAVE_RADIUS = 6 * 40;   // save: the splat less than 6 tiles from the enemy flag's centre...
const TPR_SPLAT_SHIFT = 0.5;      // ...measured from the splat moved half a pixel right and down

// GASP (TagPro League) weights; NISH uses the same ones with the totals made per minute
// GASP and NISH weights, fitted to tagproleague.com's published GASP and NISH tables
const GASP_O = [['cpm', 2], ['score_pct', 2], ['captures', 5], ['hold', 4]];
const GASP_D = [['rpm', 2], ['kd', 2], ['nrtpm', 1], ['returns', 4], ['prevent', 4]];
const NISH_O = [['cpm', 4], ['hold_pm', 3], ['score_pct', 2]];
const NISH_D = [['rpm', 4], ['prevent_pm', 4], ['kd', 1]];
const NISH_T_PLUS_MINUS = 2;      // NISH T = NISH O + NISH D + this x plus-minus
const RATING_MIN_MINUTES = 10;    // one game

const URL = 'https://tagpro.eu/data/';
const UA = 'bambitp-ctf-stats/1.0 (one request at a time; see https://tagpro.eu/?science)';
const MIRROR = path.join(os.homedir(), 'tagpro.eu');

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opt = { mode: argv[0], specs: [], out: 'ctf_stats.csv', totals: null, allModes: false, aliases: null, matches: true,
    maps: path.join(MIRROR, 'maps.json'), bulk: MIRROR, download: false, cache: 'cache', delay: 2000,
    // past about 4 threads the reading and writing thread is the limit, and each thread holds the maps
    threads: Math.max(1, Math.min(4, os.availableParallelism() - 1)) };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) die(`${a} needs a value`); return argv[++i]; };
    if (a === '--ids') opt.specs.push(fs.readFileSync(next(), 'utf8'));
    else if (a === '--out') opt.out = next();
    else if (a === '--totals') opt.totals = next();
    else if (a === '--no-matches') opt.matches = false;
    else if (a === '--all') opt.all = true;
    else if (a === '--aliases') opt.aliases = next();
    else if (a === '--all-modes') opt.allModes = true;
    else if (a === '--maps') opt.maps = next();
    else if (a === '--bulk') opt.bulk = next();
    else if (a === '--download') opt.download = true;
    else if (a === '--cache') opt.cache = next();
    else if (a === '--delay') opt.delay = Number(next());
    else if (a === '--threads') opt.threads = Math.max(1, Math.floor(Number(next())) || 1);
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else opt.specs.push(a);
  }
  if (!['bulk', 'site'].includes(opt.mode)) die('first argument must be "bulk" or "site"');
  if (opt.all && opt.mode !== 'bulk') die('--all only works in bulk mode');
  if (!opt.matches && !opt.totals) die('--no-matches needs --totals, or there is nothing to write');
  return opt;
}

// players with several names -> Map(lower-cased name -> main name)
function loadAliases(file) {
  const text = fs.readFileSync(file, 'utf8');
  const groups = [];
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    if (Array.isArray(j)) for (const g of j) groups.push([g.main, ...(g.alts || [])]);
    else for (const [main, alts] of Object.entries(j)) groups.push([main, ...(alts || [])]);
  } else {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const colon = line.indexOf(':');
      const arrow = line.indexOf('->');
      let names;
      if (arrow > 0) names = [line.slice(arrow + 2), ...line.slice(0, arrow).split(',')];     // alt, alt -> Main
      else if (colon > 0) names = [line.slice(0, colon), ...line.slice(colon + 1).split(',')];  // Main: alt, alt
      else names = line.split(',');                                                          // Main, alt, alt
      groups.push(names);
    }
  }
  const map = new Map();
  for (const g of groups) {
    const names = g.map((n) => String(n ?? '').trim()).filter(Boolean);
    if (!names.length) continue;
    for (const n of names) {
      const k = n.toLowerCase();
      if (map.has(k) && map.get(k) !== names[0]) console.error(`aliases: "${n}" is listed under both "${map.get(k)}" and "${names[0]}"; using "${names[0]}"`);
      map.set(k, names[0]);
    }
  }
  return map;
}

// "100-200, 305 ?match=400" -> sorted unique ids. Links count as their match id.
function parseIds(specs) {
  const ids = new Set();
  for (const spec of specs) {
    const text = spec.replace(/[?&]match=/g, ' ');
    for (const tok of text.split(/[\s,;&#]+/)) {
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
// [id, match text] for the wanted ids only. Only the wanted matches are ever parsed, so a 125,000
// match file does not have to fit in memory. Ids in a bulk file run in order, so reading stops
// once it is past the last wanted id.
// Every match in a bulk file starts with "<id>":{"server" - a byte sequence that can't occur inside
// a JSON string (quotes there are escaped) - so the scanner jumps from one match start to the next
// with Buffer.indexOf and only parses the matches it wants.
const MATCH_START = Buffer.from('":{"server"');
async function* scanBulk(file, wanted, maxId) {
  const src = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  const stream = file.endsWith('.gz') ? src.pipe(zlib.createGunzip({ chunkSize: 1 << 20 })) : src;
  let buf = Buffer.alloc(0);
  let key = -1, open = false, body = 0;   // the current match: its id and where its { is in buf
  const keeping = () => open && (wanted === null || wanted.has(key));   // wanted null: every match
  try {
    for await (const chunk of stream) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let at = keeping() ? body + 1 : 0;
      for (;;) {
        const m = buf.indexOf(MATCH_START, at);
        if (m < 0) break;
        let k = m;
        while (k > 0 && buf[k - 1] >= 48 && buf[k - 1] <= 57) k--;
        at = m + 1;
        if (k === m || buf[k - 1] !== 34) continue;
        // the current match ends just before the comma ahead of this key
        if (keeping()) yield [key, buf.toString('utf8', body, k - 2)];
        key = Number(buf.toString('latin1', k, m));
        if (key > maxId) return;
        open = true;
        body = m + 2;
      }
      // keep the current match if it's wanted, otherwise just a tail a split match start could be in
      if (keeping()) { buf = buf.subarray(body); body = 0; }
      else buf = buf.subarray(Math.max(0, buf.length - 32));
    }
    if (keeping()) yield [key, buf.toString('utf8', body, buf.lastIndexOf(125) + 1)];
  } finally {
    src.destroy();
    stream.destroy();
  }
}

// the bulk files that cover any of the ids, from a mirror's manifest.json or from file names
// like matches_00000000_00124999.json.gz / bulk_4174512_4244514.json
function bulkFiles(where, ids) {
  const covers = (f) => ids === null || ids.some((i) => f.first <= i && i <= f.last);
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

// the maps file to use: --maps, or tagpro.eu's downloaded once into the cache
async function mapsFile(opt) {
  if (fs.existsSync(opt.maps)) return opt.maps;
  console.error(`no maps file at ${opt.maps}; getting tagpro.eu's maps file once (kept in ${opt.cache})`);
  const file = path.join(opt.cache, 'maps.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(opt.cache, { recursive: true });
    console.error('downloading bulk maps from tagpro.eu ...');
    const res = await request('bulk=maps');
    if (!res.ok) throw new Error(`maps download failed: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return file;
}

async function* fromBulk(opt, ids) {
  if (opt.all) {                                   // every match in the bulk file(s)
    for (const file of bulkFiles(opt.bulk, null)) {
      console.error(`reading ${file}`);
      yield* scanBulk(file, null, Infinity);
    }
    return;
  }
  const files = opt.download ? await downloadBulk(ids, opt.cache) : bulkFiles(opt.bulk, ids);
  if (!files.length) die(`no bulk file under ${opt.bulk} covers those ids (try --download)`);
  const want = new Set(ids), maxId = ids[ids.length - 1];
  for (const file of files) {
    if (!want.size) break;
    console.error(`reading ${file}`);
    for await (const [id, text] of scanBulk(file, want, maxId)) {
      want.delete(id);
      yield [id, text];
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
    yield [id, text];
  }
}

// ---------------------------------------------------------------- stats for one match

// where each flag stands, in pixels (tile 30 = red flag, 40 = blue flag in the decoded map)
const standsCache = new WeakMap();
function flagStands(tiles) {
  if (!Array.isArray(tiles)) return {};
  const cached = standsCache.get(tiles);
  if (cached) return cached;
  const out = {};
  standsCache.set(tiles, out);
  tiles.forEach((row, y) => row.forEach((v, x) => {
    if (v === 30) out[1] = [(x + 0.5) * 40, (y + 0.5) * 40];
    if (v === 40) out[2] = [(x + 0.5) * 40, (y + 0.5) * 40];
  }));
  return out;
}

// tagpro.eu's map "type" is mostly a label (ctf, -, b18, p16, ...); only these name other modes
const OTHER_MODES = new Set(['nf', '2nf', 'mb', 'dtf']);
function isCtf(m) {
  if (m.map && OTHER_MODES.has(m.map.type)) return false;
  const s = flagStands(m.map && m.map.tiles);
  return !!(s[1] && s[2]);
}

function matchStats(id, raw, maps, allModes) {
  const m = decoder.processMatch(raw, maps, { gameinfo: true, map: true, players: true, team: true, splats: true });
  if (!allModes && !isCtf(m)) return null;
  const duration = m.duration;
  const limit = (m.timeLimit || 0) * 60 * FPS;
  const ps = m.players.map((p, idx) => ({
    idx, name: p.name, auth: !!p.auth, euScore: p.score ?? 0, euPoints: p.points ?? 0,
    tags: 0, pops: 0, grabs: 0, drops: 0, captures: 0, returns: 0,
    hold: 0, prevent: 0, button: 0, block: 0,
    pups: 0, jj: 0, rb: 0, tp: 0, ts: 0,
    lh: 0, flcds: 0, ho: 0, gho: 0, goh: 0, gor: 0, coh: 0, cor: 0, otcaps: 0, qr: 0, kr: 0, rib: 0, saves: 0,
    tprKeyCaps: new Set(), tprSaves: 0,
    teamTime: { 1: 0, 2: 0 }, intervals: [],
    reg: { tags: 0, pops: 0, grabs: 0, captures: 0, returns: 0, prevent: 0 },
  }));

  const holds = [], returns = [], popsByTeam = { 1: [], 2: [] };
  // regulation: up to the time limit (the league's season tables, GASP and NISH only count this part)
  const regEnd = limit && duration > limit ? limit : duration;
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
      if (t <= regEnd) {
        if (e.type === 'grab') s.reg.grabs++;
        else if (e.type === 'capture' || e.type === 'flaglessCapture') s.reg.captures++;
        else if (e.type === 'drop' || e.type === 'pop') s.reg.pops++;
        else if (e.type === 'return') { s.reg.returns++; s.reg.tags++; }
        else if (e.type === 'tag') s.reg.tags++;
      }
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
          if (open[k] >= 0) {
            s[k] += t - open[k];
            if (k === 'prevent') s.reg.prevent += Math.max(0, Math.min(t, regEnd) - open[k]);
            open[k] = -1;
          }
          break;
        }
      }
    }
    for (const k of Object.keys(open)) if (open[k] >= 0) s[k] += duration - open[k];
    if (open.prevent >= 0) s.reg.prevent += Math.max(0, regEnd - open.prevent);
  });

  // each hold against the same side's hold before it (events in one frame are taken in player order,
  // as the league does). These rules reproduce the league's numbers; see STAT_DEFINITIONS.md.
  holds.sort((a, b) => a.start - b.start || a.player - b.player);
  const dropped = (h) => h.how === 'drop' || h.how === 'pop';
  const last = {};
  for (const h of holds) {
    const s = ps[h.player], span = h.end - h.start, prev = last[h.side];
    last[h.side] = h;
    if (span > LONG_HOLD && h.how !== 'end') s.lh++;
    if (span < FLACCID && dropped(h)) s.flcds++;
    if (limit && h.how === 'cap' && h.end > limit) s.otcaps++;
    if (!prev || prev.player === h.player) continue;
    const gap = h.start - prev.end, given = prev.end - prev.start;
    if (gap < 0) continue;
    // grab off a handoff: a teammate's hold shorter than HANDOFF_HOLD ended less than HANDOFF ago
    const handoff = gap < HANDOFF && given < HANDOFF_HOLD;
    if (handoff) { s.goh++; if (h.how === 'cap') s.coh++; }
    // grab off a regrab: a teammate's hold longer than REGRAB_HOLD ended less than PASS ago
    if (gap < PASS && given > REGRAB_HOLD && (gap > 0 || prev.player < h.player)) { s.gor++; if (h.how === 'cap') s.cor++; }
    // handoff given (credited to the earlier holder): the teammate holds longer than PASS_HOLD and
    // drops, or caps off a handoff
    if ((dropped(h) && gap < PASS && span > PASS_HOLD) || (h.how === 'cap' && handoff)) {
      ps[prev.player].ho++;
      if (span > GOOD_HOLD) ps[prev.player].gho++;
    }
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
  // holds that ended in a drop, and splats, by frame
  const byFrame = (list, time) => {
    const map = new Map();
    for (const x of list) { const t = time(x); const l = map.get(t); if (l) l.push(x); else map.set(t, [x]); }
    return map;
  };
  const dropsAt = byFrame(holds.filter(dropped), (h) => h.end);
  const splatsAt = byFrame(splats, (sp) => sp.time);
  // the first item within MATCH_TOL frames of t that passes ok (the earliest frame first, as before)
  const near = (map, t, ok) => {
    for (let d = -MATCH_TOL; d <= MATCH_TOL; d++) for (const x of map.get(t + d) || []) if (ok(x)) return x;
    return null;
  };
  for (const r of returns) {
    const s = ps[r.player], mine = r.side, theirs = 3 - mine;
    const stopped = near(dropsAt, r.time, (h) => h.side !== mine);
    if (stopped && stopped.end - stopped.start < QUICK) s.qr++;
    // the splat of the returned carrier: the one in the return's own frame if there is one
    let at = null;
    for (let d = 0; d <= MATCH_TOL && !at; d++) {
      at = (splatsAt.get(r.time - d) || []).find((sp) => sp.side === theirs)
        || (d && (splatsAt.get(r.time + d) || []).find((sp) => sp.side === theirs)) || null;
    }
    if (at) {
      // the league measures from the splat point moved one tile right and one tile down
      const within = (p, radius) => p && (at.x + SPLAT_SHIFT - p[0]) ** 2 + (at.y + SPLAT_SHIFT - p[1]) ** 2 < radius ** 2;
      if (within(stands[mine], RIB_RADIUS)) s.rib++;
      const holding = holds.some((h) => h.side === mine && h.start <= r.time - SAVE_LAG && r.time <= h.end);
      if (!holding && within(stands[theirs], SAVE_RADIUS)) s.saves++;
      // TagPro Reference's save: no teammate holding (a hold ending in this frame doesn't count)
      const enemy = stands[theirs];
      if (r.time <= regEnd && enemy && !holds.some((h) => h.side === mine && h.start <= r.time && r.time < h.end)
        && (at.x + TPR_SPLAT_SHIFT - enemy[0]) ** 2 + (at.y + TPR_SPLAT_SHIFT - enemy[1]) ** 2 < TPR_SAVE_RADIUS ** 2) s.tprSaves++;
    }
    // TagPro Reference's key return: a return less than TPR_KEY before a teammate's cap, once per cap
    if (r.time <= regEnd) {
      const cap = (capsBySide[mine] || []).find((c) => c >= r.time && c - r.time < TPR_KEY);
      if (cap !== undefined) s.tprKeyCaps.add(cap);
    }
  }

  // the league's periods: regulation, then clutch time (the score wasn't tied at the limit and a flag
  // was held: play runs on until that hold ends), then overtime (tied at the limit, or tied by a
  // clutch-time cap)
  const bounds = [0];
  let hadClutch = false, wentToOvertime = false;
  if (limit && duration > limit) {
    const capsBy = (t) => [1, 2].map((side) => holds.filter((h) => h.side === side && h.how === 'cap' && h.end <= t).length);
    const [a, b] = capsBy(limit);
    let otFrom = limit;
    if (a !== b) {
      const live = holds.filter((h) => h.start <= limit && h.end > limit);
      const clutchEnd = live.length ? Math.max(...live.map((h) => h.end)) : duration;
      bounds.push(limit);
      otFrom = clutchEnd;
      // clutch time: a flag still held at the limit, play going on until it's capped or returned. The league
      // only counts it from half a second past the limit (it seems to round times to whole seconds).
      hadClutch = live.some((h) => h.how !== 'end') && clutchEnd - limit >= FPS / 2;
    }
    if (duration - otFrom >= FPS / 2) { bounds.push(otFrom); wentToOvertime = true; }   // same half second as clutch time
  }
  bounds.push(duration);

  // the league's hold: holds still running at the end left out, each period rounded to whole
  // seconds (halves up); hold against = the other team's league hold
  const leagueHold = ps.map(() => 0), regulationHold = ps.map(() => 0);
  ps.forEach((s, i) => {
    for (let k = 0; k + 1 < bounds.length; k++) {
      let part = 0;
      for (const h of holds) {
        if (h.player !== i || h.how === 'end') continue;
        part += Math.max(0, Math.min(h.end, bounds[k + 1]) - Math.max(h.start, bounds[k]));
      }
      if (part) leagueHold[i] += Math.floor(part / FPS + 0.5);
      if (k === 0) regulationHold[i] = leagueHold[i];
    }
  });
  const firstTeam = ps.map((s) => s.intervals[0]?.team ?? 0);

  const teamScore = { 1: m.teams?.[0]?.score ?? 0, 2: m.teams?.[1]?.score ?? 0 };
  const regScore = { 1: 0, 2: 0 };
  for (const h of holds) if (h.how === 'cap' && h.end <= regEnd && regScore[h.side] !== undefined) regScore[h.side]++;
  const totalPups = ps.reduce((n, s) => n + s.pups, 0);
  const rows = ps.map((s, i) => {
    const team = s.teamTime[1] >= s.teamTime[2] ? (s.teamTime[1] ? 1 : 0) : 2;
    let ha = 0;
    if (firstTeam[i]) ps.forEach((_, j) => { if (firstTeam[j] && firstTeam[j] !== firstTeam[i]) ha += leagueHold[j]; });
    const minutes = (s.teamTime[1] + s.teamTime[2]) / FPS / 60;
    const capsFor = team ? teamScore[team] : 0, capsAgainst = team ? teamScore[3 - team] : 0;
    return {
      match_id: id, date: m.date ? new Date(m.date * 1000).toISOString().slice(0, 10) : '',
      map: m.map?.name ?? '', official: m.official ? 1 : 0, group: m.group ? 1 : 0,
      player: s.name, played_as: s.name, auth: s.auth ? 1 : 0, color: team === 1 ? 'red' : team === 2 ? 'blue' : '',
      result: !team ? '' : capsFor > capsAgainst ? 'W' : capsFor < capsAgainst ? 'L' : 'T',
      overtime: wentToOvertime ? 1 : 0, clutch_time: hadClutch ? 1 : 0,
      caps_for: capsFor, caps_against: capsAgainst, cap_diff: capsFor - capsAgainst,
      minutes: round(minutes),
      tags: s.tags, pops: s.pops, grabs: s.grabs, drops: s.drops, captures: s.captures, returns: s.returns,
      hold: round(s.hold / FPS), prevent: round(s.prevent / FPS), button: round(s.button / FPS), block: round(s.block / FPS),
      pups: s.pups, juke_juice: s.jj, rolling_bomb: s.rb, tagpro: s.tp, top_speed: s.ts, pups_available: totalPups,
      long_holds: s.lh, flaccids: s.flcds, handoffs: s.ho, good_handoffs: s.gho,
      grabs_off_handoffs: s.goh, grabs_off_regrabs: s.gor,
      caps_off_handoffs: s.coh, caps_off_regrabs: s.cor, ot_caps: s.otcaps,
      quick_returns: s.qr, key_returns: s.kr, returns_in_base: s.rib, saves: s.saves,
      tpr_key_returns: s.tprKeyCaps.size, tpr_saves: s.tprSaves,
      nr_tags: Math.max(0, s.tags - s.returns), nd_pops: Math.max(0, s.pops - s.drops),
      kept_flags: s.grabs - s.drops - s.captures, league_hold: leagueHold[i], hold_against: ha,
      eu_score: s.euScore, eu_points: s.euPoints,
      regulation_minutes: round(s.intervals.reduce((a, iv) => a + Math.max(0, Math.min(iv.end, regEnd) - iv.start), 0) / FPS / 60),
      regulation_tags: s.reg.tags, regulation_pops: s.reg.pops, regulation_grabs: s.reg.grabs,
      regulation_caps: s.reg.captures, regulation_returns: s.reg.returns, regulation_hold: regulationHold[i],
      regulation_prevent: round(s.reg.prevent / FPS),
      regulation_cap_diff: team ? regScore[team] - regScore[3 - team] : 0,
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
  const elig = rows.filter((r) => r.color && r.minutes >= 0.5 && div(r.minutes, gameMinutes) >= 0.15);
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
  'ot_caps', 'quick_returns', 'key_returns', 'returns_in_base', 'saves', 'tpr_key_returns', 'tpr_saves', 'nr_tags', 'nd_pops', 'kept_flags', 'league_hold', 'hold_against', 'eu_score', 'eu_points',
  'regulation_minutes', 'regulation_tags', 'regulation_pops', 'regulation_grabs', 'regulation_caps', 'regulation_returns',
  'regulation_hold', 'regulation_prevent', 'regulation_cap_diff'];

// combined stats, added up one row at a time so memory stays small however many rows there are.
// order: the row's place in the whole run, so totals added up on several threads and merged come out
// the same as on one (the name first seen is the one shown, and names are listed in the order seen).
const COUNTS = ['games', 'wins', 'losses', 'ties', 'ot_wins', 'ot_losses', ...SUMS, 'scoreSum', 'scoreCount'];
function makeTotals() {
  const byPlayer = new Map();
  return {
    add(r, order) {
      const k = r.player.toLowerCase();
      let t = byPlayer.get(k);
      if (!t) {
        t = { player: r.player, first: order, names: new Map(), ...Object.fromEntries(COUNTS.map((c) => [c, 0])) };
        byPlayer.set(k, t);
      }
      t.games++;
      const name = r.played_as ?? r.player;
      if (!t.names.has(name)) t.names.set(name, order);
      if (r.result === 'W') t.wins++; else if (r.result === 'L') t.losses++; else if (r.result === 'T') t.ties++;
      if (r.overtime && r.result === 'W') t.ot_wins++; else if (r.overtime && r.result === 'L') t.ot_losses++;
      for (const s of SUMS) t[s] += r[s];
      if (r.score !== '') { t.scoreSum += r.score; t.scoreCount++; }
    },
    // another makeTotals' players (from state()), added into this one
    merge(players) {
      for (const [k, o] of players) {
        const t = byPlayer.get(k);
        if (!t) { byPlayer.set(k, o); continue; }
        if (o.first < t.first) { t.player = o.player; t.first = o.first; }
        for (const c of COUNTS) t[c] += o[c];
        for (const [name, order] of o.names) if (!(t.names.get(name) <= order)) t.names.set(name, order);
      }
    },
    state() { return [...byPlayer]; },
    finish() {
      const players = [...byPlayer.values()].sort((a, b) => a.first - b.first);
      const out = players.map((t) => {
        for (const s of SUMS) t[s] = round(t[s]);
        const avg = t.scoreCount ? round(t.scoreSum / t.scoreCount, 1) : '';
        const { scoreSum, scoreCount, first, ...rest } = t;
        rest.names = [...t.names].sort((a, b) => a[1] - b[1]).map(([name]) => name).join(' / ');
        return { ...rest, win_pct: round(div(t.wins, t.wins + t.losses + t.ties) * 100), avg_score: avg, ...rates(rest) };
      });
      gaspNish(out);
      return out.sort((a, b) => b.minutes - a.minutes);
    },
  };
}

// GASP and NISH the way tagproleague.com works them out, over the players in this output: each regulation stat
// standardised over those players, weighted and added up, then Excel's PERCENTRANK (players below ÷
// (players - 1)) of the sum: GASP out of 10, NISH out of 100
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
  const percentRank = (values) => values.map((v) => values.filter((x) => x < v).length / (values.length - 1));
  for (const r of rows) Object.assign(r, { gasp_o: '', gasp_d: '', gasp_t: '', nish_o: '', nish_d: '', nish_t: '' });

  const pool = rows.filter((r) => r.regulation_minutes >= RATING_MIN_MINUTES);
  if (pool.length < 2) return;
  // the league's inputs: regulation stats only
  const inputs = pool.map((r) => {
    const pm = (x) => div(x, r.regulation_minutes);
    return {
      captures: r.regulation_caps, hold: r.regulation_hold, returns: r.regulation_returns, prevent: r.regulation_prevent,
      cpm: pm(r.regulation_caps), hold_pm: pm(r.regulation_hold), rpm: pm(r.regulation_returns), prevent_pm: pm(r.regulation_prevent),
      nrtpm: pm(r.regulation_tags - r.regulation_returns), score_pct: div(r.regulation_caps, r.regulation_grabs),
      kd: div(r.regulation_tags, r.regulation_pops), cap_diff: r.regulation_cap_diff,
    };
  });
  const keys = [...new Set([...GASP_O, ...GASP_D, ...NISH_O, ...NISH_D].map(([k]) => k)), 'cap_diff'];
  const z = standardise(inputs, keys);
  const sum = (zi, w) => w.reduce((a, [k, wt]) => a + wt * zi[k], 0);
  const go = z.map((zi) => sum(zi, GASP_O)), gd = z.map((zi) => sum(zi, GASP_D));
  const no = z.map((zi) => sum(zi, NISH_O)), nd = z.map((zi) => sum(zi, NISH_D));
  const scores = {
    gasp_o: go, gasp_d: gd, gasp_t: go.map((x, i) => x + gd[i]),
    nish_o: no, nish_d: nd, nish_t: no.map((x, i) => x + nd[i] + NISH_T_PLUS_MINUS * z[i].cap_diff),
  };
  for (const [column, values] of Object.entries(scores)) {
    const ranks = percentRank(values), scale = column.startsWith('gasp') ? 10 : 100;
    pool.forEach((r, i) => { r[column] = scale === 10 ? round(ranks[i] * 10) : Math.round(ranks[i] * 100); });
  }
}

// ---------------------------------------------------------------- working out matches, on threads

// one match's text -> { rows } (null rows: not a CTF match) or { error }
function processMatch(id, text, maps, allModes) {
  try {
    const raw = JSON.parse(text);
    if (!raw || !raw.players) return { rows: null };
    const map = raw.map || (maps && maps[raw.mapId]);
    if (!allModes && map && OTHER_MODES.has(map.type)) return { rows: null };
    return { rows: matchStats(id, raw, maps, allModes) };
  } catch (e) {
    return { error: e.message };
  }
}

// works out matches one after another: renames players (aliases), adds them to the combined stats,
// and turns the rows into output lines. Used directly on one thread, and inside each worker thread.
// take(seq, id, text) -> { lines, header, rows, renamed } or { skipped } or { error }
function makeMatchWorker({ maps, allModes, aliases, json, totals }) {
  let cols = null;
  return (seq, id, text) => {
    const result = processMatch(id, text, maps, allModes);
    if (result.error) return { error: result.error };
    if (!result.rows) return { skipped: true };
    let renamed = 0, lines = '';
    result.rows.forEach((r, i) => {
      const main = aliases && aliases.get(r.player.toLowerCase());
      if (main && main !== r.player) { r.player = main; renamed++; }
      if (totals) totals.add(r, seq * 1000 + i);
      if (json === null) return;
      if (!cols && !json) cols = Object.keys(r);
      lines += (json ? JSON.stringify(r) : csvLine(r, cols)) + '\n';
    });
    return { lines, header: cols ? cols.join(',') : null, rows: result.rows.length, renamed };
  };
}

// a worker thread: loads the maps once, then works out each match it is sent; at the end it sends
// back its share of the combined stats
function workerMain() {
  const { mapsFile: file, allModes, aliases, json, wantTotals } = workerData;
  const maps = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const totals = wantTotals ? makeTotals() : null;
  const take = makeMatchWorker({ maps, allModes, aliases: aliases && new Map(aliases), json, totals });
  parentPort.on('message', (msg) => {
    if (msg.finish) parentPort.postMessage({ totals: totals ? totals.state() : null });
    else parentPort.postMessage({ seq: msg.seq, ...take(msg.seq, msg.id, msg.text) });
  });
}

// threads workers sharing the matches; work(seq, id, text) returns a promise of the worker's result
function makePool(threads, options) {
  const waiting = new Map();
  let next = 0;
  const workers = Array.from({ length: threads }, () => {
    const w = new Worker(__filename, { workerData: options });
    w.on('message', (msg) => {
      const key = msg.totals !== undefined ? `finish-${workers.indexOf(w)}` : msg.seq;
      waiting.get(key)(msg); waiting.delete(key);
    });
    w.on('error', (e) => die(e.stack || e.message));
    return w;
  });
  return {
    work(seq, id, text) {
      workers[next++ % threads].postMessage({ seq, id, text });
      return new Promise((resolve) => waiting.set(seq, resolve));
    },
    // every worker's share of the combined stats, then the workers stop
    async finish() {
      const states = await Promise.all(workers.map((w, i) => new Promise((resolve) => {
        waiting.set(`finish-${i}`, resolve);
        w.postMessage({ finish: true });
      })));
      for (const w of workers) w.terminate();
      return states.map((m) => m.totals);
    },
  };
}

// ---------------------------------------------------------------- output

// writes rows to a .csv or .json file as they come, so they never all have to be in memory.
// JSON is an array with one row per line.
const csvCell = (v) => {
  if (typeof v === 'number') return String(v);
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csvLine(r, cols) {
  let line = '';
  for (let j = 0; j < cols.length; j++) line += (j ? ',' : '') + csvCell(r[cols[j]]);
  return line;
}

function makeWriter(file) {
  const json = file.endsWith('.json');
  const fd = fs.openSync(file, 'w');
  let cols = null, block = '', count = 0, headerDone = false;
  const flush = (force) => { if (block && (force || block.length > 1 << 20)) { fs.writeSync(fd, block); block = ''; } };
  return {
    json,
    add(r) {
      if (json) block += (count ? ',\n' : '[\n') + JSON.stringify(r);
      else {
        if (!cols) { cols = Object.keys(r); block += cols.join(',') + '\n'; }
        block += csvLine(r, cols) + '\n';
      }
      count++;
      flush(false);
    },
    // rows already made into lines (one per row, each ending in a newline) by makeMatchWorker
    addLines(lines, header, rows) {
      if (!rows) return;
      if (json) block += (count ? ',\n' : '[\n') + lines.slice(0, -1).replace(/\n/g, ',\n');
      else {
        if (!headerDone) { block += header + '\n'; headerDone = true; }
        block += lines;
      }
      count += rows;
      flush(false);
    },
    close() {
      if (json) block += count ? '\n]\n' : '[]\n';
      flush(true);
      fs.closeSync(fd);
      return count;
    },
  };
}

function write(file, rows) {
  const w = makeWriter(file);
  for (const r of rows) w.add(r);
  w.close();
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  delayMs = opt.delay;
  const ids = parseIds(opt.specs);
  if (!ids.length && !opt.all) die('no match ids given (or --all for every match in the bulk file)');
  if (opt.all) console.error(`every match in ${opt.bulk}`);
  else console.error(`${ids.length} match id(s), ${ids[0]} to ${ids[ids.length - 1]}, from ${opt.mode === 'site' ? 'tagpro.eu one at a time' : 'bulk files'}`);

  const aliases = opt.aliases ? loadAliases(opt.aliases) : null;
  if (aliases) console.error(`aliases: ${aliases.size} names for ${new Set(aliases.values()).size} players`);
  const writer = opt.matches ? makeWriter(opt.out) : null;
  const combined = opt.totals ? makeTotals() : null;
  let done = 0, skipped = 0, failed = 0, rowCount = 0, renamed = 0;
  const source = opt.mode === 'site' ? fromSite(opt, ids) : fromBulk(opt, ids);
  // CTF_PROGRESS=1 (set by the app): a "@progress seen total" line at most every 200 ms
  const progress = process.env.CTF_PROGRESS ? (() => {
    let seen = 0, last = 0;
    return (final) => {
      seen += final ? 0 : 1;
      const now = Date.now();
      if (final || now - last > 200) { last = now; console.error(`@progress ${final && ids.length ? ids.length : seen} ${ids.length}`); }
    };
  })() : () => {};
  const take = (id, result) => {
    progress();
    if (result.error) { failed++; console.error(`  ${id}: could not read (${result.error})`); return; }
    if (result.skipped) { skipped++; return; }
    done++;
    rowCount += result.rows;
    renamed += result.renamed;
    if (writer) writer.addLines(result.lines, result.header, result.rows);
  };
  // bulk: the matches are worked out on threads while this thread reads the file; results are taken in
  // match order. Site mode waits between downloads anyway, so it works on this thread.
  const mapsPath = opt.mode === 'bulk' ? await mapsFile(opt) : null;
  const threads = opt.mode === 'bulk' ? opt.threads : 1;
  const json = writer ? writer.json : null;
  let seq = 0;
  if (threads > 1) {
    const pool = makePool(threads, { mapsFile: mapsPath, allModes: opt.allModes, aliases: aliases && [...aliases], json, wantTotals: !!combined });
    const inFlight = [];
    for await (const [id, text] of source) {
      inFlight.push([id, pool.work(seq++, id, text)]);
      if (inFlight.length >= threads * 16) { const [i, p] = inFlight.shift(); take(i, await p); }
    }
    for (const [i, p] of inFlight) take(i, await p);
    for (const state of await pool.finish()) if (combined) combined.merge(state);
  } else {
    const maps = mapsPath ? JSON.parse(fs.readFileSync(mapsPath, 'utf8')) : null;
    const work = makeMatchWorker({ maps, allModes: opt.allModes, aliases, json, totals: combined });
    for await (const [id, text] of source) take(id, work(seq++, id, text));
  }
  progress(true);
  if (writer) writer.close();
  if (aliases) console.error(`aliases: ${renamed} rows renamed`);
  console.error(`${done} CTF match(es), ${rowCount} player rows${opt.matches ? ` -> ${opt.out}` : ''}` +
    (skipped ? `; ${skipped} non-CTF skipped` : '') + (failed ? `; ${failed} unreadable` : ''));
  if (combined) {
    const t = combined.finish();
    write(opt.totals, t);
    console.error(`${t.length} players -> ${opt.totals}`);
  }
}

if (isMainThread) main().catch((e) => die(e.stack || e.message));
else workerMain();
