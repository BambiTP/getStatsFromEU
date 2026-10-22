// Browser version: gives app.js the same window.backend the desktop app gets from preload.js,
// talking to server.js instead. In the desktop app window.backend already exists and this does nothing.
if (!window.backend) {
  const postJson = async (url, data) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return response.json();
  };

  // the file picker: a <dialog> listing the server computer's folders and files
  const chooseFile = (kind, title, currentPath) => new Promise((resolve) => {
    const dialog = document.getElementById('file-picker-dialog');
    const folderText = document.getElementById('file-picker-folder');
    const list = document.getElementById('file-picker-list');
    const nameInput = document.getElementById('file-picker-name');
    const okButton = document.getElementById('file-picker-ok-button');
    const cancelButton = document.getElementById('file-picker-cancel-button');
    let currentFolder = null;
    let separator = '/';

    const finish = (chosenPath) => {
      okButton.onclick = null;
      cancelButton.onclick = null;
      dialog.close();
      resolve(chosenPath);
    };

    const addListItem = (label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = onClick;
      const item = document.createElement('li');
      item.append(button);
      list.append(item);
    };

    const showFolder = async (folder) => {
      const listing = await postJson('/api/list-folder', { folder });
      if (listing.error) { folderText.textContent = listing.error; return; }
      currentFolder = listing.folder;
      separator = listing.separator;
      folderText.textContent = 'Folder: ' + listing.folder;
      list.textContent = '';
      if (listing.parent) addListItem('.. (up one folder)', () => showFolder(listing.parent));
      for (const name of listing.folders) addListItem(name + separator, () => showFolder(listing.folder + separator + name));
      for (const name of listing.files) addListItem(name, () => { nameInput.value = name; });
    };

    document.getElementById('file-picker-title').textContent = title;
    nameInput.value = currentPath ? currentPath.split(/[\\/]/).pop() : '';
    okButton.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const isFullPath = name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name);   // /home/... or C:\...
      finish(isFullPath ? name : currentFolder + separator + name);
    };
    cancelButton.onclick = () => finish(null);
    dialog.showModal();
    const startFolder = currentPath ? currentPath.slice(0, Math.max(currentPath.lastIndexOf('/'), currentPath.lastIndexOf('\\'))) : '';
    showFolder(startFolder).catch(() => showFolder(''));
  });

  // run events from the server (the first one, 'state', tells a newly opened page about the current or
  // last run). Events that arrive before app.js is listening are kept and handed over when it starts.
  const eventHandlers = [];
  const earlyEvents = [];
  const events = new EventSource('/api/events');
  for (const type of ['state', 'started', 'log', 'progress', 'done']) {
    events.addEventListener(type, (event) => {
      const data = JSON.parse(event.data);
      if (eventHandlers.length === 0) earlyEvents.push([type, data]);
      for (const handler of eventHandlers) handler(type, data);
    });
  }

  window.backend = {
    isBrowser: true,
    defaultPaths: () => fetch('/api/default-paths').then((response) => response.json()),
    chooseFile,
    openFile: (filePath) => { window.location.href = '/api/download?path=' + encodeURIComponent(filePath); },
    startRun: (options) => postJson('/api/start-run', options),
    stopRun: () => postJson('/api/stop-run', {}),
    onRunEvent: (handler) => {
      eventHandlers.push(handler);
      for (const [type, data] of earlyEvents.splice(0)) handler(type, data);
    },
  };
}
