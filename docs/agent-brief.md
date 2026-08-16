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
- Node placement comes from terrain analysis (`TerrainField._findNodeFeatures`):
  a summed-area openness field finds fords and clearings, tile clustering finds
  ore and quarries, mountain counts find barrows. Kinds are drawn round-robin
  against per-kind quotas so every map has a mix, and the quota is per-landform
  (`TERRAIN_SHAPES[kind].nodes`) so a fen is a map of fords and the wastes are
  stone and ore. Pure function of the tiles — no RNG, because lockstep peers
  must agree.
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
- Node works (`Game._buildNodeWorks`) are created in `_buildLaneSystems`, which
  runs on BOTH found and restore — keep it a pure function of map + node, never
  `this.rng`, or lockstep peers desync. Plot ids come from fixed bases so they
  survive a reload. `plotLocked` gates anything with a `nodeId`.
- Field loot lives in `game.loot`, is scattered once in `_setupStart` (seeded),
  and round-trips through the snapshot. Pickup and drop are sim-side, so the
  drop key goes over the wire as a `drop` command like every other input. A
  hero's `pack` is separate from career `items`; mods are the sum of both, via
  `_refreshPackMods`.

## Maps and Cities

- Every level names a landform (`theme.terrain`) and a city plan
  (`theme.city`). Both must stay unique per level — `scripts/map-check.mjs`
  fails the build if two levels share either, because that is exactly how the
  maps became interchangeable last time.
- `TERRAIN_SHAPES` in `src/terrain.js` paints a pattern (basins, ridged crag
  lines, barrow domes, a rift band with passes) and then thresholds it by
  COVERAGE QUANTILE, not by a fixed noise value. That is why a map is always
  playable however the noise landed: "19% of this planet is crag" holds either
  way. Change the pattern freely; change the coverage carefully.
- Nothing may be marooned. `_carveWarRoads` gives every hive a road toward the
  nearest site, and `_connectFrontier` floods from the heart site and bridges
  anything it could not reach. The check asserts every hive is reachable from
  every site — a marooned hive is an unwinnable campaign.
- `CITY_PLANS` in `src/plots.js` is a radial silhouette `radius(t, R)` plus a
  gate list, both in the city's own frame where `t = 0` faces the hives. The
  rampart tracer walks one axis at a time, so any silhouette stays closed and
  4-connected. Gate-flanking towers are placed from the gate tile
  (`gateFlank`), never by angle offset — an angle offset lands outside the wall
  on a star or a throat.
- Founding levels the INTERIOR only (`d < radius - 2.2`). The rampart band is
  left as the land made it, and ring tiles that are impassable become free,
  indestructible wall. A wall plot's `tiles` are only the open tiles of its
  side, so barriers (which cost per tile) get cheaper on good ground. A plot
  may now have `gate: null` — use `plot.anchor` for build targeting and UI, and
  guard `plot.gate` before dereferencing it.
- Every gate gets two towers and a ward camp in `generatePlots`, not in the
  per-plan layouts; layouts only place districts and their signature towers.
  `map-check` asserts the ward kit, and asserts squads actually get OUT of the
  city under the attack stance — friendly units only pass buildings in
  `gateIds`, so a city whose gates the terrain closed would trap its own army.
- `TerrainField._findChokepoints` finds gaps 2-9 tiles wide pinched between
  impassable masses; `pickOuterWorks` turns the best three near the city into
  fence + watchtower plots. Outer works always carry a gate.
- The historical reasoning behind all of the above is in
  `docs/fortress-inspiration.md`. Read it before redesigning any of it.
