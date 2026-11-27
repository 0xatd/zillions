# Castle-defense core: bounded three-map set

Read-only review, 2026-11-27. Overworld work is paused. Recommendation concerns standalone futuristic Custom Castle Defense gameplay using the existing terrain, plots, armies and defenses—not a new map engine.

## Recommendation

Ship three **different decisions**, not five differently colored missions:

1. **Greenfall / Frontier Hold** — learn an opening and hold a readable line.
2. **Cinder / Crossfire Foundry** — split defenses and move a hero reserve between fronts.
3. **Rotmire / Causeway Extraction** — choose when to leave safety for valuable income.

Names after the slash are proposed player-facing names, not implemented renames. Keep existing level IDs/seeds. Offer this curated order without moving entries in `LEVELS` or breaking `levelById`/save identity. Pin site 0 for the first acceptance pass; three selectable sites per map multiply balancing work unnecessarily. Alternate sites can remain optional later.

## Evidence: generated landforms, not menu descriptions

Generated each actual `TerrainField(level.seed, level.theme, {size:200,nests:level.nests})`, then `generatePlots` for site 0. All five maps have different landform archetypes and site rims. Counts below are planned plots, **not buildings already owned at match start**.

| Existing map | Seed / first keep | Actual perimeter | First-site plots / towers | Hives | Real tactical distinction |
|---|---|---|---|---|---|
| Greenfall | 20101 / (100,96) | Three rides through a forest rim | 52 / 16 | 3 | Open approaches around a compact protected clearing; shortest of the three proposed opening fronts |
| Rotmire | 20202 / (108,72) | River bend; two neighboring front gates and rear ford/postern | 46 / 9 | 3 | About 30% water, constrained departures and long return trips; fewer tower slots |
| Cinder | 20303 / (92,128) | Fully walled octagonal ring, four quarter gates | 61 / 21 | 4 | Broad exposed badlands and separated approaches; cannot use a river/cliff as a free flank |
| Barrow | 20404 / (72,104) | Long cliff-backed ridge, nose and heel gates | 46 / 13 | 4 | Two-ended defensive spine, ramps and restricted lateral movement |
| Black Vale | 20505 / (120,116) | Cliff-backed valley head, main mouth and side postern | 46 / 11 | 5 | Narrow local entry geometry with a broader regional rift/pass network; existing authored economic district composition |

The `bastion` plan blurb says **four gates**, but generated Greenfall has **three**. Rotmire's site-0 flavor calls it “Old Crossroads,” but its generated rim is a river bend. UI copy is not reliable geometry evidence. Correct labels in parent implementation rather than changing working terrain to fit stale text.

Landform generators: moor broad noise + river; fen basins + two rivers; wastes ridge-contour canyons; hills separate mounds/shelves; vale a sinuous mountain band with three authored broad pass depressions. Later frontier connectivity carving means “only three routes across the entire map” is not established by that formula alone. Similarly four city gates do not prove four simultaneous enemy fronts.

## Smallest changes per selected map

### 1. Frontier Hold — Greenfall, seed 20101, site 0

**Question:** can I afford economy now, or must I stabilize the line first?

- Reuse the existing level-1 `firstSiege` opening/telegraph/defend/reward flow. It already picks the closest live hive and delays the others; do not build a second tutorial state machine.
- Existing hive anchors: west (30,93), east (174,108), south (117,180). Four-neighbor terrain-only walk lengths from keep are 73, 104 and 101 tiles respectively.
- Use the western first contact to teach one defense purchase, an army order and one hero ability. Activate a second front only after the opening is understood; retain three exits for sorties.
- Existing nearby ore (72,89) and clearing (78,114) are 35 and 42 terrain steps away, so a short optional sortie is already available after the hold.
- Bounded tuning: opening force/timing and a clearly telegraphed second threat. Preserve the current starting economy as baseline (58 gold, income 1.0, pressure .9) until tested.
- Acceptance: a novice can explain where the first wave comes from and recover from a suboptimal opening; neither blind waiting nor constant hero kiting should be the sole winning solution.

### 2. Crossfire Foundry — Cinder, seed 20303, site 0

**Question:** where should the mobile reserve go while static defenses hold elsewhere?

