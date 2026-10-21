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

Sources: naltp/derived_stats.py, RankedStatsCollector/eu_ctf.py, TagproStats/main.py.

Offence
- **Long hold**: a hold of 8+ s (NALTP). RankedStatsCollector uses 20+ s, TagproStats 10+ s.
- **Flaccid**: a grab lost within 2 s.
- **Handoff**: a hold under 3 s that a teammate picks up within 2 s.
- **Good handoff**: a handoff the teammate then holds for more than 5 s.
- **Caps off handoffs / caps off regrabs**: a capture by the player who took the flag from a handoff / a regrab.
- **Overtime caps**: captures after the clock ran out.

Defence
- **Quick return**: a return after the enemy held for less than 2 s.
- **Key return**: a return made within 3 s before your team capped.
- **Return in base**: a return within 6 tiles of your own flag (RankedStatsCollector: 5.5 tiles).
- **Save**: a return within 6 tiles of the enemy's flag while nobody on your team is holding.
- **Non-return tags** = tags − returns. **Non-drop pops** = pops − drops.
- **Hold against**: seconds the enemy held the flag while you were playing.

Ratios (RankedStatsCollector)
- Score % = caps ÷ grabs. K/D = tags ÷ pops. Hold per grab. Prevent per return. Prevent ÷ hold against.
- Flaccid % (of grabs), quick-return % and return-in-base % (of returns).
- Chain % = good handoffs ÷ handoffs.
- Pup % = your powerups ÷ every powerup taken in the game.
- Support = button ÷ 5 + (block ÷ 5) × 2 (whole-number division).
- Every stat per minute and per 8 minutes. Win % overall and on red / blue.

TagproStats extras
- Kept flags = grabs − drops − caps. Cap difference. Hold and prevent for and against. Win = 1, loss = 0, tie = 2.

## 5. Ratings and models

- **Team rating** (tagpro-analytics/own_rating.py): registered players start at 1500; team strength is the
  average; after each official CTF game everyone moves K × (result − expected), K larger for early games.
  Unregistered players count as 1500 and never change.
- **Elo and percentiles** (nte/tagpro_pipeline/player_stats.py): start 1500, K 24, CTF and Marsball rated
  separately; percentiles need 20+ games (rank ÷ (n − 1) × 100).
- **Powerup stats** (same file): caps per pickup (did your team cap within 30 s of the pickup, split by
  TagPro / Juke Juice / Rolling Bomb); holds overlapping ±7 s of a powerup respawn and whether they were
  converted or died; pre-grab (a new grab in the 10 s before a powerup spawned).
- **Event value** (event_value.py): each action scored by (own chance of capping next after − before)
  − (enemy chance after − before).
- **Decision Elo** (decision_elo.py): each player's rating moves on their own event values vs the
  other team's average rating; trained only on games where both teams average 1700+.
- **Expected caps** (tagpro-analytics/xcaps_*.py): chance your team caps within 30 s given the board, every 2 s.
- **Synergy vectors** (nte/SYNERGY_VECTORS_PLAN.md): two unnamed 8-number vectors per player, one for
  teammates, one for opponents.
- **Map luck** (map_luck.py): 1 − (how well the rating gap predicts the winner on this map ÷ the median map's figure).
- **Eggball Ranked** (tagpro-local/server/ranked.js): Elo from 1500, K 32, team averages; a leaver loses as if their team lost.

## 6. Strategy terms measured from replays

Sources: tagpro-findings/GLOSSARY.md, tagpro-analytics (concepts.py, strategies.py, stealth.py,
noise_eval.py, solo_rules.py, comp_solo.py, bomb_luck.py, game_quality.py, defense_style.py).
Distances are walking distances through the map, in tiles. Replays are sampled every 0.25 s.

- **Past N**: enemies farther than the carrier from the carrier's capping flag. Dead enemies count as passed; boosts and bombs ignored.
- **Reset**: own flag home and both defenders within 6 tiles of it.
- **Regrab**: a teammate (not the carrier) within 2 tiles of the enemy's empty flag stand.
- **Regrab chain**: same flag grabbed by the same team within 2 s of its carrier being returned.
- **Anti regrab**: a player within 3 tiles of the enemy regrab waiting on your flag.
- **OD**: your flag out, theirs home, your players within 4 tiles of their flag. **4OD**: all four.
- **Powerup fight**: 3+ players within 5 tiles of a powerup at its real respawn.
- **Break-off grab**: a grab within 5 s of that respawn by someone not at the fight.
- **Bomb gift**: a bomb within 3 tiles of an enemy of the carrier, and within 1 s the carrier has passed that enemy. **Free past 4**: a bomb gift that reaches past 4.
- **Bomb death**: a player within 3 tiles of a bomb dies within 1.5 s.
- **Stalemate**: 60+ s with at least 4 grabs and none held longer than 4 s.
- **Defensive depth**: under attack (flag home, 2+ enemies in your half), how far your two closest-to-flag players sit from it vs the map average; the 5 s before enemy grabs are left out.
- **Stealth grab**: enemy flag home throughout; the 6 s before the grab spent within 12 tiles of it with no enemy within 1.1 tiles. Successful = capped or held 10+ s.
- **Swipe**: an enemy within 1.5 tiles of the carrier, no return in the next second, and the carrier is past that enemy one second later.
- **Unforced return**: the carrier dies with no enemy within 2.5 tiles.
- **Solo** (Bambi's rules): a carrier death that is not a bad grab (right after grabbing), not elements (boost or bomb in the last 2 s), not pressured (second enemy within 5 tiles), not pinned (within 1.5 tiles of a wall).
- **Comp vs ranked deaths**: self-inflicted (no enemy within 2.5 tiles), solo (one enemy within 3), contained (2+ within 3).
- **Clean game**: teams uneven no more than 30 s, and nobody idle (under 0.3 tiles/s) for more than 10% of the game.

## 7. Other game modes

- **Eggball** (tagpro-local/engine/game.js): points 1 per score, 2 each for thrower and catcher of a
  Raptor Boat (off a wall, caught in the endzone within 1.5 s). Throws end as pass, interception
  (thrower / catcher counted), self throw, or incompletion. Dunk = a self throw that would have been a
  Raptor Boat. Tackles / tackled = an enemy pops the egg holder.
- **Zomball** (ZomballStats, tagpro.eu-data/zomball.js): valid tag = a pop that is not a spawn kill
  (stint under 300 frames, or before any zombie exists). Survival time (also by zombie count), first to
  die, last alive, never died, starting zombie. "Ran from them" (with / without starting zombies) is
  computed in the Zomball API, which is not in the repos.
- **GLTP** (gravity): completion points = the map's value; speedrun 2 for 1st, 1 for 2nd;
  total = completion + speedrun + bounties. Leaderboards: games completed, unique maps, world records,
  solo world records, capping world records.

Counts only, no formulas: Ranked Stats userscript, Teammate & Opponent Win % gist, PublicGames repo.

## Where the sources disagree

- Flaccid: under 2 s in code; about 3–4 s per Bambi; 4 s in the stalemate detector.
- Long hold: 8, 10 or 20 s depending on the source.
- Return in base: 5.5 or 6 tiles.
- Prevent: real definition unconfirmed; tagpro-local uses its own 8-tile version.
