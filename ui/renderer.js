// The window: the form, the run, the result tables and the names editor.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) e.append(kid);
  return e;
};
const fmt = (n) => Number(n).toLocaleString();
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const FIELDS = ['bulk', 'maps', 'out', 'totals', 'delay'];
const CHECKS = ['download', 'allModes', 'wantMatches', 'wantTotals', 'useNames'];
const SAVED = 'ctf-stats-ui';
const SAVED_NAMES = 'ctf-stats-names';

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const mode = () => document.querySelector('input[name=mode]:checked').value;
const format = () => document.querySelector('input[name=format]:checked').value;

function saveForm() {
  const s = { mode: mode(), format: format(), ids: $('ids').value };
  for (const f of FIELDS) s[f] = $(f).value;
  for (const c of CHECKS) s[c] = $(c).checked;
  store.set(SAVED, s);
}

// ================================================================ match ids

// the same rules as the script, but as merged ranges, so a huge range counts instantly
function parseRanges(text) {
  const raw = [];
  for (const tok of text.replace(/[?&]match=/g, ' ').split(/[\s,;]+/)) {
    const range = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b) [a, b] = [b, a];
      if (b - a > 5e6) return { error: `range ${tok} is too big (over 5 million)` };
      raw.push([a, b]);
    } else if (/^\d+$/.test(tok)) raw.push([Number(tok), Number(tok)]);
    else if (tok) {
      const id = tok.match(/(\d{3,})/);
      if (id) raw.push([Number(id[1]), Number(id[1])]);
    }
  }
  raw.sort((x, y) => x[0] - y[0]);
  const ranges = [];
  for (const [a, b] of raw) {
    const last = ranges[ranges.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else ranges.push([a, b]);
  }
  const n = ranges.reduce((s, [a, b]) => s + b - a + 1, 0);
  return { ranges, n };
}

let parsed = { ranges: [], n: 0 };
function updateIds() {
  parsed = parseRanges($('ids').value);
  const pill = $('idCount');
  pill.classList.toggle('bad', !!parsed.error);
  pill.classList.toggle('has', !parsed.error && parsed.n > 0);
  if (parsed.error) pill.textContent = 'error';
  else if (!parsed.n) pill.textContent = 'none yet';
  else {
    const first = parsed.ranges[0][0], last = parsed.ranges[parsed.ranges.length - 1][1];
    pill.textContent = `${fmt(parsed.n)} match${parsed.n === 1 ? '' : 'es'}`;
    pill.title = first === last ? String(first) : `${first} – ${last}`;
  }
  checkCoverage();
}

const checkCoverage = debounce(async () => {
  const c = $('coverage');
  c.className = 'hint';
  if (parsed.error) { c.textContent = parsed.error; c.className = 'hint bad'; return; }
  if (!parsed.n) { c.textContent = ''; return; }
  const first = parsed.ranges[0][0], last = parsed.ranges[parsed.ranges.length - 1][1];
  const span = first === last ? `${first}` : `${fmt(first)} – ${fmt(last)}`;
  if (mode() !== 'bulk' || $('download').checked) {
    const mins = Math.ceil(parsed.n * (Number($('delay').value) || 2000) / 60000);
    c.textContent = mode() === 'site' ? `${span} · ${fmt(parsed.n)} requests, about ${mins} min at most (cached matches are instant)` : span;
    return;
  }
  const cov = await window.api.coverage($('bulk').value.trim(), parsed.ranges);
  if (!cov.known) { c.textContent = `${span} · can't tell which ids this bulk file holds`; return; }
  if (cov.inside === cov.total) { c.textContent = `${span} · all in your bulk files`; c.className = 'hint ok'; return; }
  const missing = cov.total - cov.inside;
  c.textContent = `${span} · ${fmt(missing)} not in your bulk files${cov.last && last > cov.last ? ` (they end at ${fmt(cov.last)})` : ''}`;
  c.className = 'hint bad';
}, 300);

