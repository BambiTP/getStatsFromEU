// The only things the window can ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  defaults: () => ipcRenderer.invoke('defaults'),
  pick: (opts) => ipcRenderer.invoke('pick', opts),
  coverage: (where, ranges) => ipcRenderer.invoke('coverage', where, ranges),
  run: (opts) => ipcRenderer.invoke('run', opts),
  stop: () => ipcRenderer.invoke('stop'),
  readText: (p) => ipcRenderer.invoke('read-text', p),
  writeText: (p, text) => ipcRenderer.invoke('write-text', p, text),
  copy: (text) => ipcRenderer.invoke('copy', text),
  paste: () => ipcRenderer.invoke('paste'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  onLog: (fn) => ipcRenderer.on('log', (_e, msg) => fn(msg)),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, msg) => fn(msg)),
  onDone: (fn) => ipcRenderer.on('done', (_e, msg) => fn(msg)),
});
