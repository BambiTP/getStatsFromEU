// The window: reads the form, asks the main process to run the script, shows log and results.
const $ = (id) => document.getElementById(id);
const FIELDS = ['bulk', 'maps', 'out', 'totals', 'delay'];
const CHECKS = ['download', 'allModes'];
const SAVED = 'ctf-stats-ui';

let lastResult = null;

// ---------------------------------------------------------------- settings remembered between runs

function load() {
  try { return JSON.parse(localStorage.getItem(SAVED)) || {}; } catch { return {}; }
}
function save() {
  const s = { mode: mode(), ids: $('ids').value };
  for (const f of FIELDS) s[f] = $(f).value;
  for (const c of CHECKS) s[c] = $(c).checked;
  try { localStorage.setItem(SAVED, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const mode = () => document.querySelector('input[name=mode]:checked').value;

// ---------------------------------------------------------------- match id counting (same rules as the script)

function countIds(text) {
  const ids = new Set();
  for (const tok of text.replace(/[?&]match=/g, ' ').split(/[\s,;]+/)) {
    const range = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b) [a, b] = [b, a];
      if (b - a > 5e6) return { error: `range ${tok} is too big` };
      for (let i = a; i <= b; i++) ids.add(i);
    } else if (/^\d+$/.test(tok)) ids.add(Number(tok));
    else if (tok) {
      const id = tok.match(/(\d{3,})/);
      if (id) ids.add(Number(id[1]));
    }
  }
  return { n: ids.size };
}

function updateCount() {
  const c = countIds($('ids').value);
  const pill = $('idCount');
  pill.textContent = c.error ? c.error : `${c.n.toLocaleString()} match${c.n === 1 ? '' : 'es'}`;
  pill.classList.toggle('has', !c.error && c.n > 0);
  return c;
}

// ---------------------------------------------------------------- mode-dependent parts of the form

function updateMode() {
  const bulk = mode() === 'bulk';
  document.querySelectorAll('.bulk-only').forEach((el) => { el.style.display = bulk ? '' : 'none'; });
  document.querySelector('.delay-field').style.display = !bulk || $('download').checked ? '' : 'none';
  $('modeHelp').textContent = bulk
    ? 'Reads the matches from tagpro.eu bulk files on this computer (your mirror by default). Fast, no requests.'
    : 'Downloads each match from tagpro.eu on its own, one request at a time, and keeps a copy in the cache folder.';
}

// ---------------------------------------------------------------- file pickers

const FILTERS = {
  bulk: [{ name: 'Bulk match files', extensions: ['json', 'gz'] }, { name: 'All files', extensions: ['*'] }],
  maps: [{ name: 'JSON', extensions: ['json', 'gz'] }, { name: 'All files', extensions: ['*'] }],
  out: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }],
  totals: [{ name: 'CSV', extensions: ['csv'] }, { name: 'JSON', extensions: ['json'] }],
};
const TITLES = { bulk: 'Bulk match file or folder', maps: 'tagpro.eu maps file', out: 'Save stats as', totals: 'Save totals as' };

document.querySelectorAll('[data-pick]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const field = btn.dataset.pick;
    const picked = await window.api.pick({ kind: btn.dataset.kind, title: TITLES[field], current: $(field).value, filters: FILTERS[field] });
    if (picked) { $(field).value = picked; save(); }
  });
});

$('loadIds').addEventListener('click', async () => {
  const picked = await window.api.pick({ kind: 'file', title: 'File of match ids', filters: [{ name: 'Text', extensions: ['txt', 'csv', 'tsv'] }, { name: 'All files', extensions: ['*'] }] });
  if (!picked) return;
  let text;
  try { text = await window.api.readText(picked); } catch (err) { status(`Could not read ${picked}: ${err.message}`, 'bad'); return; }
  $('ids').value = $('ids').value.trim() ? `${$('ids').value.trim()}\n${text}` : text;
  updateCount(); save();
});
$('clearIds').addEventListener('click', () => { $('ids').value = ''; updateCount(); save(); });

// ---------------------------------------------------------------- tabs, log, tables

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === name));
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => !t.disabled && showTab(t.dataset.tab)));