$('loadIds').addEventListener('click', async () => {
  const picked = await window.api.pick({ kind: 'file', title: 'File of match ids', filters: [{ name: 'Text', extensions: ['txt', 'csv', 'tsv'] }, { name: 'All files', extensions: ['*'] }] });
  if (!picked) return;
  try { appendIds(await window.api.readText(picked)); } catch (err) { status(`Could not read ${picked}: ${err.message}`, 'bad'); }
});
$('pasteIds').addEventListener('click', async () => appendIds(await window.api.paste()));
$('clearIds').addEventListener('click', () => { $('ids').value = ''; updateIds(); saveForm(); });
function appendIds(text) {
  const cur = $('ids').value.trim();
  $('ids').value = cur ? `${cur}\n${text.trim()}` : text.trim();
  updateIds(); saveForm();
}

// ================================================================ source and output form

function updateMode() {
  const bulk = mode() === 'bulk';
  document.querySelectorAll('.bulk-only').forEach((e) => { e.hidden = !bulk; });
  document.querySelector('.delay-field').hidden = bulk && !$('download').checked;
  $('modeHelp').textContent = bulk
    ? 'Reads matches from tagpro.eu bulk files on this computer. Fast, no requests.'
    : 'Downloads each match from tagpro.eu, one request at a time, and keeps a copy in the cache folder.';
  checkCoverage();
}

function updateOutputs() {
  $('out').disabled = !$('wantMatches').checked;
  $('totals').disabled = !$('wantTotals').checked;
  document.querySelector('[data-pick=out]').disabled = !$('wantMatches').checked;
  document.querySelector('[data-pick=totals]').disabled = !$('wantTotals').checked;
}

// switching CSV/JSON renames both output files
function applyFormat() {
  const ext = `.${format()}`;
  for (const f of ['out', 'totals']) {
    const v = $(f).value.trim();
    if (v) $(f).value = /\.(csv|json)$/i.test(v) ? v.replace(/\.(csv|json)$/i, ext) : v + ext;
  }
  saveForm();
}

const FILTERS = {
  bulk: [{ name: 'Bulk match files', extensions: ['json', 'gz'] }, { name: 'All files', extensions: ['*'] }],
  maps: [{ name: 'JSON', extensions: ['json', 'gz'] }, { name: 'All files', extensions: ['*'] }],
};
const TITLES = { bulk: 'Bulk match file or folder', maps: 'tagpro.eu maps file', out: 'Save per-match stats as', totals: 'Save combined stats as' };

document.querySelectorAll('[data-pick]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const field = btn.dataset.pick;
    const filters = FILTERS[field] || [{ name: format().toUpperCase(), extensions: [format()] }];
    const picked = await window.api.pick({ kind: btn.dataset.kind, title: TITLES[field], current: $(field).value, filters });
    if (!picked) return;
    $(field).value = picked;
    if (btn.dataset.kind === 'save') {
      const ext = picked.match(/\.(csv|json)$/i);
      if (ext) document.querySelector(`input[name=format][value=${ext[1].toLowerCase()}]`).checked = true;
      applyFormat();
    }
    saveForm();
    if (field === 'bulk') checkCoverage();
  });
});

// ================================================================ result tables

const KEY_COLS = {
  totals: ['player', 'names', 'games', 'wins', 'losses', 'win_pct', 'minutes', 'captures', 'grabs', 'hold', 'returns', 'tags', 'pops',
    'prevent', 'long_holds', 'flaccids', 'handoffs', 'good_handoffs', 'grabs_off_regrabs', 'quick_returns', 'key_returns',
    'returns_in_base', 'saves', 'hold_against', 'score_pct', 'kd', 'avg_score', 'gasp_t', 'nish'],
  matches: ['match_id', 'date', 'map', 'player', 'played_as', 'team', 'result', 'minutes', 'captures', 'grabs', 'hold', 'returns',
    'tags', 'pops', 'prevent', 'long_holds', 'flaccids', 'handoffs', 'good_handoffs', 'returns_in_base', 'saves', 'score'],
};
const RENDER_LIMIT = 500;
const tables = {
  totals: { data: null, file: null, sort: null, asc: false, filter: '', all: false },
  matches: { data: null, file: null, sort: null, asc: false, filter: '', all: false },
};

