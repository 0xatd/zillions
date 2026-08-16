# Agent Brief

Read this before you review, audit, or change Zillions.

## Current Live State

- Production URL: `https://zillions.taborlin.co`.
- Production host: Vercel project `zillions`.
- GitHub repo: `0xatd/zillions`, default branch `main`.
- Account backend: Supabase project `zillions`, ref `skqggyvkblqtyggtcxbc`.
- Static GitHub Pages is only a fallback/review build.

The live game is a sci-fi planet-conquest siege game. The player signs in with
Google, claims a public username, picks a hero, founds a city at a flagged site,
funds pre-planned plots with gold, pushes the lanes, takes nodes, razes hive
nests, and clears campaign maps.

## Shipped Combat Loop

Day, night, dawn and the bell are gone. `game.phase` is only `found` or `live`.

- Both sides run an economy. Camps muster a squad every `every` seconds forever
  and sustain a standing force of `count * CAMP_STANDING`. Every living hive
  musters its own squads on `hiveInterval(threat)`.
- Threat is the clock (`THREAT` in `src/config.js`): time + living hives +
  your own conquests. Each whole level triggers a surge — every hive musters at
  once at `SURGE_MULT`.
- Lane graph in `src/lanes.js`: deterministic BFS-built lanes between capture
  nodes, hives, and the city. Squads route node-to-node. A third of the army
  (`_isHolder`, by unit id) takes and holds nodes; the rest march on hives.
- Nodes flip on `SIEGE.captureTime` seconds of uncontested presence, pay
  `SIEGE.nodeIncome * kind.income`, and carry an `outpost` plot that is locked
  until the node is player-owned.
- Node placement comes from terrain analysis (`GameMap._findNodeFeatures`):
  a summed-area openness field finds fords and clearings, tile clustering finds
  ore and quarries, mountain counts find barrows. Kinds are drawn round-robin
  against per-kind quotas so every map has a mix. Pure function of the tiles —
  no RNG, because lockstep peers must agree.
- Kind vs owner is the design rule: `node.kind`/`node.def` (NODE_KINDS) is
  terrain and always true; `node.owner` is claimed at setup by `_claimNodes`
  (hive takes the ground furthest from the city, ~`SIEGE.hiveClaim` of it, some
  neutral ground is `empty`) and stays hidden until `node.seen` is set by
  `_updateScouting`. Garrison size follows the claim, not the kind.
- Hive-held nodes are forward staging: ~40% of a hive's muster appears there
  instead of at the nest. This moves pressure without adding volume, so taking
  that ground is worth doing for position. Note the feedback loop — the hive
  also captures undefended neutral nodes, which grows its staging. Watch for
  runaway on the larger maps.
- Income is credited automatically over `SIEGE.incomePeriod`. Coins on the
  ground come only from kills, node captures, and razed hives.
- Nothing auto-repairs. `plotAction()` returns `build | branch | repair |
  rebuild`, all funded with the same hold-to-build verb.
- Hives have real health, spit defenders when damaged (`defendT`), and blight
  the ground within `NEST_BLIGHT_R`. Units siege a hive even while its garrison
  swarms, unless something is inside `SIEGE_GUARD_R`.
- Campaign win: raze every hive, then kill the champion of the final
  counterattack. Loss: the Keep falls.

## Balance Status

Tuned against **simulated** runs, not human play. Treat the numbers as a
starting point, not a verdict.

Where it stands:

- **Greenfall Marches (level 1) completes in ~17 minutes** and **The Black Vale
  (level 5) in ~12**, both by razing every hive and breaking the counterattack.
- **Cinder Wastes (level 3) does not complete** — the bot razes 2 of 4 hives and
  stalls. It is the outlier; the other two levels win. Investigate its lane
  topology before assuming the systems are at fault.
- Pure turtling and pure blitzing both lose, which is the intended shape.
- The scaling chain works end to end: survey ground -> take nodes -> Forward
  Camps -> supply ceiling rises -> bigger army -> siege the next hive.

Known inversion, diagnosed but NOT fixed — and it is not a balance knob:

- Level 5 still finishes faster than level 1 (~9 min vs ~15). One real cause was
  found and fixed: supply used to be counted per node, so bigger maps handed the
  player a bigger army. It is now a share of the planet, so a fully held map is
  worth the same army whatever its size.
- The symptom survived that fix, and the throughput numbers say why. The Black
  Vale carries **3.6x the total hive health and 3x the hive pressure** of
  Greenfall, and the player still destroys **5.8x more hive health per minute**
  there (8,900/min vs 1,500/min). Pressure is not the binding constraint — the
  army handles any of it at 95-114 troops. What binds is **how much of the army
  actually reaches a hive**, which is a function of that map's lane topology.
