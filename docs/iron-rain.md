# Iron Rain — scenario-style rules

Alex approved these rules on 2026-11-27 and chose the Iron Rain name, inspired by planetary invasion in Red Rising. This is the shared build/defend/conquer style for the existing standalone defense maps, not a universal requirement for every custom game. Start with the existing maps. Recreating the supplied Custom Castle Defense map is a later task, informed by Alex's narrated playthrough and map tour.

## Shared rules

1. **Defend the economy.** Living, upgradeable buildings produce income. Resource ground requires ownership plus a living Forward Camp. Taking the flag alone does not pay periodic income. Losing the camp removes both building income and the ground's yield. One-time capture rewards and combat bounty remain.
2. **Prepare before reinforcement pressure.** Later maps pause enemy muster timers and threat escalation for 45/30/20 seconds after founding on Casual/Normal/Brutal. Existing field enemies still exist; attacking a base can provoke defenders. Greenfall retains its safe opening choice with no passive income before the first purchase, then a 15/10/7-second first-muster countdown. Marching time is additional. This is not a global invulnerability window.
3. **Choose what to fund.** Economy, troop camps, defenses, upgrades and repairs share the budget. Existing camps automatically replenish squads; no new troop-buying interface was added. Hero abilities and army orders remain available.
4. **Fight through terrain and fortifications.** Existing walls block movement; friendly troops use gates. Preserve actual traversable routes and army exits. No decorative wall replacement or terrain rewrite.
5. **Destroy reinforcement sources.** Living bases muster their troops at the base, not arbitrary captured flags. Razing a base stops its production and does not apply the legacy conquest threat increase. Existing troops remain. The last living base releases its commander when attacked. No new final army appears from destroyed bases.
6. **Push out to win.** Defend the Keep, destroy all active enemy bases, and defeat the commander. The Keep's destruction remains a loss. Killing the commander early does not substitute for destroying every base. Commander abilities can still summon units while the commander lives.

## What varies per map

Terrain, entrances, resource positions/yields, starting budget, enemy positions/compositions and map-specific tuning. Existing level IDs, seeds and authored geography are retained. Balance is not proof that every automated strategy wins.

## Boundaries and compatibility

The simulation's legacy internal mode name remains `campaign` for standalone defense maps; player-facing browser/filter/setup labels say Iron Rain. Survival, Daily, Labyrinth and runs carrying expedition armies are not opted into these rules. No overworld expansion, progression migration, premium art claim, or exact reference-map parity claim.

Snapshot version 16 stores preparation and commander deployment; versions 12–15 remain loadable using their previous rules. Protocol 29 rejects stale peers before joining. Commander-release state and preparation participate in lockstep hashing. An existing revival-timer underflow exposed by the new playthrough was clamped to zero to preserve reload equality.

## Verification

- `tests/iron-rain.test.mjs`: preparation/difficulty, restoration, income construction/upgrade/destruction, dead-source muster prevention, commander source and victory, mode isolation, hash coverage and revival timer.
- `scripts/castle-core-journey.mjs`: real menu/map/setup clicks, laptop/phone/landscape captures; founding is a disclosed simulation fixture.
- `scripts/core-defense-playtest.mjs`: command-only play, no gold/health/win mutations.
- Existing full check, terrain/exit/playthrough tests, local production build and local two-browser multiplayer gate remain required.

Evidence: `/home/atd/.openclaw/workspace/outputs/zillions-iron-rain-20261127/`. Results and known limits belong in the review report, not normal player UI.
