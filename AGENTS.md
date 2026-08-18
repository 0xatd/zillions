# AGENTS.md

Use this file as the entry point for agent work in Zillions.

## Read Order

Read these files before you change code:

1. `docs/product-contract.md`
2. `docs/architecture.md`
3. `docs/agent-brief.md`
4. `docs/backend.md` for account, API, or data work
5. `docs/art-direction.md` and `docs/art-pipeline.md` for 3D asset work
6. The relevant source files and checks

Use `llms.txt` when you need a compact repository index.

## Product Boundary

Zillions is a sci-fi planet-conquest siege game. The core loop is:

1. Control one hero.
2. Found one terrain-aware colony.
3. Fund planned plots with gold.
4. Produce autonomous squads.
5. Take lane nodes.
6. Destroy every hive and the final champion.

The loop is continuous. Do not add a day, night, dawn, or bell phase.

The main menu is multiplayer-first. Story Campaign, Survival, and The
Labyrinth belong under Play Solo. The Labyrinth is a no-building hero
gauntlet (`mode === 'labyrinth'`, level ids 9001+): keep it free of colony,
economy, and army systems, and never let its wins advance campaign progress.

## Hard Invariants

### Simulation

- Keep the simulation deterministic.
- Use the seeded simulation random source. Do not use `Math.random()` in
  simulation code.
- Preserve snapshot and restore behavior for all simulation state.
- Keep movement fixed to world and minimap directions.
- Keep the camera yaw fixed during play.
- Use `levelById()` for level lookup. Do not index `LEVELS` by level ID.

### Maps and Colonies

- Keep one unique landform and one unique colony plan for each Earth mission.
- Read city sites, hive sites, lane nodes, and chokepoints from terrain.
- Use water, crag, and deep woods as natural barriers.
- Keep each colony boundary closed and each principal gate open.
- Keep troop exits and hero spawn tiles reachable.
- Read `docs/thronefall-map-engine.md` before you change terrain rendering.
- Read `docs/fortress-inspiration.md` before you change colony generation.

### Gear and the Lattice

- An item is a key. Rolled keys resolve through `resolveItem()`; authored keys
  resolve from `ITEMS`. Read either through `itemInfo()`, never `ITEMS[key]`.
- Keep item generation pure and off the simulation random source.
- Keep local weapon mods out of the global mod bag.
- Keep Lattice effects as data. A rule-changing node is a flag, and the rule
  lives in `src/game.js` with a committed check.
- Resolve gear and the Lattice at run start. Never query them during a run.
- Prune allocations on load. A tree that changes shape must refund, not break.
- Keep equipment, doctrines and the drawn weapon set in the lockstep hash.
- Every hero's signature weapon must stay identical to that hero's own stats.

### Heroes

- Keep this roster: Scott English, Alexander Thomas, Danny Donovan, Turtle
  Voss, John Marlowe, Tiger Reyes, and Aaron Whitlock.
- Treat `src/config.js` as the source of truth for hero data.
- Keep hero progression valid through level 100.
- Preserve temporary ability state through save, reconnect, and Watch restore.
- Do not invent portrait or voice paths for heroes without approved assets.

### Multiplayer

- Supabase owns identity, rooms, seats, chat, saves, and match history.
- WebRTC carries match commands.
- The backend is not server-authoritative.
- Block stale protocol and build versions before they take a seat or Watch.
- Require each occupied seat to be connected and campaign-eligible.
- Require each guest to mark Ready in the room.
- Clear guest Ready when the host changes match setup.
- Start window 0 only after each guest finishes battlefield loading.
- Keep the adaptive consecutive-window buffer and repair requests.
- Never force-start with a disconnected player.
- Never create a seat for a watcher or an unknown mid-match account.

### Identity and Data

- Use the Zillions Supabase project: `skqggyvkblqtyggtcxbc`.
- Show the claimed public username.
- Never show email addresses or Google profile names.
- Never seed fake rooms, players, activity, or statistics.
- Never commit secrets, service keys, environment values, or credentials.
- Do not point Zillions at another product backend.