- So: do NOT try to fix the campaign ordering by tuning nest health, pressure or
  Threat. Those knobs are not what is deciding it. Investigate routing and lane
  topology per map — Cinder Wastes, which never completes, is the worst case and
  the best place to look. A useful measure is hive-health-destroyed-per-minute
  rather than win time.
- Related: nest health now scales with `NEST_HP_LEVEL_SHARE` and balance-check
  asserts both per-nest and total hive health rise across the campaign, so the
  intended difficulty curve is at least encoded even though play does not yet
  follow it.
- The hive captures undefended neutral nodes, and hive-held nodes stage ~40% of
  its musters, so ignoring the map compounds against the player. That may be
  good pressure or a runaway; only human play will tell.

History worth keeping, so old mistakes are not repeated:

- An earlier build appeared to win level 1 in 13 minutes. That was a FALSE PASS:
  the lane graph was fragmented, routing failed, and units fell through to
  steering straight at the objective. Do not "fix" a regression by reverting the
  connectivity work.
- The long stall after that was three separate bugs, not balance. In order:
  routes joined at index 0 (a squad mid-lane was sent BACK to the node behind
  it, arrived, re-pathed, and oscillated forever — 114 of 114 units routed to
  the last hive with zero within 40 tiles of it); the stall detector asked "did
  it move" instead of "did it get closer"; and supply was a flat cap, so the
  player's power went flat while Threat rose and 26,000 gold sat unspendable.
- Two attempted fixes made things worse and were reverted: making the route
  outrank the chase, and narrowing the transit `seek` radius. Both caused squads
  to walk past everything and raze nothing.

## Not Implemented

`docs/design-vision.md` describes folklore factions, fog of war, world-placed
side missions, landmarks, and the planet/galaxy layers. None of that is built.
Do not describe any of it as shipped.

## Product Boundaries

- Google email is private login identity only.
- Public identity is the claimed `@username`.
- Never show email addresses or Google profile names in profile, lobby, chat,
  room, invite, or presence surfaces.
- Do not show fake rooms, fake players, fake stats, fake population, or seeded
  production activity.
- Empty lobbies should show a clean empty state.
- Do not point Zillions at Soshi, Weather.fun, or any other product backend.
- Do not restore old free-build RTS, asset-browser launcher, or debug profile
  surfaces.

## Gameplay Invariants

- Movement is fixed to world/minimap orientation, not camera-relative.
- W moves north/up, A west/left, S south/down, D east/right.
- Camera yaw stays fixed during gameplay.
- Alt toggles Space between Build mode and Fight mode. In Build mode, hold
  Space/B to build, upgrade, repair, or rebuild. In Fight mode, Space casts and
  B still builds.
- Upgrades must work from all sides of a building footprint.
- Army control is blended: squads fight automatically, but the player sets the
  global stance. `1 Defend` holds the city line, `2 Follow` escorts the hero,
  and `3 Push` walks the lanes. Do not add individual unit micro.
- Everything new must stay deterministic: seeded RNG and commands through
  `exec()`, or lockstep co-op desyncs. The lane graph is built from the map
  alone, with no RNG.
- Hero level-ups grant visible upgrade points. The player chooses Aura,
  Passive I, Passive II, or Ult Damage from the hero panel. Aura upgrades must
  stay visually obvious in world and reflected in affected ally/enemy stats.
- Campaign economy must be balanced against collectible gold.

## Key Files

- `src/game.js`: simulation, siege, economy, combat, save snapshots.
- `src/main.js`: renderer, input, camera, event FX, app orchestration.
- `src/ui.js`: account gate, menus, HUD, lobby, minimap.
- `src/config.js`: heroes, buildings, items, levels, economy, siege.
- `src/plots.js`: city layout, ramparts, gates, build plots.
- `src/lanes.js`: lane graph, node routing, squad waypoints.
- `src/auth.js`: Supabase auth, username, profile/save/stat sync.
- `src/online.js`: account-backed room, lobby chat, friends, and game chat adapter.
- `api/`: Vercel routes.
- `supabase/schema.sql`: schema and RLS source of truth.

Signed-in social state belongs in Supabase: `lobby_chat` for global lobby chat,
`friendships` for friend requests and online state, and `room_chat` for both
setup-room chat and in-game team chat through the `channel` column. Keep Vercel
Blob as legacy/dev compatibility only.

## Required Checks

Run these before claiming a change is good:

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

For gameplay work, also run a browser smoke on local and production when
practical. Cover account gate, username display, city founding, building,
upgrade from all sides, camera edge follow, attack visibility, lane pushes,
hive musters, and lobby empty/real-room behavior.