function renderTable(which) {
  const t = tables[which];
  const pane = document.querySelector(`[data-table=${which}]`);
  const wrap = pane.querySelector('.table-wrap');
  const count = pane.querySelector('.count');
  pane.querySelectorAll('.open-file, .show-file').forEach((b) => { b.disabled = !t.file; });
  wrap.textContent = '';
  const d = t.data;
  if (!d) { wrap.append(el('p', { class: 'empty', textContent: which === 'totals' ? 'Run to see one row per player here.' : 'Run to see one row per player per match here.' })); count.textContent = ''; return; }
  if (d.error) { wrap.append(el('p', { class: 'empty', textContent: `Could not read ${t.file}: ${d.error}` })); return; }

  const show = t.all ? d.cols.map((_, i) => i) : KEY_COLS[which].map((c) => d.cols.indexOf(c)).filter((i) => i >= 0);
  let rows = d.rows;
  if (t.filter) {
    const q = t.filter.toLowerCase();
    rows = rows.filter((r) => r.some((v) => String(v).toLowerCase().includes(q)));
  }
  if (t.sort !== null) {
    const i = t.sort, dir = t.asc ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      const x = a[i], y = b[i];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      if (x === '' || x == null) return 1;
      if (y === '' || y == null) return -1;
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }
  const loaded = d.rows.length, inFile = d.total;
  count.textContent = `${fmt(Math.min(rows.length, RENDER_LIMIT))} shown of ${fmt(rows.length)}${t.filter ? ' matching' : ''}`
    + (inFile > loaded ? ` (first ${fmt(loaded)} of ${fmt(inFile)} rows loaded; open the file for all)` : '');

  const textCol = (i) => d.rows.slice(0, 50).some((r) => typeof r[i] === 'string' && r[i] !== '');
  const isText = show.map(textCol);
  const table = el('table');
  const head = table.createTHead().insertRow();
  show.forEach((ci, k) => {
    const th = el('th', { textContent: d.cols[ci], title: 'Sort' });
    if (isText[k]) th.classList.add('text');
    if (d.cols[ci] === 'player') th.classList.add('sticky');
    if (t.sort === ci) th.classList.add('sorted', ...(t.asc ? ['asc'] : []));
    th.addEventListener('click', () => {
      if (t.sort === ci) t.asc = !t.asc; else { t.sort = ci; t.asc = isText[k]; }
      renderTable(which);
    });
    head.append(th);
  });
  const body = table.createTBody();
  const frag = document.createDocumentFragment();
  for (const r of rows.slice(0, RENDER_LIMIT)) {
    const tr = document.createElement('tr');
    show.forEach((ci, k) => {
      const td = document.createElement('td');
      const v = r[ci];
      td.textContent = v ?? '';
      if (isText[k]) td.className = 'text';
      if (d.cols[ci] === 'player') td.classList.add('sticky');
      if (d.cols[ci] === 'names') { td.classList.add('names'); td.title = v ?? ''; }
      tr.append(td);
    });
    frag.append(tr);
  }
  body.append(frag);
  wrap.append(table);
}

document.querySelectorAll('[data-table]').forEach((pane) => {
  const which = pane.dataset.table;
  pane.querySelector('.search').addEventListener('input', debounce((e) => { tables[which].filter = e.target.value.trim(); renderTable(which); }, 150));
  pane.querySelector('.allCols').addEventListener('change', (e) => { tables[which].all = e.target.checked; renderTable(which); });
  pane.querySelector('.open-file').addEventListener('click', () => tables[which].file && window.api.openPath(tables[which].file));
  pane.querySelector('.show-file').addEventListener('click', () => tables[which].file && window.api.showInFolder(tables[which].file));
});

// ================================================================ tabs and log

function showTab(id) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === id));
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

