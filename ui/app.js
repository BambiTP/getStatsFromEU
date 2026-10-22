// The page: reads the form, starts runs, shows the log and results, and edits the names list.
// window.backend comes from preload.js (desktop app) or web-api.js (browser version).

const byId = (id) => document.getElementById(id);
const SETTINGS_KEY = 'ctf-stats-settings';
const NAMES_KEY = 'ctf-stats-names';

let lastResult = null;

// ---------------------------------------------------------------- saved settings

const SAVED_INPUTS = ['bulk-file-path', 'maps-file-path', 'range-first-id', 'range-last-id', 'match-id-list',
  'output-format', 'per-match-file-path', 'combined-file-path'];
const SAVED_CHECKBOXES = ['write-per-match-checkbox', 'write-combined-checkbox', 'combine-names-checkbox'];

function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function saveSettings() {
  const settings = { matchSelection: selectedMatchSelection() };
  for (const id of SAVED_INPUTS) settings[id] = byId(id).value;
  for (const id of SAVED_CHECKBOXES) settings[id] = byId(id).checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function loadSettings() {
  const defaults = await window.backend.defaultPaths();
  const settings = readSaved(SETTINGS_KEY, {});
  byId('bulk-file-path').value = defaults.bulkFile;
  byId('maps-file-path').value = defaults.mapsFile;
  byId('per-match-file-path').value = defaults.perMatchFile;
  byId('combined-file-path').value = defaults.combinedFile;
  for (const id of SAVED_INPUTS) if (settings[id] !== undefined) byId(id).value = settings[id];
  for (const id of SAVED_CHECKBOXES) if (settings[id] !== undefined) byId(id).checked = settings[id];
  if (settings.matchSelection) document.querySelector(`input[name="match-selection"][value="${settings.matchSelection}"]`).checked = true;
}

const selectedMatchSelection = () => document.querySelector('input[name="match-selection"]:checked').value;

// ---------------------------------------------------------------- choosing files

async function chooseFileInto(inputId, kind, title) {
  const chosen = await window.backend.chooseFile(kind, title, byId(inputId).value);
  if (chosen) {
    byId(inputId).value = chosen;
    saveSettings();
  }
}

byId('choose-bulk-file-button').onclick = () => chooseFileInto('bulk-file-path', 'open', 'Choose a bulk match file');
byId('choose-maps-file-button').onclick = () => chooseFileInto('maps-file-path', 'open', 'Choose the maps file');
byId('choose-per-match-file-button').onclick = () => chooseFileInto('per-match-file-path', 'save', 'Save per-match stats as');
byId('choose-combined-file-button').onclick = () => chooseFileInto('combined-file-path', 'save', 'Save combined stats as');

// changing CSV/JSON changes both output file endings
byId('output-format').onchange = () => {
  const ending = '.' + byId('output-format').value;
  for (const id of ['per-match-file-path', 'combined-file-path']) {
    byId(id).value = byId(id).value.replace(/\.(csv|json)$/i, '') + ending;
  }
  saveSettings();
};

// ---------------------------------------------------------------- names list

let players = readSaved(NAMES_KEY, []);

function saveNames() {
  localStorage.setItem(NAMES_KEY, JSON.stringify(players));
}

function showNames() {
  const tableBody = byId('names-table-body');
  tableBody.textContent = '';
  players.forEach((player, index) => {
    const mainInput = document.createElement('input');
    mainInput.type = 'text';
    mainInput.value = player.main;
    mainInput.oninput = () => { player.main = mainInput.value; saveNames(); };

    const altsInput = document.createElement('input');
    altsInput.type = 'text';
    altsInput.value = player.alts.join(', ');
    altsInput.oninput = () => { player.alts = splitNames(altsInput.value); saveNames(); };

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.onclick = () => { players.splice(index, 1); saveNames(); showNames(); };

    const row = tableBody.insertRow();
    row.insertCell().append(mainInput);
    row.insertCell().append(altsInput);
    row.insertCell().append(removeButton);
  });
}

const splitNames = (text) => text.split(',').map((name) => name.trim()).filter((name) => name !== '');

byId('add-player-button').onclick = () => {
  players.push({ main: '', alts: [] });
  saveNames();
  showNames();
  byId('names-table-body').lastElementChild.querySelector('input').focus();
};

byId('export-names-button').onclick = () => {
  byId('names-text').value = players
    .filter((player) => player.main.trim() !== '')
    .map((player) => player.main + ': ' + player.alts.join(', '))
    .join('\n');
};

byId('copy-names-button').onclick = () => {
  byId('names-text').select();
  document.execCommand('copy');
  byId('status-text').textContent = 'Names text copied.';
};

// "Main: alt, alt" lines; a main name already in the list gets the alts added to it
byId('import-names-button').onclick = () => {
  let added = 0;
  for (const line of byId('names-text').value.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const main = line.slice(0, colon).trim();
    const alts = splitNames(line.slice(colon + 1));
    const existing = players.find((player) => player.main.toLowerCase() === main.toLowerCase());
    if (existing) {
      for (const alt of alts) if (!existing.alts.includes(alt)) existing.alts.push(alt);
    } else {
      players.push({ main, alts });
      added++;
    }
  }
  saveNames();
  showNames();
  byId('status-text').textContent = `Imported: ${added} new player(s).`;
};

// ---------------------------------------------------------------- running

function setRunning(running) {
  byId('run-button').disabled = running;
  byId('stop-button').disabled = !running;
}

function addToLog(text) {
  const log = byId('log-output');
  log.textContent += text;
  log.scrollTop = log.scrollHeight;
}

byId('run-button').onclick = async () => {
  const options = {
    bulkFile: byId('bulk-file-path').value.trim(),
    mapsFile: byId('maps-file-path').value.trim(),
    selection: selectedMatchSelection(),
    rangeFirst: byId('range-first-id').value,
    rangeLast: byId('range-last-id').value,
    idList: byId('match-id-list').value,
    perMatchFile: byId('write-per-match-checkbox').checked ? byId('per-match-file-path').value.trim() : '',
    combinedFile: byId('write-combined-checkbox').checked ? byId('combined-file-path').value.trim() : '',
    aliases: byId('combine-names-checkbox').checked ? players.filter((player) => player.main.trim() && player.alts.length) : [],
  };

  let problem = '';
  if (!options.bulkFile) problem = 'Choose a bulk file first.';
  else if (options.selection === 'range' && (options.rangeFirst === '' || options.rangeLast === '')) problem = 'Fill in both ends of the range.';
  else if (options.selection === 'list' && !options.idList.trim()) problem = 'Type or paste some match ids.';
  else if (!options.perMatchFile && !options.combinedFile) problem = 'Tick at least one output.';
  if (problem) { byId('status-text').textContent = problem; return; }

  saveSettings();
  byId('log-output').textContent = '';
  const answer = await window.backend.startRun(options);
  if (answer.error) { byId('status-text').textContent = answer.error; return; }
  if (!byId('log-output').textContent.startsWith('$ ')) addToLog('$ ' + answer.command + '\n');
  setRunning(true);
  byId('status-text').textContent = 'Running…';
};

byId('stop-button').onclick = () => window.backend.stopRun();

window.backend.onRunEvent((type, data) => {
  if (type === 'log') addToLog(data.text);
  else if (type === 'progress') {
    byId('status-text').textContent = data.total ? `Running… ${data.seen} of ${data.total} matches` : `Running… ${data.seen} matches read`;
  } else if (type === 'started') {
    // browser version: the server started a run (from this page or another one)
    byId('log-output').textContent = '$ ' + data.command + '\n';
    setRunning(true);
    byId('status-text').textContent = 'Running…';
  } else if (type === 'state') {
    // browser version: the page was opened during or after a run
    if (data.command) byId('log-output').textContent = '$ ' + data.command + '\n' + data.log;
    if (data.running) { setRunning(true); byId('status-text').textContent = 'Running…'; }
    else if (data.lastResult) showResult(data.lastResult);
  } else if (type === 'done') showResult(data);
});

// ---------------------------------------------------------------- results

function showResult(result) {
  setRunning(false);
  lastResult = result;
  if (result.stopped) byId('status-text').textContent = 'Stopped.';
  else if (result.exitCode !== 0) byId('status-text').textContent = 'Failed. See the log.';
  else byId('status-text').textContent = 'Done.';
  // show whichever output this run wrote, if the chosen one wasn't written
  if (!result[byId('results-choice').value]) byId('results-choice').value = result.combined ? 'combined' : 'perMatch';
  showResultsTable();
}

function showResultsTable() {
  const holder = byId('results-table-holder');
  holder.textContent = '';
  byId('results-summary').textContent = '';
  byId('open-results-button').disabled = true;
  if (!lastResult) return;
  const preview = lastResult[byId('results-choice').value];
  if (!preview) return;
  if (preview.error) { holder.textContent = preview.error; return; }

  byId('open-results-button').disabled = false;
  byId('open-results-button').textContent = window.backend.isBrowser ? 'Download file' : 'Open file';
  byId('results-summary').textContent = preview.totalRows > preview.rows.length
    ? `First ${preview.rows.length} of ${preview.totalRows} rows`
    : `${preview.totalRows} rows`;

  const table = document.createElement('table');
  const headerRow = table.createTHead().insertRow();
  for (const column of preview.columns) {
    const headerCell = document.createElement('th');
    headerCell.textContent = column;
    headerRow.append(headerCell);
  }
  const body = table.createTBody();
  for (const values of preview.rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value ?? '';
  }
  holder.append(table);
}

byId('results-choice').onchange = showResultsTable;
byId('open-results-button').onclick = () => {
  const file = byId('results-choice').value === 'combined' ? lastResult.combinedFile : lastResult.perMatchFile;
  window.backend.openFile(file);
};

// ---------------------------------------------------------------- start

for (const id of SAVED_INPUTS) byId(id).addEventListener('change', saveSettings);
for (const id of SAVED_CHECKBOXES) byId(id).addEventListener('change', saveSettings);
for (const radio of document.querySelectorAll('input[name="match-selection"]')) radio.addEventListener('change', saveSettings);
loadSettings();
showNames();
