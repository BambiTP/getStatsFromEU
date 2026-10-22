// Runs fetch-ctf-stats.js for the desktop app (main.js) and reads back the results.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'fetch-ctf-stats.js');
const PREVIEW_ROWS = 200;

// options: {
//   source: 'bulk-file' | 'bulk-download' | 'individual',
//   bulkFile,                                    (bulk-file only)
//   mapsFile,                                    (both bulk sources; may be empty)
//   selection: 'all' | 'range' | 'list',         ('all' only with bulk-file)
//   rangeFirst, rangeLast, idList,
//   perMatchFile, combinedFile,                   (either may be empty, not both)
//   aliases: [{ main, alts }],
//   filters: [[{ column, op, value }, ...], ...]   (boxes of "and" conditions, "or" between boxes)
// }
// onEvent(type, data) gets 'log' { text }, 'progress' { seen, total } and 'done' { exitCode, stopped, ... }
function startRun(options, onEvent) {
  const tempFiles = [];
  const tempFile = (name, text) => {
    const file = path.join(os.tmpdir(), `ctf-stats-${process.pid}-${Date.now()}-${name}`);
    fs.writeFileSync(file, text);
    tempFiles.push(file);
    return file;
  };

  const args = [SCRIPT];
  if (options.source === 'individual') args.push('site');
  else if (options.source === 'bulk-download') args.push('bulk', '--download');
  else args.push('bulk', '--bulk', options.bulkFile);
  if (options.source !== 'individual' && options.mapsFile) args.push('--maps', options.mapsFile);
  if (options.selection === 'all') args.push('--all');
  else if (options.selection === 'range') args.push(`${options.rangeFirst}-${options.rangeLast}`);
  else args.push('--ids', tempFile('ids.txt', options.idList));
  if (options.perMatchFile) args.push('--out', options.perMatchFile);
  else args.push('--no-matches');
  if (options.combinedFile) args.push('--totals', options.combinedFile);
  if (options.aliases && options.aliases.length) args.push('--aliases', tempFile('aliases.json', JSON.stringify(options.aliases)));
  if (options.filters && options.filters.length) args.push('--filter', tempFile('filters.json', JSON.stringify(options.filters)));

  // process.execPath is Electron; ELECTRON_RUN_AS_NODE makes it run the script as plain Node
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

// the first rows of a results file, reading only its start (output files can be gigabytes):
// { columns, rows, totalRows }. JSON files are written one row per line, so they're read the same way.
function readPreview(file) {
  try {
    const lines = firstLines(file, PREVIEW_ROWS + 2);
    const totalLines = countLines(file);
    if (file.endsWith('.json')) {
      const records = lines.filter((line) => line.startsWith('{')).slice(0, PREVIEW_ROWS)
        .map((line) => JSON.parse(line.replace(/,$/, '')));
      const columns = records.length ? Object.keys(records[0]) : [];
      return { columns, rows: records.map((record) => columns.map((column) => record[column])), totalRows: Math.max(0, totalLines - 2) };
    }
    const columns = splitCsvLine(lines[0] || '');
    return { columns, rows: lines.slice(1, PREVIEW_ROWS + 1).map(splitCsvLine), totalRows: Math.max(0, totalLines - 1) };
  } catch (error) {
    return { error: error.message };
  }
}

function firstLines(file, howMany) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(4 << 20);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, length).split('\n').filter((line) => line !== '').slice(0, howMany);
  } finally {
    fs.closeSync(fd);
  }
}

function countLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(4 << 20);
    let count = 0, length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      for (let at = buffer.indexOf(10); at >= 0 && at < length; at = buffer.indexOf(10, at + 1)) count++;
    }
    return count;
  } finally {
    fs.closeSync(fd);
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

// downloads tagpro.eu's maps file (one request) to `file`; returns { maps } or { error }
async function downloadMaps(file) {
  try {
    const response = await fetch('https://tagpro.eu/data/?bulk=maps', {
      headers: { 'User-Agent': 'bambitp-ctf-stats/1.0 (one request at a time; see https://tagpro.eu/?science)' },
    });
    if (!response.ok) return { error: `tagpro.eu answered ${response.status}` };
    const text = await response.text();
    const maps = Object.keys(JSON.parse(text)).length;   // make sure it's really the maps file
    fs.writeFileSync(file, text);
    return { maps };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = { startRun, downloadMaps };