function log(text, kind) {
  const box = $('log');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.append(el('span', { class: kind || '', textContent: text }));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ================================================================ names editor

let people = store.get(SAVED_NAMES, []).map((p) => ({ id: newId(), main: p.main || '', alts: p.alts || [] }));
let selected = people[0]?.id ?? null;
let seenNames = store.get('ctf-stats-seen', []);
function newId() { return Math.random().toString(36).slice(2, 10); }
const norm = (s) => s.trim().toLowerCase();

function saveNames() {
  store.set(SAVED_NAMES, people.map(({ main, alts }) => ({ main, alts })).filter((p) => p.main.trim() || p.alts.length));
  updateNamesSummary();
}

// names listed more than once (in different players, or twice in one)
function duplicates() {
  const where = new Map();
  for (const p of people) for (const n of [p.main, ...p.alts]) {
    const k = norm(n);
    if (!k) continue;
    where.set(k, (where.get(k) || 0) + 1);
  }
  return new Set([...where].filter(([, c]) => c > 1).map(([k]) => k));
}

function updateNamesSummary() {
  const players = people.filter((p) => p.main.trim() && p.alts.length).length;
  const alts = people.reduce((s, p) => s + p.alts.length, 0);
  $('namesSummary').textContent = players ? `(${players} player${players === 1 ? '' : 's'}, ${alts} alt${alts === 1 ? '' : 's'})` : '(none set up yet)';
  $('namesBadge').textContent = players || '';
}

function addAlts(person, text) {
  const have = new Set([person.main, ...person.alts].map(norm));
  for (const n of text.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)) {
    if (!have.has(norm(n))) { person.alts.push(n); have.add(norm(n)); }
  }
}

function renderPeople(focus) {
  const box = $('people');
  box.textContent = '';
  const dups = duplicates();
  const q = norm($('peopleSearch').value);
  const shown = people.filter((p) => !q || [p.main, ...p.alts].some((n) => norm(n).includes(q)));
  if (!people.length) {
    box.append(el('p', { class: 'empty', textContent: 'No players yet. "+ Add player", then give the main name and add the other names they play under.' }));
  } else if (!shown.length) {
    box.append(el('p', { class: 'empty', textContent: 'No player has that name.' }));
  }
  for (const p of shown) {
    const card = el('div', { class: `person${p.id === selected ? ' selected' : ''}`, 'data-id': p.id, onmousedown: () => select(p.id) });
    const main = el('input', {
      class: 'main', type: 'text', value: p.main, placeholder: 'Main name (shown in the stats)', spellcheck: false,
      oninput: (e) => { p.main = e.target.value; saveNames(); renderSeen(); },
      onchange: () => renderPeople(),
    });
    const head = el('div', { class: 'person-head' }, main,
      el('span', { class: 'tag', textContent: `${p.alts.length} alt${p.alts.length === 1 ? '' : 's'}` }),
      el('button', { class: 'icon', title: 'Remove this player', textContent: '✕', onclick: () => removePerson(p.id) }));
    const chips = el('div', { class: 'chips' });
    p.alts.forEach((a, i) => {
      chips.append(el('span', { class: `chip${dups.has(norm(a)) ? ' dup' : ''}`, title: dups.has(norm(a)) ? 'Listed more than once' : '' },
        a, el('button', { title: 'Remove', textContent: '×', onclick: () => { p.alts.splice(i, 1); saveNames(); renderPeople(); renderSeen(); } })));
    });
    const add = el('input', {
      class: 'add-alt', type: 'text', placeholder: 'add alt name…', spellcheck: false, list: 'seenNames',
      onkeydown: (e) => {
        if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
          e.preventDefault();
          addAlts(p, e.target.value);
          saveNames(); renderPeople(p.id); renderSeen();
        } else if (e.key === 'Backspace' && !e.target.value && p.alts.length) {
          p.alts.pop(); saveNames(); renderPeople(p.id); renderSeen();
        }
      },
      onpaste: (e) => {
        const text = e.clipboardData.getData('text');
        if (/[,\n]/.test(text)) { e.preventDefault(); addAlts(p, text); saveNames(); renderPeople(p.id); renderSeen(); }
      },
      onchange: (e) => { if (e.target.value.trim()) { addAlts(p, e.target.value); saveNames(); renderPeople(p.id); renderSeen(); } },
    });
    chips.append(add);
    card.append(head, chips);
    if (dups.has(norm(p.main))) card.append(el('div', { class: 'warn', textContent: `"${p.main}" is also listed under another player.` }));
    box.append(card);
    if (focus === p.id) add.focus();
    if (focus === `${p.id}:main`) main.focus();
  }
}

