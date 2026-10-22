// The page: reads the form, starts runs, shows the log and results, and edits the names list.
// window.backend comes from preload.js (the desktop app).

const byId = (id) => document.getElementById(id);
const SETTINGS_KEY = 'ctf-stats-settings';
const NAMES_KEY = 'ctf-stats-names';
const FILTERS_KEY = 'ctf-stats-filters';

let lastResult = null;

// ---------------------------------------------------------------- the form

const checkedValue = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const checkRadio = (name, value) => { document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true; };

// 'bulk-file', 'bulk-download' or 'individual'
function matchSource() {
  if (checkedValue('match-source') === 'individual') return 'individual';
  return checkedValue('bulk-source') === 'download' ? 'bulk-download' : 'bulk-file';
}

// show only the parts of the form that apply to the chosen source
function updateForm() {
  const source = matchSource();
  byId('bulk-options').hidden = source === 'individual';
  byId('bulk-file-options').hidden = source !== 'bulk-file';
  byId('bulk-download-hint').hidden = source !== 'bulk-download';
  byId('individual-hint').hidden = source !== 'individual';
  // "all matches" only makes sense for a bulk file
  byId('all-matches-option').hidden = source !== 'bulk-file';
  if (source !== 'bulk-file' && checkedValue('match-selection') === 'all') checkRadio('match-selection', 'range');
}

// ---------------------------------------------------------------- saved settings (this computer only)

const SAVED_INPUTS = ['bulk-file-path', 'maps-file-path', 'range-first-id', 'range-last-id', 'match-id-list',
  'output-format', 'per-match-file-path', 'combined-file-path'];
const SAVED_CHECKBOXES = ['write-per-match-checkbox', 'write-combined-checkbox', 'combine-names-checkbox'];
const SAVED_RADIOS = ['match-source', 'bulk-source', 'match-selection'];

function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function saveSettings() {
  const settings = {};
  for (const id of SAVED_INPUTS) settings[id] = byId(id).value;
  for (const id of SAVED_CHECKBOXES) settings[id] = byId(id).checked;
  for (const name of SAVED_RADIOS) settings[name] = checkedValue(name);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const settings = readSaved(SETTINGS_KEY, {});
  for (const id of SAVED_INPUTS) if (settings[id] !== undefined) byId(id).value = settings[id];
  for (const id of SAVED_CHECKBOXES) if (settings[id] !== undefined) byId(id).checked = settings[id];
  for (const name of SAVED_RADIOS) if (settings[name]) checkRadio(name, settings[name]);
}

// ---------------------------------------------------------------- choosing files

const outputEnding = () => byId('output-format').value;

async function chooseFileInto(inputId, kind, title, extensions, suggestedName) {
  const current = byId(inputId).value || suggestedName || '';
  const chosen = await window.backend.chooseFile(kind, title, current, extensions);
  if (chosen) {
    byId(inputId).value = chosen;
    saveSettings();
  }
}

// the bulk files: one path per line
const bulkFilePaths = () => byId('bulk-file-path').value.split('\n').map((line) => line.trim()).filter((line) => line !== '');

// adds the chosen files to the list (the browser version's picker gives one path, the desktop app's a list)
byId('choose-bulk-file-button').onclick = async () => {
  const current = bulkFilePaths();
  const chosen = await window.backend.chooseFile('open-many', 'Choose bulk match files', current[current.length - 1] || '', ['json', 'gz']);
  const added = (Array.isArray(chosen) ? chosen : chosen ? [chosen] : []).filter((file) => !current.includes(file));
  if (!added.length) return;
  byId('bulk-file-path').value = [...current, ...added].join('\n');
  saveSettings();
};
byId('choose-maps-file-button').onclick = () => chooseFileInto('maps-file-path', 'open', 'Choose the maps file', ['json']);

// saves tagpro.eu's maps file wherever the user chooses, then uses it
byId('download-maps-file-button').onclick = async () => {
  const where = await window.backend.chooseFile('save', 'Save the tagpro.eu maps file as', byId('maps-file-path').value || 'maps.json', ['json']);
  if (!where) return;
  byId('status-text').textContent = 'Downloading the maps file from tagpro.eu…';
  const answer = await window.backend.downloadMaps(where);
  if (answer.error) { byId('status-text').textContent = 'Maps download failed: ' + answer.error; return; }
  byId('maps-file-path').value = where;
  saveSettings();
  byId('status-text').textContent = `Maps file saved (${answer.maps} maps).`;
};
byId('choose-per-match-file-button').onclick = () => chooseFileInto('per-match-file-path', 'save', 'Save per-match stats as', [outputEnding()], 'ctf_stats.' + outputEnding());
byId('choose-combined-file-button').onclick = () => chooseFileInto('combined-file-path', 'save', 'Save combined stats as', [outputEnding()], 'ctf_totals.' + outputEnding());