- The check plays two real minutes of siege on every level's real terrain
  (lane graph, hive musters, the horde's walk to the walls). If you change map
  generation, run `node scripts/map-check.mjs --report` and read the numbers.
- Nothing auto-repairs. `plotAction()` returns `build | branch | repair |
  rebuild`, all funded with the same hold-to-build verb.
- Hives have real health, spit defenders when damaged (`defendT`), and blight
  the ground within `NEST_BLIGHT_R`. Units siege a hive even while its garrison
  swarms, unless something is inside `SIEGE_GUARD_R`.
- Campaign win: raze every hive, then kill the champion of the final
  counterattack. Loss: the Keep falls.

## Balance Status

Do not claim current completion times from the automated suite. The repository
does not run an end-to-end victory bot today.

Current automated guarantees:

- `scripts/balance-check.mjs` checks opening economy, upgrade payback, upgrade
  access, structure repair, construction refunds, supply, Threat, and campaign
  scaling invariants.
- `scripts/map-check.mjs` checks all five authored maps, early procedural
  planets, route reachability, city closure, gates, troop exits, expansion-fort
  spacing, loot, and two minutes of siege.
- Each authored level has a unique landform and city plan.
- Nest health and campaign multipliers rise across the authored campaign.
- Human playtesting is still the source of truth for difficulty and completion
  time.

Historical routing lesson:

- An older bot showed later maps finishing faster than level 1. The useful
  signal was hive-health damage per minute, not raw win time.
- Do not tune nest health, pressure, or Threat before you inspect lane topology
  and the number of troops that reach each hive.
- Hive capture of neutral nodes can compound pressure. Validate that behavior
  with human multiplayer tests before increasing it.

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

## Multiplayer Runtime

- Supabase owns usernames, presence, rooms, room seats, chat, and invites.
  WebRTC carries match traffic. The backend does not run the simulation.
- The lobby shows signed-in usernames. It separates open rooms from active
  games. Open rooms support Join. Active games support Rejoin or read-only
  Watch.
- The room screen shows the host's mode, map, difficulty, hero, and player
  limit. Guests can select their own hero. Only the host changes match setup.
- The host cannot start until each listed player has a direct connection.
- A guest must explicitly mark Ready after choosing a hero. Changing the hero
  clears Ready. The host owns START and is implicitly ready.
- Back from online staging is a real lifecycle action. The host closes an open
  room. A guest removes their seat. Do not replace this with screen-only
  navigation or an async unload handler.
  Campaign rooms also block levels that any seated player has not unlocked.
- Match startup uses a load barrier. Each guest sends `startReady` after the
  battlefield loads. The host starts window 0 after all guests are ready.
- The host sends a lockstep window about every 66 ms. Packets repeat four
  recent windows. The host stores 64 windows for exact repair requests.
- A guest buffers 3–10 consecutive windows. The target uses measured round-trip
  time and jitter. A guest requests a missing window every 180 ms until it
  arrives.
- The diagnostics chip shows route, round-trip time, jitter, buffer state, and
  device frame time. Use it to separate network catch-up from device stalls.
- Mid-game Rejoin is only for a previously seated guest. A stranger cannot
  create a seat after the match starts. A watcher never creates a seat.

Key multiplayer files:

- `src/net.js`: WebRTC channels and connection diagnostics.
- `src/main.js`: host sequencing, startup barrier, repair, rejoin, and Watch.
- `src/online.js`: Supabase rooms, seats, roster refresh, and signaling.
- `src/multiplayer-readiness.js`: direct-connection readiness.
- `src/multiplayer-start.js`: guest load-barrier readiness.
- `src/multiplayer-eligibility.js`: campaign unlock checks.
- `src/multiplayer-pacing.js`: adaptive buffer and window history helpers.

Do not replace measured buffering with a fixed two-window buffer. Do not count
nonconsecutive windows as ready. Both changes cause repeated guest freezes.

## Failure Recovery

- `recoverableRestore()` catches a failed save restore. The UI removes the
  corrupt save and returns to the menu.
- `FrameGuard` catches an uncaught frame-loop error. The battlefield stops and
  shows a reload message. Do not hide the error and continue a damaged sim.
- `_construct()` validates the next tier before it changes plot state. Keep the
  operation transactional.

## Not Implemented

`docs/design-vision.md` describes folklore factions, fog of war, world-placed
missions, landmarks, and a strategic galaxy simulation. Those systems are not
built. The endless procedural frontier worlds are built and shipped.

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

- The canonical hero roster is Scott English, Alexander Thomas, Danny
  Donovan, Turtle Voss, John Marlowe, Tiger Reyes, and Aaron Whitlock. Do not
  rename heroes from stale branches or summaries. `src/config.js` is the
  source of truth for keys, names, stats, and abilities.
- Scott, Alexander, and Danny have portrait and voice assets. The other four
  heroes intentionally use emoji portrait fallbacks and procedural sound until
  approved character assets exist. Do not invent asset paths for them.
- Movement is fixed to world/minimap orientation, not camera-relative.
- W moves north/up, A west/left, S south/down, D east/right.
- Camera yaw stays fixed during gameplay.
- Alt toggles Space between Build mode and Fight mode. In Build mode, hold
  Space/B to build, upgrade, repair, or rebuild. In Fight mode, Space casts and
  B still builds. Build mode does not fire the special with Space; auto-attacks
  still run. Fight mode hides vacant plot rings/dots so combat stays clean, but
  actual buildings remain visible.
- Upgrades must work from all sides of a building footprint.
- City camps/barracks must stay visually road-connected. The balance check
  verifies all three city camps exist and each has a dirt road edge.
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
- `src/runtime-guard.js`: corrupt-save recovery and frame-loop failure guard.
- `src/ui.js`: account gate, menus, HUD, lobby, minimap.
- `src/config.js`: heroes, buildings, items, levels, economy, siege.
- `src/terrain.js`: landform archetypes, city sites, hive lairs, node features.
  No three.js import — keep it that way, `scripts/map-check.mjs` runs it in Node.
- `src/map.js`: map rendering only (terrain mesh, foliage, minimap).
- `src/plots.js`: city plans, ramparts, gates, build plots.
- `src/lanes.js`: lane graph, node routing, squad waypoints.
- `src/auth.js`: Supabase auth, username, profile/save/stat sync.
- `src/online.js`: account-backed room, lobby chat, friends, and game chat adapter.
- `src/multiplayer-*.js`: readiness, eligibility, startup, and pacing helpers.
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
hive musters, and lobby empty/real-room behavior. For multiplayer work, use two
real browser sessions. Verify roster stability, setup visibility, start gating,
guest loading, Watch, Rejoin, catch-up diagnostics, and simulation progress.
