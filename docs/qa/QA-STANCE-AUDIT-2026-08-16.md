# Troop stance audit — DEFEND / GUARD / ATTACK

**Reported:** 2026-08-16 21:53 UTC by Alex · **Build:** `71f9880` (deployed) · **Session:** room A2F6F9 post-mortem + solo playthroughs

Split out of PR #30 per Alex. Alex's report: *"it feels like the defend one doesn't work at all, i never use the follow me button and the third option is the only one that seems to work."* Audit confirms all three observations. File refs from `src/game.js`.

## Audit findings

Alex: *"it feels like the defend one doesn't work at all, i never use the follow me button and the third option is the only one that seems to work."* Audit confirms all three observations. File refs from `src/game.js`.

### 1. DEFEND is freeze-in-place, not "defend city" (P1)
- `setStance('defend')` stamps `holdX/holdZ = u.x, u.z` — each unit's **current** position (line 1731). No pathing home, no anchor, no perimeter.
- Pressed mid-push (the common case), the army strands itself wherever it stands while zombies walk past to the walls. The toast says *"The army falls back to hold the line"* — it never falls back anywhere. UI lies.
- Re-press while already in Defend is a no-op (`st === this.stance` early return, line 1729) — can't re-anchor hold points without cycling stances.
- Units only engage what wanders into weapon range (~6–8 tiles, config.js) while the flow field sends the horde at the Keep — a thin line on open ground covers a small arc of a long wall.

### 2. GUARD (follow hero) is a no-value order — correct to never use it
- Permanent 1.8-tile escort ring around nearest hero (game.js:2892–2912). Drags the army through danger, abandons node-holding (ground decays), units idle if the hero dies mid-fight. No economic or defensive function.

### 3. ATTACK is the only stance with real orders — why it "works"
- Routes, destinations, re-picking (`_pushLane`), hunting seek radius (10 tiles vs weapon range), hive-siege priority (`_pickPushTarget`, siege-guard override). The other two stances are one-liners by comparison.

### 4. Co-op: stance is global, last-press-wins (P1 for MP feel)
- One shared army, any player's 1/2/3 overrides everyone instantly, no attribution in the toast (`setStance` message doesn't say who ordered it). In 3-player runs a teammate's habitual "3" silently undoes your Defend within seconds — likely why Defend felt dead *tonight specifically*.

### Fix directions
1. **Defend = route to anchor**: ring around Keep/wall perimeter (or player-placed rally flag) — actually "hold the line." Allow re-press to re-anchor.
2. **Consider the Thronefall model**: army follows hero loosely by default; trim to two meaningful orders (Follow / Push) — Defend-with-anchor can be the default state when hero idles in town.
3. **Co-op**: toast should say who set the stance (`@atd set DEFEND`); longer term, per-player squads.