function select(id) {
  selected = id;
  document.querySelectorAll('.person').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
}

function addPerson(main = '') {
  const p = { id: newId(), main, alts: [] };
  people.unshift(p);
  selected = p.id;
  $('peopleSearch').value = '';
  saveNames(); renderPeople(main ? p.id : `${p.id}:main`); renderSeen();
  return p;
}

function removePerson(id) {
  const p = people.find((x) => x.id === id);
  if (p && (p.main.trim() || p.alts.length) && !confirm(`Remove ${p.main || 'this player'} and their ${p.alts.length} alt(s)?`)) return;
  people = people.filter((x) => x.id !== id);
  if (selected === id) selected = people[0]?.id ?? null;
  saveNames(); renderPeople(); renderSeen();
}

// names from the last run that no player covers yet
function renderSeen() {
  const box = $('seen');
  const used = new Set(people.flatMap((p) => [p.main, ...p.alts]).map(norm));
  const q = norm($('seenSearch').value);
  const list = seenNames.filter((n) => !used.has(norm(n)) && (!q || norm(n).includes(q)));
  $('seenNames').replaceChildren(...seenNames.filter((n) => !used.has(norm(n))).slice(0, 2000).map((n) => el('option', { value: n })));
  box.textContent = '';
  if (!seenNames.length) { box.append(el('p', { class: 'empty', textContent: 'Run once and the names that appear show up here.' })); return; }
  if (!list.length) { box.append(el('p', { class: 'empty', textContent: q ? 'No match.' : 'Every name is in a player.' })); return; }
  const frag = document.createDocumentFragment();
  for (const n of list.slice(0, 1500)) {
    frag.append(el('div', { class: 'seen-row' },
      el('button', { class: 'name', textContent: n, title: 'Add to the selected player', onclick: () => {
        let p = people.find((x) => x.id === selected);
        if (!p) p = addPerson('');
        if (!p.main.trim()) p.main = n; else addAlts(p, n);
        saveNames(); renderPeople(); renderSeen();
      } }),
      el('button', { class: 'new', textContent: '＋', title: 'New player with this as the main name', onclick: () => addPerson(n) })));
  }
  if (list.length > 1500) frag.append(el('p', { class: 'hint', textContent: `${fmt(list.length - 1500)} more; filter to find them.` }));
  box.append(frag);
}

// text form: "Main: alt, alt" per line
const namesToText = () => people.filter((p) => p.main.trim()).map((p) => (p.alts.length ? `${p.main}: ${p.alts.join(', ')}` : p.main)).join('\n');
function textToPeople(text) {
  const t = text.trim();
  const out = [];
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t);
    const groups = Array.isArray(j) ? j.map((g) => [g.main, ...(g.alts || [])]) : Object.entries(j).map(([m, a]) => [m, ...(a || [])]);
    for (const g of groups) out.push(g);
  } else {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const c = line.indexOf(':');
      out.push(c > 0 ? [line.slice(0, c), ...line.slice(c + 1).split(',')] : line.split(','));
    }
  }
  return out.map((g) => g.map((n) => String(n ?? '').trim()).filter(Boolean)).filter((g) => g.length)
    .map(([main, ...alts]) => ({ id: newId(), main, alts }));
}

