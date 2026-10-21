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

MLTP's stats page (tagproleague.com/MLTP/stats, column tooltips) uses the same definitions:
flaccid = a grab with under 2 s of hold, handoff = a teammate grabs within 2 s of a hold under 3 s,
good handoff = the teammate then holds over 5 s, quick return = the enemy held under 2 s,
key return = your team caps within 3 s of the return. It defines a save only as "a return when the
enemy was about to capture", and it doesn't say how long a long hold is. Its extra columns:
- **Spark %**: the share of captures from grabs the player made themselves, not from a regrab or handoff:
  (caps − caps off handoffs − caps off regrabs) ÷ caps.
- **Kept flags (KF)**, **PM** (cap difference), **hold against per minute**.

TagproStats extras
- Kept flags = grabs − drops − caps. Cap difference. Hold and prevent for and against. Win = 1, loss = 0, tie = 2.

## Where the sources disagree

- Flaccid: under 2 s in code; about 3–4 s per Bambi.
- Long hold: 8, 10 or 20 s depending on the source.
- Return in base: 5.5 or 6 tiles.
- Prevent: real definition unconfirmed; tagpro-local uses its own 8-tile version.
