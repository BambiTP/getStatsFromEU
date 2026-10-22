# TagPro stat definitions

Every stat definition found on this computer and in the BambiTP GitHub repos (searched 2026-10-21).
Where a definition has a threshold, the number is given. Sources are named in each section.
`fetch-ctf-stats.js` in this folder computes sections 1, 2, 4 and GASP/NISH from section 3.

## 1. Basic stats (tagpro.eu and the game's scoreboard)

- **Tags**: you popped an enemy. A return also counts as a tag.
- **Pops**: you got popped (a drop is also a pop).
- **Grabs**: you picked up the enemy flag.
- **Drops**: you got popped while carrying the flag.
- **Captures**: you brought the enemy flag home while your own flag was there.
- **Hold**: seconds spent carrying the flag.
- **Returns**: you popped the enemy flag carrier.
- **Prevent**: seconds spent defending your own flag. The real definition is not confirmed. Bambi's
  guess (tagpro-findings PRIMER.md): your flag is home, you are in your base, and an enemy is within
  about 5 tiles. tagpro-local uses its own version: 1 per second while alive, flag home, within 8 tiles of it.
- **Support, Block, Button, Pups**: support, seconds blocking, seconds on buttons, powerups picked up.

## 2. In-game scoreboard score ("IPMv1.1")

Sources: tagpro-findings/SCOREBOARD.md, tagpro-local/engine/game.js (updateScores).

- Eligible: played at least 15% of the game and at least half a minute.
- Each stat becomes a per-minute rate, then a z-score against the other eligible players in the same game only.
- Offence = captures per minute (20) + hold per minute (38) + captures per grab (42).
- Defence = tags per pop (18) + returns per minute (34) + prevent per minute (40) + non-return tags per minute (8).
- Total = 2/3 of the better side + 1/3 of the weaker side.
- Offence, defence and total are each rescaled to 50 + 20 per standard deviation within the game.
  Replays carry them as `score`, `oscore`, `dscore`.
- The old points system (100 per cap, 5 per grab, 1 per second of hold, ...) is only partly written down anywhere.

## 3. League ratings

Worked out from tagproleague.com's own GASP and NISH tables (MLTP S39: the season and each of the 7
weeks). Fed the league's published stats, these formulas give exactly the league's GASP and NISH
(offence, defence and total) for every player in every table. fetch-ctf-stats.js, working from
tagpro.eu, matches all 29 players on all six numbers for the season, and 1002 of 1008 numbers week by
week (the 6 misses are neighbours swapped where the league's input differs from tagpro.eu by one return
or a few seconds of prevent).

How both are built:
- Only **regulation** counts: the league's season tables leave out clutch time and overtime (its minutes
  are exactly 10 per game). Hold is the league hold of the regulation period; plus-minus is the cap
  difference at the end of regulation. The combined stats have these as the `regulation_*` columns.
- Each stat is a z-score over the players being rated (population standard deviation): the league rates
  everyone in the table (same season and tier, that week or the whole season). fetch-ctf-stats.js rates
  everyone in the output with at least 10 regulation minutes.
- The weighted z-scores are added up, and the result is Excel's PERCENTRANK: the number of players below
  ÷ (players − 1). So the leader gets exactly the top value and the last player 0.

**GASP** (out of 10, two decimals)
- Offence: caps per minute (2), score % (2), caps (5), hold (4).
- Defence: returns per minute (2), K/D (2), non-return tags per minute (1), returns (4), prevent (4).
- Total: offence sum + defence sum.
- Caps, hold, returns and prevent are totals, so more minutes scores higher.

**NISH** (out of 100, whole numbers)
- Offence: caps per minute (4), hold per minute (3), score % (2).
- Defence: returns per minute (4), prevent per minute (4), K/D (1).
- Total: offence sum + defence sum + 2 × plus-minus (its z-score).
- These weights are the only whole-number ones up to 8 that give the league's numbers (doubling all of
  them gives the same ranks).

**SCAR** (TagPro Reference)
- Value above a replacement player. The winning team gets +half the cap margin, the loser −half, split four ways.
- Adjusted against the player's own team's averages (zero-sum within the team), plus 0.6 per 10 minutes played.
- Blowout dampening: first 3 caps count fully, then 80%, 60%, 40%. Can go negative.
- Splits into OSCAR (offence) and DSCAR (defence) by the game's offence/defence balance.
- Only in the memory note (from Bambi's 17 Sep 2026 research write-up). No code computes it.

SCAR is a formula family: anything computed from it is a reconstruction. GASP and NISH above are the
league's own formulas.

## 4. Stats worked out from the match timeline

These are the TagPro League's own definitions, worked out by fitting its published numbers
(tagproleague.com game stats) and confirmed on a season they were not fitted to:

| Check | Matches | Player rows | Rows matching, per stat |
|---|---|---|---|
| MLTP S39 Majors (fitted) | 102 | 816 | 816 on every stat but handoffs and saves (815) |
| MLTP S38 Majors (holdout) | 92 | 736 | 734–736 |

Only matches whose league grabs, caps and returns agree exactly with tagpro.eu are compared (the few
left out have league data cut short). S38 match 4171096 is left out because the league has
one player there on "team 0". fetch-ctf-stats.js uses exactly these rules.

Periods: the league keeps separate stats for **regulation** (the time limit), **clutch time** and
**overtime**. Clutch time happens when the score isn't tied at the limit but a flag is being held:
play runs on until that hold ends (capped or returned). Overtime is sudden death after a tie: from
the limit if the score was tied, or from the end of clutch time if a clutch-time capture tied it.
A match can have all three. tagpro.eu keeps them in one match; to compare with the league, add the
league's regulation (gNh1), clutch (othN) and overtime (gNot) stats for that game.

How the league reads a match: each team's holds are taken in order of grab time, and events in the
same frame are taken in player order (the order of players in the match file). A "teammate's hold"
below always means the team's hold immediately before, by a different player.

Match and result columns
- **match_id** (the tagpro.eu match number), **date**, **map**, **color** (red or blue), **result** (W, L or T).
- **map_author**, **mode** (ctf; nf = neutral flag, the map has a yellow flag; other), **server**,
  **time_limit** (minutes), **game_minutes** (how long it really lasted), **finished**, **players_in_game**
  (everyone who played, subs included), **teammates** and **opponents** (names, after combining names).
- **overtime**: 1 if the game went to overtime. **clutch_time**: 1 if it had clutch time. Both match the
  league's own periods on all 205 S38/S39 Majors games (the league starts counting either one half a
  second after it begins).