// changing CSV/JSON changes the ending of output files already chosen
byId('output-format').onchange = () => {
  for (const id of ['per-match-file-path', 'combined-file-path']) {
    if (byId(id).value) byId(id).value = byId(id).value.replace(/\.(csv|json)$/i, '') + '.' + outputEnding();
  }
  saveSettings();
};

// ---------------------------------------------------------------- names list

let players = readSaved(NAMES_KEY, []);

function saveNames() {
  localStorage.setItem(NAMES_KEY, JSON.stringify(players));
  if (typeof showFilters === 'function' && byId('filter-groups').children.length) showFilters();   // Combine? buttons follow the list
}

const splitNames = (text) => text.split(',').map((name) => name.trim()).filter((name) => name !== '');

function showNames() {
  const tableBody = byId('names-table-body');
  tableBody.textContent = '';
  players.forEach((player, index) => {
    const mainInput = document.createElement('input');
    mainInput.type = 'text';
    mainInput.value = player.main;
    mainInput.placeholder = 'Main name';
    mainInput.oninput = () => { player.main = mainInput.value; saveNames(); };

    const altsInput = document.createElement('input');
    altsInput.type = 'text';
    altsInput.value = player.alts.join(', ');
    altsInput.placeholder = 'alt name, another alt';
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
  byId('names-table').hidden = players.length === 0;
}

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

// one line of bulk text -> [main, ...alts], or null for a blank line
function parseNamesLine(line) {
  const text = line.trim();
  if (!text) return null;
  const arrow = text.indexOf('->');
  const colon = text.indexOf(':');
  if (arrow > 0) return [text.slice(arrow + 2).trim(), ...splitNames(text.slice(0, arrow))];   // alt, alt -> Main
  if (colon > 0) return [text.slice(0, colon).trim(), ...splitNames(text.slice(colon + 1))];   // Main: alt, alt
  return splitNames(text);                                                                    // Main, alt, alt
}

// adds each line's names; if any of them is already a player's name, they all go to that player
byId('import-names-button').onclick = () => {
  let added = 0, merged = 0;
  for (const line of byId('names-text').value.split('\n')) {
    const names = parseNamesLine(line);
    if (!names || !names[0]) continue;
    const lower = names.map((name) => name.toLowerCase());
    const existing = players.find((player) => [player.main, ...player.alts].some((name) => lower.includes(name.toLowerCase())));
    if (existing) {
      for (const name of names) {
        const known = [existing.main, ...existing.alts].map((n) => n.toLowerCase());
        if (!known.includes(name.toLowerCase())) existing.alts.push(name);
      }
      merged++;
    } else {
      players.push({ main: names[0], alts: names.slice(1) });
      added++;
    }
  }
  saveNames();
  showNames();
  byId('status-text').textContent = `Names: ${added} new player(s), ${merged} added to existing players.`;
};

// ---------------------------------------------------------------- filters

// what a filter can look at: [column, label, kind]; kind decides the operators (yes/no columns are 1 or 0)
const FILTER_COLUMNS = {
  'The match': [
    ['mode', 'Mode (ctf, nf, other)', 'text'], ['group', 'Group game (yes/no)', 'yesno'],
    ['time_limit', 'Time limit (minutes)', 'number'], ['players_in_game', 'Players in the game (subs count)', 'number'],
    ['game_minutes', 'Game length (minutes)', 'number'], ['finished', 'Finished (yes/no)', 'yesno'],
    ['overtime', 'Went to overtime (yes/no)', 'yesno'], ['clutch_time', 'Had clutch time (yes/no)', 'yesno'],
    ['date', 'Date (YYYY-MM-DD)', 'text'], ['map', 'Map', 'text'], ['map_author', 'Map author', 'text'],
    ['server', 'Server (e.g. chicago2)', 'text'], ['match_id', 'Match id', 'number'],
    ['in_game', 'Players in the game (names)', 'list'],
  ],
  'The player': [
    ['player', 'Player', 'text'], ['played_as', 'Name used in that game', 'text'], ['auth', 'Registered name (yes/no)', 'yesno'],
    ['color', 'Color (red, blue)', 'text'], ['teammates', 'Teammates', 'list'], ['opponents', 'Opponents', 'list'],
    ['result', 'Result (W, L, T)', 'text'], ['minutes', 'Minutes played', 'number'],
    ['caps_for', 'Team caps', 'number'], ['caps_against', 'Caps against', 'number'], ['cap_diff', 'Cap difference', 'number'],
  ],
  'The player\'s stats': ['tags', 'pops', 'grabs', 'drops', 'captures', 'returns', 'hold', 'prevent', 'button', 'block',
    'pups', 'long_holds', 'flaccids', 'handoffs', 'good_handoffs', 'grabs_off_handoffs', 'grabs_off_regrabs',
    'caps_off_handoffs', 'caps_off_regrabs', 'ot_caps', 'quick_returns', 'key_returns', 'returns_in_base', 'saves',
    'tpr_key_returns', 'tpr_saves', 'nr_tags', 'nd_pops', 'kept_flags', 'league_hold', 'hold_against', 'score_pct', 'kd',
    'hold_per_grab', 'cpm', 'hold_pm', 'rpm', 'prevent_pm', 'score', 'oscore', 'dscore'].map((c) => [c, c, 'number']),
};
const FILTER_KINDS = Object.fromEntries(Object.values(FILTER_COLUMNS).flat().map(([column, , kind]) => [column, kind]));
const OPERATORS = {
  number: ['=', '!=', '<', '<=', '>', '>=', 'one of'],
  yesno: ['='],
  text: ['=', '!=', 'contains', '!contains', 'one of', '<', '>'],
  list: ['has any', 'has all', 'has none'],
};
const OPERATOR_LABELS = { '=': 'is', '!=': 'is not', '<': 'less than / before', '<=': 'at most', '>': 'more than / after',
  '>=': 'at least', 'one of': 'is one of', 'contains': 'contains', '!contains': 'doesn\'t contain',
  'has any': 'include any of', 'has all': 'include all of', 'has none': 'include none of' };

// [[{ column, op, value }, ...], ...]: boxes of conditions
let filterGroups = readSaved(FILTERS_KEY, []);

function saveFilters() {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(filterGroups));
  const count = filterGroups.flat().filter((c) => c.value.trim() !== '').length;
  byId('filters-summary').textContent = count ? `${count} condition(s) in ${filterGroups.length} box(es).` : 'No filters: every row is kept.';
}

function newCondition() { return { column: 'player', op: '=', value: '' }; }

// "Combine?": a name in a filter that is in the names list can be widened to all of that player's names
const NAME_COLUMNS = new Set(['player', 'played_as', 'teammates', 'opponents', 'in_game']);
const COMBINABLE_OPS = new Set(['=', '!=', 'one of', 'has any', 'has all', 'has none']);

// the names list entry a name belongs to, as [main, ...alts], or null
function namesOf(name) {
  const lower = name.toLowerCase();
  const player = players.find((p) => p.main.trim() && [p.main, ...p.alts].some((n) => n.toLowerCase() === lower));
  return player ? [player.main.trim(), ...player.alts] : null;
}

// a player's key: their main name, lower case
const groupKey = (names) => names[0].toLowerCase();

// for each name in the condition, its whole names list entry (or just the name)
function nameGroups(condition) {
  const groups = [];
  for (const name of splitNames(condition.value)) {
    const group = namesOf(name) || [name];
    if (!groups.some((g) => groupKey(g) === groupKey(group))) groups.push(group);
  }
  return groups;
}

// the players in the condition that have names not typed yet, and haven't been dismissed with ×
function combinableGroups(condition) {
  if (!NAME_COLUMNS.has(condition.column) || !COMBINABLE_OPS.has(condition.op)) return [];
  const typed = splitNames(condition.value).map((n) => n.toLowerCase());
  const dismissed = condition.dismissed || [];
  return nameGroups(condition).filter((group) => !dismissed.includes(groupKey(group)) && group.some((n) => !typed.includes(n.toLowerCase())));
}

// a dismissed player comes back once their name has left the box (deleted, then typed again)
function forgetDismissed(condition) {
  if (!condition.dismissed) return;
  const present = nameGroups(condition).map(groupKey);
  condition.dismissed = condition.dismissed.filter((key) => present.includes(key));
  if (!condition.dismissed.length) delete condition.dismissed;
}

// rewrites the condition (or splits it, for "include all of" and "is not") so every name covers the whole player
function combineCondition(group, condition) {
  const widen = combinableGroups(condition).map(groupKey);
  // one entry per widened player with all their names; any other name typed stays as it is (e.g. dismissed with ×)
  const groups = [];
  for (const name of splitNames(condition.value)) {
    const whole = namesOf(name) || [name];
    const key = groupKey(whole);
    const entry = groups.find((g) => g.key === key);
    if (!widen.includes(key)) groups.push(Object.assign([name], { key }));
    else if (!entry) groups.push(Object.assign(whole.slice(), { key }));
  }
  const everyName = groups.flat();
  let replacement;
  if (condition.op === 'has all') {
    replacement = groups.map((g) => ({ column: condition.column, op: 'has any', value: g.join(', ') }));
  } else if (condition.op === '!=') {
    replacement = everyName.map((n) => ({ column: condition.column, op: '!=', value: n }));
  } else if (condition.op === '=' || condition.op === 'one of') {
    replacement = [{ column: condition.column, op: 'one of', value: everyName.join(', ') }];
  } else {
    replacement = [{ column: condition.column, op: condition.op, value: everyName.join(', ') }];
  }
  if (condition.dismissed) for (const r of replacement) r.dismissed = condition.dismissed.slice();
  group.splice(group.indexOf(condition), 1, ...replacement);
  saveFilters();
  showFilters();
}

function conditionRow(group, condition) {
  const row = document.createElement('div');
  row.className = 'button-row';

  const columnSelect = document.createElement('select');
  for (const [heading, columns] of Object.entries(FILTER_COLUMNS)) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = heading;
    for (const [column, label] of columns) optionGroup.append(new Option(label, column));
    columnSelect.append(optionGroup);
  }
  columnSelect.value = condition.column;

  const operatorSelect = document.createElement('select');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.value = condition.value;

  const fillOperators = () => {
    const kind = FILTER_KINDS[condition.column] || 'text';
    operatorSelect.textContent = '';
    for (const op of OPERATORS[kind]) operatorSelect.append(new Option(OPERATOR_LABELS[op], op));
    if (!OPERATORS[kind].includes(condition.op)) condition.op = OPERATORS[kind][0];
    operatorSelect.value = condition.op;
    valueInput.placeholder = kind === 'yesno' ? 'yes or no' : kind === 'list' ? 'name, another name' : condition.column === 'date' ? '2026-10-21' : '';
  };
  fillOperators();

  const combineButton = document.createElement('button');
  combineButton.type = 'button';
  combineButton.textContent = 'Combine?';
  combineButton.title = 'Also match this player\'s other names from "Combine names"';
  combineButton.onclick = () => combineCondition(group, condition);
  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.textContent = '×';
  dismissButton.title = 'Don\'t combine (comes back if the name is typed again)';
  dismissButton.onclick = () => {
    condition.dismissed = [...(condition.dismissed || []), ...combinableGroups(condition).map(groupKey)];
    updateCombineButton();
    saveFilters();
  };
  const updateCombineButton = () => {
    const show = combinableGroups(condition).length > 0;
    combineButton.hidden = !show;
    dismissButton.hidden = !show;
  };
  updateCombineButton();

  columnSelect.onchange = () => { condition.column = columnSelect.value; fillOperators(); updateCombineButton(); saveFilters(); };
  operatorSelect.onchange = () => { condition.op = operatorSelect.value; updateCombineButton(); saveFilters(); };
  valueInput.oninput = () => { condition.value = valueInput.value; forgetDismissed(condition); updateCombineButton(); saveFilters(); };

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';
  removeButton.onclick = () => {
    group.splice(group.indexOf(condition), 1);
    if (!group.length) filterGroups.splice(filterGroups.indexOf(group), 1);
    saveFilters();
    showFilters();
  };

  row.append(columnSelect, operatorSelect, valueInput, combineButton, dismissButton, removeButton);
  return row;
}

