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

Sources: naltp/season_stats.py, memory note reference_tagpro_stat_systems.md.

**GASP** (TagPro League)
- Offence: caps per minute (2), score % (2), caps (5), hold (4).
- Defence: returns per minute (2), tags per pop (1), non-return tags per minute (2), returns (4), prevent (4).
- Each stat is a z-score against the league (same season and tier, population standard deviation).
  The weighted sum becomes a percentile rank × 10, so 0 to 10, leader exactly 10.
- Caps, hold, returns and prevent are totals, so more minutes scores higher.
- The NALTP reconstruction leaves out anyone under 10 minutes (our choice, not the league's).

**NISH**
- Same nine stats and weights, every one per minute (caps and returns are therefore counted twice).
- About 30 minutes to qualify. Leader anchored at 100. Scaling below the leader was never documented;
  the reconstruction uses a straight line from the lowest qualifier (0) to the highest (100).

**SCAR** (TagPro Reference)
- Value above a replacement player. The winning team gets +half the cap margin, the loser −half, split four ways.
- Adjusted against the player's own team's averages (zero-sum within the team), plus 0.6 per 10 minutes played.
- Blowout dampening: first 3 caps count fully, then 80%, 60%, 40%. Can go negative.
- Splits into OSCAR (offence) and DSCAR (defence) by the game's offence/defence balance.
- Only in the memory note (from Bambi's 17 Sep 2026 research write-up). No code computes it.

All three are formula families: leagues use different weights, so anything computed here is a
reconstruction, not a league's published number.

## 4. Stats worked out from the match timeline

These are the TagPro League's own definitions, worked out by fitting its published numbers
(tagproleague.com game stats) and confirmed on a season they were not fitted to:

| Check | Matches | Player rows | Rows matching, per stat |
|---|---|---|---|
| MLTP S39 Majors (fitted) | 86 | 688 | 688 on every stat but handoffs (687) |
| MLTP S38 Majors (holdout) | 74 | 592 | 590–592 |

Only matches whose league grabs, caps and returns agree exactly with tagpro.eu are compared; the rest
have league data cut short or split oddly. S38 match 4171096 is left out because the league has
one player there on "team 0". fetch-ctf-stats.js uses exactly these rules.

How the league reads a match: each team's holds are taken in order of grab time, and events in the
same frame are taken in player order (the order of players in the match file). A "teammate's hold"
below always means the team's hold immediately before, by a different player.

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

Hold
- **League hold**: hold in whole seconds, leaving out a hold still running at the end of the game;
  regulation and overtime are each rounded separately (halves round up). tagpro.eu's own hold
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