- Combined stats add **wins**, **losses**, **ties**, **ot_wins** and **ot_losses** (wins and losses in games
  that went to overtime).

Offence
- **Long hold**: a hold longer than 20 s. A hold still running when the game ends doesn't count.
- **Flaccid**: a hold shorter than 2 s that ends in a drop (not a cap, not the end of the game).
- **Grab off a handoff**: a grab less than 2 s after a teammate's hold of less than 3 s ended (that
  hold may have ended in a cap).
- **Cap off a handoff**: a capture from a grab off a handoff.
- **Grab off a regrab**: a grab less than 3 s after a teammate's hold of more than 5 s ended (that
  hold may have ended in a cap). A grab in the same frame counts only if the teammate comes earlier in
  the player order.
- **Cap off a regrab**: a capture from a grab off a regrab.
- **Handoff** (credited to the player whose hold ended, whatever its length): the teammate grabs less
  than 3 s later, then holds for more than 2 s and drops. If the teammate captures instead, it counts
  only when it was a grab off a handoff.
- **Good handoff**: a handoff where the teammate holds for more than 5 s.
- **Overtime caps**: captures after the clock ran out.

Defence
- **Quick return**: a return after the enemy held for less than 2 s.
- **Key return**: each capture credits only the team's last return before it, if that return came
  less than 3 s before the capture.
- **Return in base**: the returned carrier's splat, moved one tile (40 px) right and one tile down, is
  less than 5 tiles from your flag's centre. The splat used is the one in the return's own frame.
- **Save**: the same moved splat is less than 2 tiles from the enemy flag's centre, and no teammate
  is holding the flag (a teammate's hold that began less than half a second before the return
  doesn't count).
- **Non-return tags** = tags − returns. **Non-drop pops** = pops − drops.

TagPro Reference's versions (`tpr_key_returns`, `tpr_saves`), worked out from its own per-game numbers
(the season data behind tagpro-reference.com/leaders/custom). They match it for every player in every
regular-season game of MLTP S39 (840 player-games, fitted) and S38 (800, not fitted). Like the site's
default view, they count regulation time only.
- **TPR key return**: a return less than 2 s before a teammate's cap. Several returns by the same player
  before the same cap count once.
- **TPR save**: the returned carrier's splat, moved half a pixel right and down, is less than 6 tiles
  (240 px) from the enemy flag's centre, and no teammate is holding the flag (a teammate's hold that ends
  in the same frame as the return doesn't count).

Hold
- **League hold**: hold in whole seconds, leaving out a hold still running at the end of the game;
  regulation, clutch time and overtime are each rounded separately (halves round up). tagpro.eu's own hold
  includes the last hold, so it can be higher.
- **Hold against**: the sum of the league hold of every player on the other team (team = the
  team a player first joined).

Ratios (RankedStatsCollector)
- Score % = caps ÷ grabs. K/D = tags ÷ pops. Hold per grab. Prevent per return. Prevent ÷ hold against.
- Flaccid % (of grabs), quick-return % and return-in-base % (of returns).
- Chain % = good handoffs ÷ handoffs.
- Pup % = your powerups ÷ every powerup taken in the game.
- Support = button ÷ 5 + (block ÷ 5) × 2 (whole-number division).
- Every stat per minute and per 8 minutes. Win % overall and on red / blue.
- **tagpro.eu score and points**: the `score` and `points` tagpro.eu stores for each player (the
  league exports' `score` column).

MLTP's stats page (tagproleague.com/MLTP/stats) has column tooltips, but several are looser than
what its numbers show: it calls a handoff "a teammate grab within 2 s of a < 3 s hold" and a save
"a return when the enemy was about to capture", and gives no length for a long hold. Its extra columns:
- **Spark %**: the share of captures from grabs the player made themselves, not from a regrab or handoff:
  (caps − caps off handoffs − caps off regrabs) ÷ caps.
- **Kept flags (KF)**, **PM** (cap difference), **hold against per minute**.

TagproStats extras
- Kept flags = grabs − drops − caps. Cap difference. Hold and prevent for and against. Win = 1, loss = 0, tie = 2.

## Other sources' numbers (not used)

- Long hold: NALTP 8 s, TagproStats 10 s, TagPro Reference over 10 s, RankedStatsCollector 20 s or more.
- Flaccid: Bambi's estimate of about 3–4 s.
- Handoff and regrab: NALTP and RankedStatsCollector use "hold under 3 s, picked up within 2 s" for
  handoffs and count every other quick pick-up as a regrab.
- Return in base / saves: NALTP 6 tiles from the flag tile's centre.
- Return in base: RankedStatsCollector 5.5 tiles, TagPro Reference 10 tiles.
- Prevent: real definition unconfirmed; tagpro-local uses its own 8-tile version.
