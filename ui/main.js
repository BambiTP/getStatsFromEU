// Desktop app (Electron): opens the window and shows the system's file dialogs. The work is in core.js.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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

// kind: 'open' (an existing file) or 'save' (a file to write).
// Only the path is passed around, so the size of the file doesn't matter here.
ipcMain.handle('choose-file', async (event, kind, title, currentPath, extensions) => {
  const filters = [{ name: extensions.join(' / ').toUpperCase(), extensions }, { name: 'All files', extensions: ['*'] }];
  if (kind === 'save') {
    const result = await dialog.showSaveDialog(mainWindow, { title, defaultPath: currentPath, filters });
    return result.canceled ? null : result.filePath;
  }
  const result = await dialog.showOpenDialog(mainWindow, { title, defaultPath: currentPath || undefined, filters, properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-file', (event, filePath) => shell.openPath(filePath));
ipcMain.handle('download-maps', (event, filePath) => core.downloadMaps(filePath));

ipcMain.handle('start-run', (event, options) => {
  if (currentRun) return { error: 'A run is already going.' };
  currentRun = core.startRun(options, (type, data) => {
    if (type === 'done') currentRun = null;
    mainWindow.webContents.send('run-event', type, data);
  });
  return { command: currentRun.command };
});

ipcMain.handle('stop-run', () => {
  if (currentRun) currentRun.child.kill();
});
