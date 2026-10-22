# tagpro-stats

- `STAT_DEFINITIONS.md`: every TagPro stat definition found locally and on github.com/BambiTP.
- `fetch-ctf-stats.js`: CTF stats for tagpro.eu matches. Needs Node 18+ and nothing else.
- `decoder.js`: copy of BambiTP/tagpro.eu-data's decoder, with `processMatch` exported.

## Two ways to get the matches

```
node fetch-ctf-stats.js bulk <ids>    # from tagpro.eu bulk files (default: the ~/tagpro.eu mirror)
node fetch-ctf-stats.js site <ids>    # one request per match to https://tagpro.eu/data/?match=<id>
```

## Which matches

Any mix of ids, ranges and lists, or a file of them (`--ids file.txt`, tagpro.eu links work too):

```
node fetch-ctf-stats.js site 3934654-3934661
node fetch-ctf-stats.js bulk 3934654,3934660,3934700
node fetch-ctf-stats.js bulk 3934654-3934661,3934700,3935000-3935010 --totals totals.csv
```

## Options

| Option | What it does | Default |
|---|---|---|
| `--out FILE` | one row per player per match (`.csv` or `.json`) | `ctf_stats.csv` |
| `--totals FILE` | one row per player over all matches, with rates, win %, average scoreboard score, GASP and NISH | off |
| `--all-modes` | keep non-CTF matches | CTF only |
| `--bulk PATH` | a bulk file, or a folder of them | `~/tagpro.eu` |
| `--maps FILE` | tagpro.eu bulk maps file | `~/tagpro.eu/maps.json` |
| `--download` | bulk mode: download the id range from tagpro.eu's bulk endpoint into the cache first | off |
| `--cache DIR` | downloaded matches and bulk files, reused next time | `./cache` |
| `--delay MS` | wait between tagpro.eu requests; stops on HTTP 429 or 5xx | `2000` |

GASP and NISH in the totals are worked out against the players in that output only (a reconstruction,
not a league's published number). Timeline thresholds (fitted to the TagPro League's own numbers) are at the top
of the script.

## Desktop window

`ui/` is an Electron app around the script: paste match ids (ranges, lists, links), choose bulk or
site mode, pick the bulk file or folder, maps file and output files, then Run. It shows the log
live, can be stopped, and previews the results when it's done. Settings are remembered.

```
cd ui
npm install
npm start
```