## Code Map

- `src/config.js`: balance, heroes, levels, plots, items, and siege constants.
- `src/game.js`: deterministic simulation and snapshots.
- `src/terrain.js`: terrain field and terrain-derived sites.
- `src/galaxy.js`: procedural star systems, world kinds, and world descriptors.
- `src/factions.js`: faction roster, presence archetypes, and ownership.
- `src/items.js`: item bases, weapons, affixes, damage types, and item generation.
- `src/skilltree.js`: the Lattice — sectors, tree generation, allocation, payload.
- `src/meta.js`: persistent meta-progression state, upgrade tree, and payouts.
- `src/map.js`: Three.js terrain rendering and set dressing.
- `src/plots.js`: colony plans, gates, ramparts, and plots.
- `src/lanes.js`: deterministic lane graph.
- `src/flowfield.js`: pathfinding fields.
- `src/main.js`: runtime composition, renderer, input, saves, and co-op.
- `src/ui.js`: menus, room UI, HUD, and overlays.
- `src/online.js`: Supabase lobby, rooms, seats, and signaling.
- `src/net.js`: WebRTC transport and diagnostics.
- `src/auth.js`: authentication and profile sync.
- `src/backend.js`: Vercel API client.
- `src/supabase.js`: shared Supabase client and write timeout.
- `api/`: Vercel server routes.
- `supabase/schema.sql`: database schema source.

See `docs/architecture.md` for data flows and module details.

## Change Procedure

1. Fetch the current pull request base.
2. Create a focused branch from that base.
3. Read the full affected flow before you edit.
4. Make the smallest complete change.
5. Add a committed regression check for each fixed bug.
6. Run `npm run check`.
7. Run `git diff --check`.
8. Validate all audio JSON files if audio paths changed.
9. Run a local production build.
10. Open a pull request with the risk and test evidence.

Do not call a pull request deployable before the local production build passes.

## Review Procedure

Review the full pull request diff against its declared base.

Check these risk areas explicitly:

- deterministic simulation and snapshot state
- multiplayer startup, reconnect, Watch, and repair
- map reachability and troop exits
- authentication and public identity
- Supabase schema and row ownership
- production environment assumptions
- browser performance and Three.js resource cleanup

Use `docs/review-guide.md` for the full gate.

## Required Commands

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

Scan for secrets before you push:

```bash
rg -n 'source credential|api key|private key|sb_publishable_' . \
  --glob '!node_modules/**' \
  --glob '!.vercel/**'
```

## Manual Smoke Test

Test the affected flow in a browser. For broad changes, also test:

1. Sign in and reach the main menu.
2. Start an Earth campaign mission.
3. Found a colony.
4. Build and upgrade one plot.
5. Change the army stance.
6. Verify that squads and hives continue to muster.
7. Create, join, Ready, start, leave, and close an online room.
8. Verify that `assets.html` still loads.
9. Verify that `art-slice.html` loads when the change touches 3D art.

## Production Art Rules

- Keep the procedural fallback until an authored GLB passes gameplay QA.
- Presentation assets must not change collision, pathfinding, combat, save
  state, or lockstep hashes.
- Review every asset at gameplay distance and in silhouette mode.
- Keep each asset origin at ground center.
- Use the node and socket names in `docs/art-direction.md`.
- Run `scripts/art-asset-check.mjs` before a model PR is called mergeable.
- Keep terrain-derived walls and gates assembled along the generated rampart
  path. Do not replace them with one generic fort prefab.

## Documentation Rules

- Use short sentences and active voice.
- Use one term for one concept.
- Mark future systems as future systems.
- Do not copy old QA findings into current-state documentation.
- Update `README.md`, `docs/architecture.md`, and `llms.txt` when module
  ownership changes.
- Update `docs/product-contract.md` when product boundaries change.
- Update `docs/backend.md` when service or data ownership changes.
- Update `docs/art-direction.md` when the visual language, scale, budgets, or
  socket contract changes.
