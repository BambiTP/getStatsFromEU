# getStatsFromEU

## How to update

If you got the code with Git, open a terminal in the folder (PowerShell on Windows, Terminal on
macOS and Linux) and run:

    git pull
    cd ui
    npm install

If you downloaded the ZIP: download it again from https://github.com/BambiTP/getStatsFromEU
(**Code → Download ZIP**), unzip it, and move your old `cache` folder into the new folder so nothing
has to be downloaded again. Then run `npm install` in its `ui` folder.

`npm install` only matters for the desktop app, and it's quick when nothing changed. New installs
start at section 1 below.

CTF stats for TagPro matches from [tagpro.eu](https://tagpro.eu), worked out the same way the TagPro
League does (long holds, handoffs, regrabs, returns in base, saves, ...). See `STAT_DEFINITIONS.md`
for what every stat means.

Matches come either in **bulk** (many matches in one file: a file you already have, or downloaded
from tagpro.eu for you) or as **individual** matches downloaded one at a time. You can take every
match in a bulk file, a range of match ids, or a list of ids. The results are saved as CSV or JSON:
one row per player per match, and/or one row per player with everything added up. Players who used
several names can be combined.

Each per-match row has the match number, date, map, color (red/blue), result (W/L/T), whether the
game went to overtime or clutch time, and all the stats; the combined rows add wins, losses, ties
and overtime wins/losses. GASP and NISH are the league's own formulas, and TagPro Reference's
key returns and saves are there too.

There are two ways to use it: the desktop app or the command line.

## 1. Install

You need **Node.js 18 or newer** and the code.

### Windows
1. Install Node.js: download the "LTS" installer from https://nodejs.org and run it (keep the defaults).
2. Get the code: on https://github.com/BambiTP/getStatsFromEU click **Code → Download ZIP** and unzip it,
   or with Git: `git clone https://github.com/BambiTP/getStatsFromEU.git`
3. Open **PowerShell** in that folder (in File Explorer: click the address bar, type `powershell`, Enter).

### macOS
1. Install Node.js: download the "LTS" installer from https://nodejs.org, or with Homebrew: `brew install node`
2. Get the code: `git clone https://github.com/BambiTP/getStatsFromEU.git` (or Download ZIP as above)
3. Open **Terminal** and go to the folder: `cd getStatsFromEU`

### Linux
1. Install Node.js 18+: from your package manager (`sudo apt install nodejs npm` on Ubuntu/Debian 24.04+,
   `sudo dnf install nodejs` on Fedora), or from https://nodejs.org
2. Get the code: `git clone https://github.com/BambiTP/getStatsFromEU.git`
3. `cd getStatsFromEU`

Check Node works: `node --version` should print v18 or higher.

## 2. Bulk files (optional)

The app can download matches from tagpro.eu for you. If you'd rather use a bulk file you already
have, or download one yourself in a browser:

    https://tagpro.eu/data/?bulk=matches&first=FIRST_ID&last=LAST_ID

(replace FIRST_ID and LAST_ID with match ids; save it as a `.json` file; gzipped `.json.gz` works too).
Bulk files can be very large: the app reads them a piece at a time, so any size works.

The maps file (`maps.json`) is downloaded from tagpro.eu automatically the first time. Downloads are
kept in the `cache` folder so nothing is downloaded twice.

## 3. Use it

### Desktop window

In the `ui` folder, once:

    cd ui
    npm install

Then every time (from the `ui` folder):

    npm start

### Steps in the app

1. **Where the matches come from**: Bulk, either *from a bulk file on this computer* (choose the file)
   or *download from tagpro.eu*; or *individual matches* (one request every 2 seconds, so best for a
   few hundred matches at most). For bulk you can choose a maps file you already have, or click
   "Download…" to save tagpro.eu's maps file somewhere and reuse it.
2. **Which matches**: all matches in the bulk file, a range of ids, or a list (ids, ranges like
   `4307000-4307100`, or tagpro.eu links).
   **Filters…** (optional) keeps only the rows you want. Each condition is a column, a comparison and a
   value, e.g. *Time limit is 8* or *Teammates include any of PlayerTwo*. Every condition in a box has
   to be true (and); "+ Or" adds another box, and a row is kept if any box is true. Conditions can use
   the match (mode CTF or neutral flag, group or public, time limit, players in the game, server, map,
   date, overtime, ...), the player (name, color, result, teammates, opponents, ...) or any stat.
   There is no "ranked" column in tagpro.eu's data; public games with an 8 minute time limit and no
   more than 8 players come close.
3. **Output**: CSV or JSON; per-match stats and/or combined stats, and where to save them.
4. **Combine names** (optional): "+ Add player", type the main name and their other names separated by
   commas. Or paste many at once, one player per line: `NewName: OldName, SmurfName`,
   `OldName, SmurfName -> NewName` or `NewName, OldName, SmurfName`; their stats all go under NewName. If a
   name is already in the list, the others are added to that player.
5. **Run**. The log shows progress; the results table shows the first 200 rows and "Open file" opens
   the whole file.

### Command line

    node fetch-ctf-stats.js bulk --bulk FILE --all --out stats.csv --totals totals.csv
    node fetch-ctf-stats.js bulk --bulk FILE 4307000-4307100 --out stats.csv
    node fetch-ctf-stats.js bulk --bulk FILE --ids my_ids.txt --out stats.json
    node fetch-ctf-stats.js bulk --download 4307000-4307100 --out stats.csv   (downloads the bulk file)
    node fetch-ctf-stats.js site 4307332,4307346 --out stats.csv              (downloads each match)

| Option | What it does |
|---|---|
| `--bulk FILE` | the bulk file (or a folder of them) |
| `--all` | every match in the bulk file |
| `--ids FILE` | a text file of ids, ranges or links |
| `--download` | download the bulk matches from tagpro.eu instead of using `--bulk` |
| `--maps FILE` | the maps file (downloaded once if missing) |
| `--out FILE` | per-match stats, `.csv` or `.json` |
| `--totals FILE` | combined stats per player, `.csv` or `.json` |
| `--no-matches` | only write the combined stats |
| `--aliases FILE` | combine names: one player per line, `Main: alt, alt` or `alt, alt -> Main` |
| `--all-modes` | keep non-CTF matches |
| `--filter FILE` | keep only rows passing the conditions in FILE (below) |
| `--delay MS` | site mode: wait between tagpro.eu requests (default 2000) |
| `--threads N` | bulk mode: how many threads work out matches (default: CPU cores − 1, at most 4; `1` = no extra threads) |

### Filter files

One condition per line: a column, an operator and a value. All lines must be true; a line saying `or`
starts another set, and a row is kept if any set is true. Example: PlayerOne's public 8 minute games with
PlayerTwo on their team, or any game PlayerOne won by 3 or more:

    player = PlayerOne
    group = 0
    time_limit = 8
    teammates has any PlayerTwo
    or
    player = PlayerOne
    cap_diff >= 3

Operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `!contains`, `one of` (comma list); for the name
lists `teammates`, `opponents` and `in_game` (everyone in the match): `has any`, `has all`, `has none`.
Any per-match column works, including `mode` (ctf, nf, other), `server`, `time_limit`, `game_minutes`,
`players_in_game`, `finished`, `map_author` and `date` (YYYY-MM-DD). Filtering on `mode` takes in every
game mode, not only CTF.

## Files

- `fetch-ctf-stats.js`: the stats script
- `decoder.js`: reads tagpro.eu's match format (from BambiTP/tagpro.eu-data)
- `ui/`: the desktop app: the page (`index.html`, `style.css`, `app.js`), the Electron parts
  (`main.js`, `preload.js`) and `core.js`, which runs the script
- `STAT_DEFINITIONS.md`: what every stat means and how it was checked against the TagPro League