function showFilters() {
  const holder = byId('filter-groups');
  holder.textContent = '';
  filterGroups.forEach((group, index) => {
    if (index) {
      const orLine = document.createElement('p');
      orLine.className = 'filter-or';
      orLine.textContent = 'OR';
      holder.append(orLine);
    }
    const box = document.createElement('div');
    box.className = 'filter-group';
    const heading = document.createElement('p');
    heading.className = 'hint';
    heading.textContent = 'All of these:';
    box.append(heading);
    for (const condition of group) box.append(conditionRow(group, condition));
    const andButton = document.createElement('button');
    andButton.type = 'button';
    andButton.textContent = '+ And';
    andButton.onclick = () => { group.push(newCondition()); saveFilters(); showFilters(); };
    box.append(andButton);
    holder.append(box);
  });
}

byId('show-filters-button').onclick = () => {
  byId('filters-section').hidden = !byId('filters-section').hidden;
  if (!byId('filters-section').hidden && !filterGroups.length) { filterGroups.push([newCondition()]); saveFilters(); showFilters(); }
};
byId('add-filter-group-button').onclick = () => { filterGroups.push([newCondition()]); saveFilters(); showFilters(); };
byId('clear-filters-button').onclick = () => { filterGroups = []; saveFilters(); showFilters(); };