- Reuse the four-gate octagon, 21 tower slots and existing army orders. The shell has 61 total plots; do not require constructing all of them to win.
- Hive anchors: west (30,114), east (171,129), southeast (132,171), southwest (33,183). Terrain-only paths are 76, 80, 83 and 114 tiles. Similar west/east distances make deliberately overlapping arrival windows feasible.
- Actual hive positions are **not** one per cardinal direction. Advertise two-front/crossfire defense, not four-sided attack, until replayed routes prove otherwise.
- Bounded tuning: authored wave timing for two separated west/east threats, then an optional southern reinforcement. Preview origin and composition before commitment. Do not move spawns merely to create an untelegraphed rear ambush.
- Use different existing compositions for the two fronts so the hero and troop split matters; no new unit family is necessary. Existing tower-disabling boss is a later counter to pure turret camping, not the first lesson.
- Acceptance: simultaneous meaningful pressure at two different entrances is observed in actual combat; one central stationary blob cannot trivially cover both, but rotating reserve can. Start from current economy 72 / 1.08 / 1.0 rather than assuming a higher global difficulty multiplier alone makes the map distinct.

### 3. Causeway Extraction — Rotmire, seed 20202, site 0

**Question:** is richer forward income worth leaving my defended neck of land?

- Reuse the two front gates/rear ford, actual water barriers and existing claim/Forward Camp mechanics. No resource convoy or new territory system is needed.
- Safe-ish first option: quarry (100,43), 37 terrain steps from the keep, income factor 1.0 and existing +50% outpost HP modifier.
- More valuable options: ore (79,34), 73 steps; ore (29,60), 109 steps; ore (169,145), 134 steps. Ore pays factor 2.0. Present a reachable near-versus-rich choice, not “capture all 12 markers.”
- Enemy anchors lie south/southwest: (132,183), (24,177), (30,129). Make southern/eastern rich-ground departures compete with the need to return and defend, while leaving the nearer quarry as a viable conservative opening.
- Important trap: clearing (111,18) is only 54 tiles away straight-line but **269 terrain steps** away. Do not select first objectives or show ETA using Euclidean distance. This is a genuine water-route distinction, but a poor compulsory first capture.
- Bounded tuning: choose one near and one rich optional highlighted objective, existing node rewards, and a warned return-pressure window. Camping should still allow basic survival; expansion should shorten or strengthen the route to winning rather than be mandatory hidden homework.
- Acceptance: a player can win with conservative defense or a riskier expedition, with visibly different pacing; the added income arrives early enough to matter and a failed sortie does not turn into a hopeless long walk.

## Why stop at three

Barrow and Black Vale are already mechanically distinct landforms, but they add ramp/cliff readability, route checking and more complex pressure to balance. Keep their existing data; do not spend this first core pass on new scenarios there. Greenfall, Cinder and Rotmire cover opening, multitasking and expansion using existing rules and assets. All share the chosen sci-fi art/HUD direction and can support heroes plus armies without importing overworld rosters into this scope.

## Measurement limits and implementation gate

Distances above are deterministic cardinal BFS on generated **terrain walkability**, before building occupancy and runtime flow fields; they are not movement seconds or proof of an AI's chosen attack route. Node benefits are read from `NODE_KINDS`. Geometry was generated in Node, not judged solely from archetype comments. Existing `scripts/map-check.mjs --report` also exercises connectivity, full build access and real sortie simulation; its result is recorded below.

**Validation:** `node scripts/map-check.mjs --report` exited 0: “5 levels, 5 landforms, 6 city plans — all distinct.” Full output: `/tmp/zillions-core-map-check.log`. All 15 authored site variants completed its checks. Its measured natural-boundary shares also substantiate the contrast: Greenfall 54–61%, Rotmire 79%, Cinder 0%, Barrow 58–62%, Black Vale 76–79%. These are shares of perimeter closed by terrain, not whole-map obstacle coverage.

For each candidate, parent should run actual opening → crowded defense → win/loss and a second strategy, confirm declared wave entrances from real trajectories, and inspect near/far/mobile/Low/high frames. Keep all existing occupancy and snapshot contracts. Document gameplay-profile changes instead of claiming the unchanged map engine itself was redesigned. “Fun” remains a playtest result, not something this read-only geometry review proves.

No production code, configuration, maps, staging services or deployments were changed by this review.