function importPeople(list, replace) {
  if (replace) people = [];
  for (const q of list) {
    const p = people.find((x) => norm(x.main) === norm(q.main));
    if (p) addAlts(p, q.alts.join(','));
    else people.push(q);
  }
  selected = people[0]?.id ?? null;
  saveNames(); renderPeople(); renderSeen();
}

$('addPerson').addEventListener('click', () => addPerson(''));
$('peopleSearch').addEventListener('input', () => renderPeople());
$('seenSearch').addEventListener('input', debounce(renderSeen, 120));
$('copyNames').addEventListener('click', async () => {
  await window.api.copy(namesToText());
  status('Names list copied.', 'ok');
});
$('importNames').addEventListener('click', async () => {
  $('importText').value = '';
  $('importDialog').hidden = false;
  $('importText').focus();
});
$('importCancel').addEventListener('click', () => { $('importDialog').hidden = true; });
for (const [btn, replace] of [['importMerge', false], ['importReplace', true]]) {
  $(btn).addEventListener('click', () => {
    let list;
    try { list = textToPeople($('importText').value); } catch (err) { alert(`Couldn't read that: ${err.message}`); return; }
    if (replace && people.length && !confirm(`Replace all ${people.length} players with ${list.length}?`)) return;
    importPeople(list, replace);
    $('importDialog').hidden = true;
    status(`Imported ${list.length} player(s).`, 'ok');
  });
}
$('openNames').addEventListener('click', async () => {
  const picked = await window.api.pick({ kind: 'file', title: 'Open a names list', filters: [{ name: 'Names list', extensions: ['txt', 'json'] }, { name: 'All files', extensions: ['*'] }] });
  if (!picked) return;
  try { importPeople(textToPeople(await window.api.readText(picked)), false); status(`Added names from ${picked}.`, 'ok'); } catch (err) { status(`Couldn't read ${picked}: ${err.message}`, 'bad'); }
});
$('saveNames').addEventListener('click', async () => {
  const picked = await window.api.pick({ kind: 'save', title: 'Save the names list', filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'JSON', extensions: ['json'] }] });
  if (!picked) return;
  const text = picked.endsWith('.json') ? JSON.stringify(people.filter((p) => p.main.trim()).map(({ main, alts }) => ({ main, alts })), null, 1) : namesToText() + '\n';
  await window.api.writeText(picked, text);
  status(`Names saved to ${picked}.`, 'ok');
});

// ================================================================ run

function status(text, kind) { $('status').textContent = text; $('status').className = `status ${kind || ''}`; $('status').title = text; }

function setRunning(on) {
  $('run').disabled = on;
  $('stop').disabled = !on;
  document.querySelectorAll('.side input, .side textarea, .side [data-pick], #loadIds, #pasteIds, #clearIds').forEach((e) => { e.disabled = on; });
  if (!on) updateOutputs();
  $('progress').classList.toggle('on', on);
}

let started = 0;
async function run() {
  updateIds();
  if (parsed.error) { status(parsed.error, 'bad'); return; }
  if (!parsed.n) { status('Paste some match ids first.', 'bad'); return; }
  const wantMatches = $('wantMatches').checked, wantTotals = $('wantTotals').checked;
  if (!wantMatches && !wantTotals) { status('Tick per-match stats, combined stats, or both.', 'bad'); return; }
  if (wantMatches && !$('out').value.trim()) { status('Choose where to save the per-match stats.', 'bad'); return; }
  if (wantTotals && !$('totals').value.trim()) { status('Choose where to save the combined stats.', 'bad'); return; }
  const delay = Number($('delay').value) || 2000;
  if (mode() === 'site' && parsed.n > 500
    && !confirm(`That's up to ${fmt(parsed.n)} separate requests to tagpro.eu (about ${Math.round(parsed.n * delay / 60000)} minutes). Bulk files are much faster if you have them. Go ahead?`)) return;
  const aliases = $('useNames').checked
    ? people.filter((p) => p.main.trim() && p.alts.length).map(({ main, alts }) => ({ main: main.trim(), alts }))
    : [];
  saveForm();
  $('log').textContent = '';
  $('progressFill').style.width = '0%';
  setRunning(true);
  status('Starting…');
  started = Date.now();
  const res = await window.api.run({
    mode: mode(), ids: $('ids').value, matches: wantMatches, out: $('out').value.trim(),
    totals: wantTotals ? $('totals').value.trim() : '', aliases, bulk: $('bulk').value.trim(), maps: $('maps').value.trim(),
    download: $('download').checked, allModes: $('allModes').checked, delay,
  });
  if (res.error) { setRunning(false); status(res.error, 'bad'); return; }
  log(`$ ${res.command}\n`, 'cmd');
}

