// Electron main process: the window, file dialogs, running fetch-ctf-stats.js, reading its results.
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');            // the tagpro-stats folder
const SCRIPT = path.join(ROOT, 'fetch-ctf-stats.js');
const MIRROR = path.join(os.homedir(), 'tagpro.eu');
const MATCH_ROWS = 5000;                            // per-match rows sent to the window (totals: all)

let win = null;
let child = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'TagPro CTF Stats',
    backgroundColor: '#14171c',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (child) child.kill(); app.quit(); });

ipcMain.handle('defaults', () => ({
  bulk: MIRROR,
  maps: path.join(MIRROR, 'maps.json'),
  out: path.join(ROOT, 'ctf_stats.csv'),
  totals: path.join(ROOT, 'ctf_totals.csv'),
}));

// kind: 'file' | 'folder' | 'save'
ipcMain.handle('pick', async (_e, { kind, title, current, filters }) => {
  const defaultPath = current || os.homedir();
  if (kind === 'save') {
    const r = await dialog.showSaveDialog(win, { title, defaultPath, filters });
    return r.canceled ? null : r.filePath;
  }
  const r = await dialog.showOpenDialog(win, {
    title, defaultPath, filters: kind === 'file' ? filters : undefined,
    properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('read-text', (_e, p) => {
  if (fs.statSync(p).size > 50e6) throw new Error('file is over 50 MB');
  return fs.readFileSync(p, 'utf8');
});
ipcMain.handle('write-text', (_e, p, text) => { fs.writeFileSync(p, text); return true; });
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(text); return true; });
ipcMain.handle('paste', () => clipboard.readText());
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('stop', () => { if (child) child.kill(); return !!child; });

// how many of the wanted ids (merged [first, last] ranges) the bulk files cover
ipcMain.handle('coverage', (_e, where, ranges) => {
  try {
    let files = [];
    const stat = fs.statSync(where);
    const fromName = (p) => {
      const m = path.basename(p).match(/_(\d+)_(\d+)\.json(\.gz)?$/);
      return m ? [Number(m[1]), Number(m[2])] : null;
    };
    if (stat.isFile()) {
      const r = fromName(where);
      if (!r) return { known: false };
      files = [r];
    } else if (fs.existsSync(path.join(where, 'manifest.json'))) {
      // a file fetched for a range past tagpro.eu's newest match holds fewer matches than its range:
      // ids there are consecutive, so its real end is first + matches - 1
      files = JSON.parse(fs.readFileSync(path.join(where, 'manifest.json'), 'utf8')).files
        .filter((f) => f.matches !== 0)
        .map((f) => [f.first, f.matches && f.matches < 0.9 * (f.last - f.first + 1) ? f.first + f.matches - 1 : f.last]);
    } else {
      const walk = (dir, depth) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory() && depth < 3) walk(p, depth + 1);
          const r = fromName(p);
          if (r) files.push(r);
        }
      };
      walk(where, 0);
    }
    const covered = merge(files);
    let total = 0, inside = 0;
    for (const [a, b] of ranges) {
      total += b - a + 1;
      for (const [c, d] of covered) inside += Math.max(0, Math.min(b, d) - Math.max(a, c) + 1);
    }
    return { known: true, total, inside, last: covered.length ? covered[covered.length - 1][1] : null };
  } catch (err) {
    return { known: false, error: err.message };
  }
});

function merge(ranges) {
  const s = ranges.slice().sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

// runs the script; log lines go to the window as 'log', progress as 'progress', the end as 'done'
ipcMain.handle('run', (_e, o) => {
  if (child) return { error: 'already running' };
  const tag = `${process.pid}-${Date.now()}`;
  const idsFile = path.join(os.tmpdir(), `ctf-stats-ids-${tag}.txt`);
  fs.writeFileSync(idsFile, o.ids);
  const temp = [idsFile];
  const args = [SCRIPT, o.mode, '--ids', idsFile];
  if (o.matches) args.push('--out', o.out); else args.push('--no-matches');
  if (o.totals) args.push('--totals', o.totals);
  if (o.aliases && o.aliases.length) {
    const aliasFile = path.join(os.tmpdir(), `ctf-stats-aliases-${tag}.json`);
    fs.writeFileSync(aliasFile, JSON.stringify(o.aliases));
    temp.push(aliasFile);
    args.push('--aliases', aliasFile);
  }
  if (o.allModes) args.push('--all-modes');
  if (o.mode === 'bulk') {
    if (o.bulk) args.push('--bulk', o.bulk);
    if (o.maps) args.push('--maps', o.maps);
    if (o.download) args.push('--download');
  }
  if (o.mode === 'site' || o.download) args.push('--delay', String(o.delay));

  // Electron's own Node runs the script, so no separate Node install is needed
  child = spawn(process.execPath, args, {
    cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CTF_PROGRESS: '1' },
  });
  let pending = '';
  child.stdout.on('data', (b) => win?.webContents.send('log', { text: b.toString() }));
  child.stderr.on('data', (b) => {
    pending += b.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    const text = [];
    for (const line of lines) {
      const p = line.match(/^@progress (\d+) (\d+)$/);
      if (p) win?.webContents.send('progress', { seen: Number(p[1]), total: Number(p[2]) });
      else text.push(line);
    }
    if (text.length) win?.webContents.send('log', { text: text.join('\n') + '\n' });
  });
  child.on('error', (err) => win?.webContents.send('log', { text: `${err.message}\n`, error: true }));
  child.on('close', (code, signal) => {
    child = null;
    if (pending) win?.webContents.send('log', { text: pending + '\n' });
    for (const f of temp) fs.rm(f, { force: true }, () => {});
    const r = { code, stopped: signal === 'SIGTERM', out: o.matches ? o.out : null, totals: o.totals || null };
    if (code === 0) {
      if (r.out) r.matchData = readTable(r.out, MATCH_ROWS);
      if (r.totals) r.totalsData = readTable(r.totals, Infinity);
      r.names = namesSeen(r);
    }
    win?.webContents.send('done', r);
  });
  const shown = args.slice(1).map((a) => (temp.includes(a) ? '<temp file>' : /\s/.test(a) ? `"${a}"` : a));
  return { started: true, command: ['node fetch-ctf-stats.js', ...shown].join(' ') };
});

// every name a player used in this run, for the names editor
function namesSeen(r) {
  const names = new Set();
  const t = r.totalsData;
  if (t && !t.error) {
    const ni = t.cols.indexOf('names'), pi = t.cols.indexOf('player');
    for (const row of t.rows) {
      if (ni >= 0 && row[ni]) String(row[ni]).split(' / ').forEach((n) => names.add(n));
      else if (pi >= 0) names.add(row[pi]);
    }
  } else if (r.out) {
    const all = readTable(r.out, Infinity);
    const i = all.cols ? all.cols.indexOf('played_as') : -1;
    if (i >= 0) for (const row of all.rows) names.add(row[i]);
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// a CSV or JSON output file as { cols, rows, total }, at most `limit` rows
function readTable(file, limit) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      const rows = JSON.parse(text);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return { cols, rows: rows.slice(0, limit).map((r) => cols.map((c) => r[c])), total: rows.length };
    }
    let total = -1, cut = -1;
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
      total++;
      if (total === limit) cut = at;
    }
    if (text.length && !text.endsWith('\n')) total++;
    const lines = parseCsv(cut >= 0 ? text.slice(0, cut + 1) : text);
    const cols = lines.shift() || [];
    const rows = lines.map((r) => r.map((v) => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)));
    return { cols, rows, total: Math.max(total, rows.length) };
  } catch (err) {
    return { error: err.message };
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
