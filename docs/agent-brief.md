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

## Balance Status — OPEN ISSUE, read before tuning

Balance was tuned against **simulated** runs, not human play, and there is a
known unresolved stall.

What works:

- The scaling chain works: hold nodes -> Forward Camps -> bigger army. The test
  bot reliably reaches the unit cap and holds 6-10 nodes.
- Pure turtling and pure blitzing both lose, which is the intended shape.
- Two of three hives on level 1 are razed reliably.

What does not:

- **No campaign level is completed by the test bot.** The army razes the
  nearer hives and then stalls before finishing the last one, on every level.
- An earlier build DID complete level 1 in ~13 minutes. That was a false pass:
  the lane graph was fragmented, `_routeTo` failed for most targets, and units
  fell through to steering straight at the objective. Fixing the graph made
  routing real, and real routing exposed the stall. Do not "fix" this by
  reverting the connectivity work.
- Suspected cause: squads in transit disperse to chase (`seek` is
  `max(range + 2, 10)` while pushing), so a column bound for the far hive is
  perpetually engaged in open ground and never masses on the objective.
  Two attempted fixes made it worse and were reverted: making the route outrank
  the chase (squads then walked past everything and razed nothing), and
  narrowing `seek` in transit (same). The fix likely needs squads to *mass*
  rather than to ignore combat — a rally-then-commit behaviour, or a per-hive
  assignment quota, rather than a per-unit distance rule.
- The hero is the designed swing factor and the bot steers it badly, so human
  play may already close this gap. That is untested. Do not assume it does.

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
- Hold Space/B to build, upgrade, repair, or rebuild.
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

- `src/game.js`: simulation, waves, economy, combat, save snapshots.
- `src/main.js`: renderer, input, camera, event FX, app orchestration.
- `src/ui.js`: account gate, menus, HUD, lobby, minimap.
- `src/config.js`: heroes, buildings, items, levels, economy, waves.
- `src/plots.js`: city layout, ramparts, gates, build plots.
- `src/lanes.js`: lane graph, node routing, squad waypoints.
- `src/auth.js`: Supabase auth, username, profile/save/stat sync.
- `src/online.js`: account-backed room/lobby adapter.
- `api/`: Vercel routes.
- `supabase/schema.sql`: schema and RLS source of truth.

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
upgrade from all sides, camera edge follow, attack visibility, waves, and lobby
empty/real-room behavior.