$('run').addEventListener('click', run);
$('stop').addEventListener('click', () => window.api.stop());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('run').disabled) { e.preventDefault(); run(); }
  if (e.key === 'Escape' && !$('importDialog').hidden) $('importDialog').hidden = true;
});

window.api.onLog(({ text, error }) => log(text, error || /error|could not|stopping|not in the bulk|needs|unknown|too big|failed/i.test(text) ? 'err' : ''));

window.api.onProgress(({ seen, total }) => {
  const pct = total ? Math.min(100, (100 * seen) / total) : 0;
  $('progressFill').style.width = `${pct}%`;
  const secs = (Date.now() - started) / 1000;
  const left = seen > 0 && seen < total ? Math.round((secs / seen) * (total - seen)) : null;
  status(`${fmt(seen)} / ${fmt(total)}${left !== null && secs > 3 ? ` · ${left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`} left` : ''}`);
});

window.api.onDone((r) => {
  setRunning(false);
  if (r.stopped) { status('Stopped.', 'bad'); log('\nstopped\n', 'err'); return; }
  if (r.code !== 0) { status(`Failed (exit code ${r.code}). See the log.`, 'bad'); showTab('logPane'); return; }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  tables.totals = { ...tables.totals, data: r.totalsData || null, file: r.totals };
  tables.matches = { ...tables.matches, data: r.matchData || null, file: r.out };
  $('totalsBadge').textContent = r.totalsData && !r.totalsData.error ? fmt(r.totalsData.total) : '';
  $('matchesBadge').textContent = r.matchData && !r.matchData.error ? fmt(r.matchData.total) : '';
  renderTable('totals');
  renderTable('matches');
  if (r.names) { seenNames = r.names; store.set('ctf-stats-seen', seenNames); renderSeen(); }
  status(`Done in ${secs}s.`, 'ok');
  showTab(r.totalsData ? 'totalsPane' : 'matchesPane');
});

// ================================================================ start

(async () => {
  const d = await window.api.defaults();
  const s = store.get(SAVED, {});
  for (const f of FIELDS) $(f).value = s[f] ?? d[f] ?? $(f).value;
  for (const c of CHECKS) $(c).checked = s[c] ?? $(c).checked;
  if (s.mode) document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
  if (s.format) document.querySelector(`input[name=format][value=${s.format}]`).checked = true;
  if (s.ids) $('ids').value = s.ids;

  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { updateMode(); saveForm(); }));
  document.querySelectorAll('input[name=format]').forEach((r) => r.addEventListener('change', applyFormat));
  $('download').addEventListener('change', () => { updateMode(); saveForm(); });
  for (const c of ['wantMatches', 'wantTotals']) $(c).addEventListener('change', () => { updateOutputs(); saveForm(); });
  $('ids').addEventListener('input', debounce(() => { updateIds(); saveForm(); }, 150));
  $('bulk').addEventListener('input', debounce(() => { checkCoverage(); saveForm(); }, 300));
  $('delay').addEventListener('input', debounce(() => { checkCoverage(); saveForm(); }, 300));
  for (const f of ['maps', 'out', 'totals']) $(f).addEventListener('change', saveForm);
  for (const c of ['allModes', 'useNames']) $(c).addEventListener('change', saveForm);

  updateMode();
  updateOutputs();
  updateIds();
  updateNamesSummary();
  renderPeople();
  renderSeen();
  renderTable('totals');
  renderTable('matches');
})();
