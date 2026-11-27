# Castle Defense core — scope and evidence

## Decision
Alex paused overworld expansion. Build a futuristic Custom Castle Defense in Zillions style, then multiple fun maps. Preserve existing strategic work separately at `codex/reference-integration-20261127`, checkpoint `6decb54`; that is incomplete WIP, not a release.

## Reference
https://www.hiveworkshop.com/threads/custom-castle-defense-v10-8-1.334260/
Direct retrieval returned HTTP403. Search-indexed description (not direct page/video verification) describes builders, income mills, fortifications, a small starting force, customizable heroes, escalating attacks, destroying enemy bases and a final boss. Exact wave counts, pacing and version behavior remain unverified. Do not claim visual/art parity with the supplied WC3 screenshots.

The existing Zillions core already supplies construction crews, income structures, troop camps, hero progression, hive pressure, capture nodes and a final boss. No overworld is needed to prove this loop.

## Implementation focus
- Direct Play → map → hero/setup → battle; no mandatory world travel or character creation.
- Keep original richly framed sci-fi HUD and grounded battlefield material improvements.
- Mixed starting squad (two soldiers, three rangers per hero) for fresh campaign-mode defenses without an expedition army; existing saves do not receive extra troops.
- Safe opening pauses both pressure and income, preventing an unlimited gold farm before first purchase.
- Explicit first-attack status when relief expires and new attacks resume.
- Curate Greenfall, Cinder and Rotmire first using their existing distinct geometry. Keep other maps and IDs intact.

## Three polish passes — acceptance, not labels
1. Gameplay: founding, economy/defense/army openings, orders, attack and recovery, defeat/victory, restart and no duplicate starter troops. Full active playthrough and balance evidence required; automated state checks do not prove fun.
2. Presentation/controls: inspect actual laptop, phone and landscape; crafted HUD, readable combat/targets, usable menus, no obstructed start/actions. Fix observed issues.
3. Verification: relevant regressions, local production build, replay/network consistency, performance and end-to-end journey. Authenticated staging remains unavailable; local fixtures must not be described as signed-in staging proof.

All three remain incomplete until integrated checks and fixes are recorded. No merge or production deployment.
