// Browser version: serves the page and runs the stats script. Start it with: node ui/server.js
// Then open http://localhost:8097 in a browser.
// HOST and PORT can be changed, e.g. HOST=100.x.x.x for a Tailscale address. Anyone who can reach
// the address can read files and run the script on this computer, so never use a public address.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./core');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8097);
const PAGE_FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/web-api.js': 'web-api.js' };
const CONTENT_TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

// the current run, and what a page opened later needs to catch up
let currentRun = null;
const runState = { running: false, command: '', log: '', lastResult: null };
const eventListeners = new Set();

function sendEventToPages(type, data) {
  for (const response of eventListeners) response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startRun(options) {
  if (currentRun) return { error: 'A run is already going.' };
  runState.running = true;
  runState.log = '';
  currentRun = core.startRun(options, (type, data) => {
    if (type === 'log') runState.log = (runState.log + data.text).slice(-200000);
    if (type === 'done') {
      currentRun = null;
      runState.running = false;
      runState.lastResult = data;
    }
    sendEventToPages(type, data);
  });
  runState.command = currentRun.command;
  sendEventToPages('started', { command: currentRun.command });
  return { command: currentRun.command };
}

// a folder's contents, for the file picker
function listFolder(folderPath) {
  const folder = path.resolve(folderPath || os.homedir());
  const folders = [];
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    let isFolder = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try { isFolder = fs.statSync(path.join(folder, entry.name)).isDirectory(); } catch { continue; }
    }
    (isFolder ? folders : files).push(entry.name);
  }
  folders.sort();
  files.sort();
  const parent = path.dirname(folder);
  return { folder, parent: parent === folder ? null : parent, folders, files, separator: path.sep };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (request.method === 'GET' && PAGE_FILES[url.pathname]) {
      const file = path.join(__dirname, PAGE_FILES[url.pathname]);
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] });
      response.end(fs.readFileSync(file));
    } else if (request.method === 'GET' && url.pathname === '/api/default-paths') {
      sendJson(response, 200, core.defaultPaths());
    } else if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write(`event: state\ndata: ${JSON.stringify(runState)}\n\n`);
      eventListeners.add(response);
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25000);
      request.on('close', () => { clearInterval(keepAlive); eventListeners.delete(response); });
    } else if (request.method === 'GET' && url.pathname === '/api/download') {
      const file = url.searchParams.get('path');
      response.writeHead(200, { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` });
      fs.createReadStream(file).on('error', () => response.end()).pipe(response);
    } else if (request.method === 'POST' && url.pathname === '/api/list-folder') {
      sendJson(response, 200, listFolder((await readJsonBody(request)).folder));
    } else if (request.method === 'POST' && url.pathname === '/api/start-run') {
      sendJson(response, 200, startRun(await readJsonBody(request)));
    } else if (request.method === 'POST' && url.pathname === '/api/stop-run') {
      if (currentRun) currentRun.child.kill();
      sendJson(response, 200, {});
    } else {
      sendJson(response, 404, { error: 'not found' });
    }
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`TagPro CTF Stats: open http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
