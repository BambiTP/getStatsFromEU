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
| `--no-matches` | don't write the per-match file (use with `--totals`) | off |
| `--aliases FILE` | combine players who used several names (see below) | off |
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

## Combining names

`--aliases FILE` merges players who played under several names. One player per line, main name
first; matching ignores upper/lower case:

```
Bambi: BambiTP, bambi alt
fender, fendy
```

JSON works too: `{"Bambi": ["BambiTP", "bambi alt"]}`. Per-match rows get the main name in `player`
and the name actually used in `played_as`; the totals add up under the main name and list every
name used in `names`.

## Desktop window

`ui/` is an Electron app around the script:

- paste match ids (ranges, lists, links); it counts them and says how many your bulk files cover
- bulk or site mode, with pickers for the bulk file or folder and the maps file
- per-match stats and/or combined stats, as CSV or JSON
- a names editor: add a player, give the main name, add their alts; names from the last run that
  aren't in a player yet are listed so you can click them in; import/export by copy and paste or file
- Run (Ctrl+Enter) with a progress bar and time left, Stop, the log, and sortable, filterable
  tables of the results

```
cd ui
npm install
npm start
```