const FILTER_OPS = ['has all', 'has any', 'has none', 'one of', '!contains', 'contains', '<=', '>=', '!=', '=', '<', '>'];

byId('export-filters-button').onclick = () => {
  byId('filters-text').value = filterGroups
    .map((group) => group.filter((c) => c.value.trim() !== '').map((c) => `${c.column} ${c.op} ${c.value.trim()}`).join('\n'))
    .filter((text) => text)
    .join('\nor\n');
};

// the text form: "column operator value" per line, "or" between boxes
byId('import-filters-button').onclick = () => {
  const groups = [[]];
  for (const raw of byId('filters-text').value.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.toLowerCase() === 'or') { groups.push([]); continue; }
    const column = line.split(/[\s<>=!]/)[0];
    const rest = line.slice(column.length).trim();
    const op = FILTER_OPS.find((o) => rest.toLowerCase().startsWith(o));
    if (!column || !op) { byId('status-text').textContent = `Filters: can't read "${line}".`; return; }
    groups[groups.length - 1].push({ column, op, value: rest.slice(op.length).trim() });
  }
  filterGroups = groups.filter((group) => group.length);
  saveFilters();
  showFilters();
  byId('status-text').textContent = 'Filters updated.';
};

// the filters to send with a run: conditions with a value, boxes with a condition
const filtersForRun = () => filterGroups
  .map((group) => group.filter((c) => c.value.trim() !== '').map(({ column, op, value }) => ({ column, op, value })))
  .filter((group) => group.length);

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

