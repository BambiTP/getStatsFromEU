// Desktop app (Electron): opens the window and shows the system's file dialogs. The work is in core.js.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const core = require('./core');

let mainWindow = null;
let currentRun = null;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 900,
    title: 'TagPro CTF Stats',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => {
  if (currentRun) currentRun.child.kill();
  app.quit();
});

// kind: 'open' (an existing file), 'open-many' (one or more; gives a list) or 'save' (a file to write).
// Only the path is passed around, so the size of the file doesn't matter here.
ipcMain.handle('choose-file', async (event, kind, title, currentPath, extensions) => {
  const filters = [{ name: extensions.join(' / ').toUpperCase(), extensions }, { name: 'All files', extensions: ['*'] }];
  if (kind === 'save') {
    const result = await dialog.showSaveDialog(mainWindow, { title, defaultPath: currentPath, filters });
    return result.canceled ? null : result.filePath;
  }
  const many = kind === 'open-many';
  const result = await dialog.showOpenDialog(mainWindow, { title, defaultPath: currentPath || undefined, filters, properties: many ? ['openFile', 'multiSelections'] : ['openFile'] });
  if (result.canceled) return null;
  return many ? result.filePaths : result.filePaths[0];
});

ipcMain.handle('open-file', (event, filePath) => shell.openPath(filePath));
ipcMain.handle('download-maps', (event, filePath) => core.downloadMaps(filePath));

// every run's log is kept as a text file in the logs folder (the newest 50)
const logsFolder = () => path.join(app.getPath('userData'), 'logs');

function saveRunLog(command, text) {
  try {
    fs.mkdirSync(logsFolder(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(logsFolder(), `run-${stamp}.txt`), '$ ' + command + '\n' + text);
    const old = fs.readdirSync(logsFolder()).filter((f) => /^run-.*\.txt$/.test(f)).sort().slice(0, -50);
    for (const f of old) fs.rmSync(path.join(logsFolder(), f), { force: true });
  } catch (error) {
    console.error('could not save the log: ' + error.message);
  }
}

ipcMain.handle('start-run', (event, options) => {
  if (currentRun) return { error: 'A run is already going.' };
  let logText = '';
  currentRun = core.startRun(options, (type, data) => {
    if (type === 'log') logText += data.text;
    if (type === 'done') {
      saveRunLog(currentRun.command, logText);
      currentRun = null;
    }
    // the window may be gone (closed during a run)
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('run-event', type, data);
  });
  return { command: currentRun.command };
});

ipcMain.handle('open-logs-folder', () => {
  fs.mkdirSync(logsFolder(), { recursive: true });
  return shell.openPath(logsFolder());
});

ipcMain.handle('save-text', (event, filePath, text) => fs.promises.writeFile(filePath, text));

ipcMain.handle('stop-run', () => {
  if (currentRun) currentRun.child.kill();
});
