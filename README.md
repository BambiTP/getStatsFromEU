# getStatsFromEU

CTF stats for TagPro matches from [tagpro.eu](https://tagpro.eu), worked out the same way the TagPro
League does (long holds, handoffs, regrabs, returns in base, saves, ...). See `STAT_DEFINITIONS.md`
for what every stat means.

You choose a bulk file of matches from tagpro.eu and get either every match in it, a range of match
ids, or a list of ids. The results are saved as CSV or JSON: one row per player per match, and/or one
row per player with everything added up. Players who used several names can be combined.

There are three ways to use it: a desktop window, a page in your browser, or the command line.

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

## 2. Get a bulk file

A bulk file is a set of tagpro.eu matches in one file. Download one in your browser from

    https://tagpro.eu/data/?bulk=matches&first=FIRST_ID&last=LAST_ID

replacing FIRST_ID and LAST_ID with match ids (tagpro.eu allows up to 250,000 ids per file; big
ranges are big downloads). Save it as a `.json` file. Gzipped bulk files (`.json.gz`) work too.

The maps file (`maps.json`) is downloaded from tagpro.eu automatically the first time, or you can
get it yourself from https://tagpro.eu/data/?bulk=maps and choose it in the app.

## 3. Use it

### Desktop window

In the `ui` folder, once:

    cd ui
    npm install

Then every time (from the `ui` folder):

    npm start

### In your browser

From the main folder:

    node ui/server.js

and open http://localhost:8097. The file pickers there show the files on the computer running the
server.

To use it from another computer on your [Tailscale](https://tailscale.com) network, start it on your
Tailscale address instead (find it with `tailscale ip -4`):

- macOS / Linux: `HOST=100.x.y.z node ui/server.js`
- Windows (PowerShell): `$env:HOST="100.x.y.z"; node ui/server.js`

and open http://100.x.y.z:8097 on the other computer. Only do this on a private network like
Tailscale: anyone who can open the page can read files and run the script on the server computer.

### Steps in the app

1. **Bulk file**: choose the bulk file (and the maps file, if you have one).
2. **Which matches**: all matches in the file, a range of ids, or a list (ids, ranges like
   `4307000-4307100`, or tagpro.eu links).
3. **Output**: CSV or JSON; per-match stats and/or combined stats, and where to save them.
4. **Combine names** (optional): add a player, type the main name and their other names separated by
   commas. "Import / export as text" lets you copy the list or paste one in (`Main: alt, alt` per line).
5. **Run**. The log shows progress; the results table shows the first 200 rows.

### Command line

    node fetch-ctf-stats.js bulk --bulk FILE --all --out stats.csv --totals totals.csv
    node fetch-ctf-stats.js bulk --bulk FILE 4307000-4307100 --out stats.csv
    node fetch-ctf-stats.js bulk --bulk FILE --ids my_ids.txt --out stats.json
    node fetch-ctf-stats.js site 4307332,4307346 --out stats.csv      (downloads each match from tagpro.eu)

| Option | What it does |
|---|---|
| `--bulk FILE` | the bulk file (or a folder of them) |
| `--all` | every match in the bulk file |
| `--ids FILE` | a text file of ids, ranges or links |
| `--maps FILE` | the maps file (downloaded once if missing) |
| `--out FILE` | per-match stats, `.csv` or `.json` |
| `--totals FILE` | combined stats per player, `.csv` or `.json` |
| `--no-matches` | only write the combined stats |
| `--aliases FILE` | combine names: one player per line, `Main: alt, alt` |
| `--all-modes` | keep non-CTF matches |
| `--delay MS` | site mode: wait between tagpro.eu requests (default 2000) |

## Files

- `fetch-ctf-stats.js`: the stats script
- `decoder.js`: reads tagpro.eu's match format (from BambiTP/tagpro.eu-data)
- `ui/`: the desktop window and browser page (`index.html`, `style.css`, `app.js`), the desktop app
  (`main.js`, `preload.js`), the browser server (`server.js`, `web-api.js`), and `core.js`, which both use
- `STAT_DEFINITIONS.md`: what every stat means and how it was checked against the TagPro League