function problemWith(options) {
  if (options.source === 'bulk-file' && !options.bulkFiles.length) return 'Choose a bulk file first.';
  if (options.selection === 'range' && (options.rangeFirst === '' || options.rangeLast === '')) return 'Fill in both ends of the range.';
  if (options.selection === 'list' && !options.idList.trim()) return 'Type or paste some match ids.';
  if (!byId('write-per-match-checkbox').checked && !byId('write-combined-checkbox').checked) return 'Tick at least one output.';
  if (byId('write-per-match-checkbox').checked && !options.perMatchFile) return 'Choose where to save the per-match stats.';
  if (byId('write-combined-checkbox').checked && !options.combinedFile) return 'Choose where to save the combined stats.';
  return '';
}

byId('run-button').onclick = async () => {
  const options = {
    source: matchSource(),
    bulkFiles: bulkFilePaths(),
    mapsFile: byId('maps-file-path').value.trim(),
    selection: checkedValue('match-selection'),
    rangeFirst: byId('range-first-id').value,
    rangeLast: byId('range-last-id').value,
    idList: byId('match-id-list').value,
    perMatchFile: byId('write-per-match-checkbox').checked ? byId('per-match-file-path').value.trim() : '',
    combinedFile: byId('write-combined-checkbox').checked ? byId('combined-file-path').value.trim() : '',
    aliases: byId('combine-names-checkbox').checked ? players.filter((player) => player.main.trim() && player.alts.length) : [],
    filters: filtersForRun(),
  };
  const problem = problemWith(options);
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
    byId('log-output').textContent = '$ ' + data.command + '\n';
    setRunning(true);
    byId('status-text').textContent = 'Running…';
  } else if (type === 'state') {
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
for (const name of SAVED_RADIOS) {
  for (const radio of document.querySelectorAll(`input[name="${name}"]`)) radio.addEventListener('change', () => { updateForm(); saveSettings(); });
}
loadSettings();
updateForm();
showNames();
saveFilters();
showFilters();
