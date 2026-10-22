// Desktop app: what the page (app.js) is allowed to ask the Electron main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backend', {
  isBrowser: false,
  defaultPaths: () => ipcRenderer.invoke('default-paths'),
  chooseFile: (kind, title, currentPath) => ipcRenderer.invoke('choose-file', kind, title, currentPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  startRun: (options) => ipcRenderer.invoke('start-run', options),
  stopRun: () => ipcRenderer.invoke('stop-run'),
  onRunEvent: (handler) => ipcRenderer.on('run-event', (event, type, data) => handler(type, data)),
});
