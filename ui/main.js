// Electron main process: the window, the file dialogs, and running fetch-ctf-stats.js.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');            // the tagpro-stats folder
const SCRIPT = path.join(ROOT, 'fetch-ctf-stats.js');
const MIRROR = path.join(os.homedir(), 'tagpro.eu');

let win = null;
let child = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'TagPro CTF Stats',
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
  totals: '',
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
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('stop', () => { if (child) child.kill(); return !!child; });

// runs the script; log lines go to the window as 'log' events, the end as a 'done' event
ipcMain.handle('run', (_e, o) => {
  if (child) return { error: 'already running' };
  const idsFile = path.join(os.tmpdir(), `ctf-stats-ids-${process.pid}.txt`);
  fs.writeFileSync(idsFile, o.ids);
  const args = [SCRIPT, o.mode, '--ids', idsFile, '--out', o.out];
  if (o.totals) args.push('--totals', o.totals);
  if (o.allModes) args.push('--all-modes');
  if (o.mode === 'bulk') {
    if (o.bulk) args.push('--bulk', o.bulk);
    if (o.maps) args.push('--maps', o.maps);
    if (o.download) args.push('--download');
  }
  if (o.mode === 'site' || o.download) args.push('--delay', String(o.delay));

  // Electron's own Node runs the script, so no separate Node install is needed
  child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const send = (stream) => (buf) => win?.webContents.send('log', { stream, text: buf.toString() });
  child.stdout.on('data', send('out'));
  child.stderr.on('data', send('err'));
  child.on('error', (err) => win?.webContents.send('log', { stream: 'err', text: `${err.message}\n` }));
  child.on('close', (code, signal) => {
    child = null;
    fs.rm(idsFile, { force: true }, () => {});
    const result = { code, stopped: signal === 'SIGTERM', out: o.out, totals: o.totals || null };
    if (code === 0) {
      result.preview = preview(o.out);
      if (o.totals) result.totalsPreview = preview(o.totals);
    }
    win?.webContents.send('done', result);
  });
  return { started: true, command: ['node', ...args.slice(0, 2).map((a) => path.relative(ROOT, a) || a), ...args.slice(2)].join(' ') };
});

// the first rows of a CSV or JSON output file
function preview(file, limit = 200) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      const rows = JSON.parse(text);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return { cols, rows: rows.slice(0, limit).map((r) => cols.map((c) => r[c])), total: rows.length };
    }
    // count the rows, but only parse the first ones (outputs can be hundreds of MB)
    let total = -1, cut = -1;
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
      total++;
      if (total === limit) cut = at;
    }
    if (text.length && !text.endsWith('\n')) total++;
    const lines = parseCsv(cut >= 0 ? text.slice(0, cut + 1) : text);
    const cols = lines.shift() || [];
    return { cols, rows: lines.slice(0, limit), total: Math.max(total, lines.length) };
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
