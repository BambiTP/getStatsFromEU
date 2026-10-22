// Shared by the desktop app (main.js) and the browser version (server.js):
// running fetch-ctf-stats.js on a bulk file and reading back the results.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'fetch-ctf-stats.js');
const PREVIEW_ROWS = 200;

function defaultPaths() {
  const mirror = path.join(os.homedir(), 'tagpro.eu');
  return {
    bulkFile: '',
    mapsFile: path.join(mirror, 'maps.json'),
    perMatchFile: path.join(ROOT, 'ctf_stats.csv'),
    combinedFile: path.join(ROOT, 'ctf_totals.csv'),
  };
}

// options: { bulkFile, mapsFile, selection: 'all' | 'range' | 'list', rangeFirst, rangeLast, idList,
//            perMatchFile, combinedFile, aliases: [{ main, alts }] }
// onEvent(type, data) gets 'log' { text }, 'progress' { seen, total } and 'done' { exitCode, stopped, ... }
function startRun(options, onEvent) {
  const tempFiles = [];
  const tempFile = (name, text) => {
    const file = path.join(os.tmpdir(), `ctf-stats-${process.pid}-${Date.now()}-${name}`);
    fs.writeFileSync(file, text);
    tempFiles.push(file);
    return file;
  };

  const args = [SCRIPT, 'bulk', '--bulk', options.bulkFile];
  if (options.mapsFile) args.push('--maps', options.mapsFile);
  if (options.selection === 'all') args.push('--all');
  else if (options.selection === 'range') args.push(`${options.rangeFirst}-${options.rangeLast}`);
  else args.push('--ids', tempFile('ids.txt', options.idList));
  if (options.perMatchFile) args.push('--out', options.perMatchFile);
  else args.push('--no-matches');
  if (options.combinedFile) args.push('--totals', options.combinedFile);
  if (options.aliases && options.aliases.length) args.push('--aliases', tempFile('aliases.json', JSON.stringify(options.aliases)));

  // process.execPath is Node (server) or Electron (desktop); ELECTRON_RUN_AS_NODE makes Electron act as Node
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CTF_PROGRESS: '1' },
  });

  let partialLine = '';
  child.stdout.on('data', (chunk) => onEvent('log', { text: chunk.toString() }));
  child.stderr.on('data', (chunk) => {
    const lines = (partialLine + chunk.toString()).split('\n');
    partialLine = lines.pop();
    for (const line of lines) {
      const progress = line.match(/^@progress (\d+) (\d+)$/);
      if (progress) onEvent('progress', { seen: Number(progress[1]), total: Number(progress[2]) });
      else onEvent('log', { text: line + '\n' });
    }
  });
  child.on('error', (error) => onEvent('log', { text: error.message + '\n' }));
  child.on('close', (exitCode, signal) => {
    if (partialLine) onEvent('log', { text: partialLine + '\n' });
    for (const file of tempFiles) fs.rm(file, { force: true }, () => {});
    const result = { exitCode, stopped: signal === 'SIGTERM', perMatchFile: options.perMatchFile, combinedFile: options.combinedFile };
    if (exitCode === 0) {
      if (options.perMatchFile) result.perMatch = readPreview(options.perMatchFile);
      if (options.combinedFile) result.combined = readPreview(options.combinedFile);
    }
    onEvent('done', result);
  });

  const shownArgs = args.slice(1).map((arg) => (tempFiles.includes(arg) ? '<temp file>' : arg));
  return { child, command: 'node fetch-ctf-stats.js ' + shownArgs.join(' ') };
}

// the first rows of a CSV or JSON results file: { columns, rows, totalRows }
function readPreview(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      const records = JSON.parse(text);
      const columns = records.length ? Object.keys(records[0]) : [];
      const rows = records.slice(0, PREVIEW_ROWS).map((record) => columns.map((column) => record[column]));
      return { columns, rows, totalRows: records.length };
    }
    const lines = text.split('\n').filter((line) => line !== '');
    const columns = splitCsvLine(lines[0] || '');
    const rows = lines.slice(1, PREVIEW_ROWS + 1).map(splitCsvLine);
    return { columns, rows, totalRows: Math.max(0, lines.length - 1) };
  } catch (error) {
    return { error: error.message };
  }
}

// one CSV line into cells ("quoted, values" allowed)
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

module.exports = { defaultPaths, startRun };