function log(text, kind) {
  const el = $('log');
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  const span = document.createElement('span');
  if (kind) span.className = kind;
  span.textContent = text;
  el.appendChild(span);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function table(target, p, file) {
  const el = $(target);
  el.textContent = '';
  if (!p || p.error) { el.innerHTML = '<p></p>'; el.firstChild.textContent = `Could not read ${file}: ${p?.error || 'no data'}`; return; }
  const note = document.createElement('p');
  note.textContent = p.total > p.rows.length
    ? `First ${p.rows.length.toLocaleString()} of ${p.total.toLocaleString()} rows (${file}). Open the file for the rest.`
    : `${p.total.toLocaleString()} rows (${file}).`;
  el.appendChild(note);
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  for (const c of p.cols) { const th = document.createElement('th'); th.textContent = c; head.appendChild(th); }
  const body = t.createTBody();
  for (const r of p.rows) {
    const tr = body.insertRow();
    for (const v of r) tr.insertCell().textContent = v ?? '';
  }
  el.appendChild(t);
}

// ---------------------------------------------------------------- run / stop

function setRunning(on) {
  $('run').disabled = on;
  $('stop').disabled = !on;
  document.querySelectorAll('main input, main textarea, [data-pick], #loadIds, #clearIds').forEach((el) => { el.disabled = on; });
}

function status(text, kind) {
  $('status').textContent = text;
  $('status').className = `status ${kind || ''}`;
}

$('run').addEventListener('click', async () => {
  const c = updateCount();
  if (c.error) { status(c.error, 'bad'); return; }
  if (!c.n) { status('Paste some match ids first.', 'bad'); return; }
  if (!$('out').value.trim()) { status('Choose where to save the stats.', 'bad'); return; }
  const delay = Number($('delay').value) || 2000;
  if (mode() === 'site' && c.n > 500 && !confirm(`That is ${c.n.toLocaleString()} separate requests to tagpro.eu, about ${Math.round(c.n * delay / 60000)} minutes. Bulk mode is much faster if you have the bulk files. Go ahead?`)) return;
  save();
  $('log').textContent = '';
  ['stats', 'totalsTab'].forEach((id) => { $(id).textContent = ''; document.querySelector(`[data-tab=${id}]`).disabled = true; });
  $('openOut').disabled = $('showOut').disabled = true;
  showTab('log');
  setRunning(true);
  status('Running…');
  const res = await window.api.run({
    mode: mode(), ids: $('ids').value, out: $('out').value.trim(), totals: $('totals').value.trim(),
    bulk: $('bulk').value.trim(), maps: $('maps').value.trim(), download: $('download').checked,
    allModes: $('allModes').checked, delay,
  });
  if (res.error) { setRunning(false); status(res.error, 'bad'); return; }
  log(`$ ${res.command}\n`, 'cmd');
});

$('stop').addEventListener('click', () => window.api.stop());

window.api.onLog(({ stream, text }) => log(text, stream === 'err' && /error|could not|stopping|not in the bulk|needs|unknown|too big/i.test(text) ? 'err' : ''));

window.api.onDone((r) => {
  setRunning(false);
  lastResult = r;
  if (r.stopped) { status('Stopped.', 'bad'); log('\nstopped\n', 'err'); return; }
  if (r.code !== 0) { status(`Failed (exit code ${r.code}). See the log.`, 'bad'); return; }
  status('Done.', 'ok');
  $('openOut').disabled = $('showOut').disabled = false;
  table('stats', r.preview, r.out);
  document.querySelector('[data-tab=stats]').disabled = false;
  if (r.totals) { table('totalsTab', r.totalsPreview, r.totals); document.querySelector('[data-tab=totalsTab]').disabled = false; }
  showTab('stats');
});

$('openOut').addEventListener('click', () => lastResult && window.api.openPath(document.querySelector('.tab.active')?.dataset.tab === 'totalsTab' ? lastResult.totals : lastResult.out));
$('showOut').addEventListener('click', () => lastResult && window.api.showInFolder(document.querySelector('.tab.active')?.dataset.tab === 'totalsTab' ? lastResult.totals : lastResult.out));

// ---------------------------------------------------------------- start

(async () => {
  const d = await window.api.defaults();
  const s = load();
  for (const f of FIELDS) $(f).value = s[f] ?? d[f] ?? $(f).value;
  for (const c of CHECKS) $(c).checked = !!s[c];
  if (s.mode) document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
  if (s.ids) $('ids').value = s.ids;
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { updateMode(); save(); }));
  $('download').addEventListener('change', () => { updateMode(); save(); });
  $('ids').addEventListener('input', () => { updateCount(); save(); });
  for (const f of FIELDS) $(f).addEventListener('change', save);
  $('allModes').addEventListener('change', save);
  updateMode();
  updateCount();
})();
