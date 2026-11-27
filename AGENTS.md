
## Custom Games-only direction — Alex, 2026-11-27 21:15 UTC

Enter World stays gray and disabled. Custom Games is the only active play/development path. Start with the existing maps; then attempt to rebuild the Custom Castle Defense reference map in Three.js. Good, approved standalone scenarios may eventually be reused in the overworld; that integration is not current scope. Preserve world code and progression.

## Current scope override — 2026-11-27

Alex explicitly paused overworld/campaign expansion. The active goal is futuristic Custom Castle Defense in Zillions style: first prove the core, then several distinct fun maps, with three documented polish passes. Preserve world/roster work on `codex/reference-integration-20261127` (checkpoint6decb54); do not resume without Alex. Earlier shared-world/Enter World navigation requirements below are historical and superseded for this core branch. Retain accounts/saves; do not delete user progression. Custom map play should be reachable directly without world travel or mandatory character creation.

## Party and Custom Battle language (Alex, 2026-11-27)

Main-game grouping is **Parties**, not a separate Co-op mode: WoW-style persistent
social parties within the shared Bannerlord-style space world. Members can
travel together or separately and join encounters. Custom Battles is the separate
WC3 Reforged-style game browser/map/lobby/Ready experience. Joining or leaving a
custom lobby must not replace persistent world-party membership. Legacy internal
`coop` transport identifiers can remain for compatibility; player-facing copy
must distinguish party membership from temporary battle participation.

# AGENTS.md

## Social and Custom Battles (Alex, 2026-11-26)

Custom Battles replaces the title Party & Friends entry and sits directly below
Enter World in character selection. Friends is an independent persistent panel
available from menu, lobby and play, not buried in Account. Reuse account-wide
friendships and persistent friend parties; use SC2/WC3-style custom room browsing,
map setup, slots and Ready controls. Campaign battles originate at overworld
sites, not an arbitrary map picker. See `docs/social-custom-navigation.md` for
implemented behavior and explicit remaining limits.


Use this file as the entry point for agent work in Zillions.

## Shared-overworld decision (Alex, 2026-11-26)

**The overworld itself is multiplayer:** WoW-style cooperative parties inside
one persistent Bannerlord-style strategic map shared by everyone in that
world/realm. It is not a collection of private party worlds, nor a solo
mission selector that becomes multiplayer only when a battle starts. Players
can travel together or separately and encounter other players and parties.
Party membership is a social/cooperative grouping within the world, separate
from character identity, faction membership, rank and political hierarchy.
The current four-seat battle-room limit is not a limit on the shared world's
population. Do not infer PvP or faction leadership from this design.

Returning characters enter that world directly. New characters use guided
creation and the first-world introductory campaign. Whether tutorial content
or battles use separate instances is not decided here; do not silently make
the whole overworld private. Shared-world time cannot pause for one player's
menu; battle readiness barriers concern encounter participants, not everyone
in the realm.

This is the new product decision superseding older "siege game only / no
living world" target language below. The shipped baseline still has a campaign
mission selector, private co-op rooms and siege battles—not shared strategic
travel, world population or persistent world authority. This navigation PR
keeps those working and shows unbuilt destinations/actions as disabled. Do
not relabel the existing selector as a completed shared world or reactivate
removed world-worker code without a reviewed implementation plan.

### Strategic armies and tactical sieges — further clarification

Alex's intended loop: roam independently or attach your force to a larger
allied army on the shared Bannerlord-style map; encounters transition into
Dota-style hero/ability combat and Zillions siege battles, then return to the
shared world with consequences. An assembled army can contain multiple
parties/warbands. Army attachment is not faction membership, political rank,
or ownership of a private world. Do not equate the existing four-friend social
party implementation with a completed strategic army system.

Keep the player character, their commanded troops/warband, cooperative friend
group, assembled army and political affiliation distinct. Exact join/leave
permissions, army movement control and battle instancing/scaling are not yet
specified; do not invent a finished system or player-count promise. This is
product direction, not authorization to pretend those backend systems exist.

## Affiliation correction (Alex, 2026-11-26)

A character is not automatically a faction ruler. Several characters and
parties may belong to the same house/faction. Houses and factions may belong
to larger kingdoms/empires. Character, party, political membership, leadership
rank and organizational hierarchy are separate concepts. The navigation must
not force faction founding during character creation. The existing account
chapter is a shared campaign banner, not an implemented political hierarchy.
Join/found affiliations and parent relationships stay disabled until built.
No membership migration or simulated hierarchy is part of this navigation PR.

## Leader-first navigation (Alex, 2026-11-26)

This decision supersedes older chapter-first and mode-hub entry guidance.
Existing players select a persistent leader and press **Enter World**. New
leaders use a separate guided creation flow: origin, appearance, archetype,
background, affiliation, review. Cancel does not create a leader. The current
account-wide faction, campaign progress and economy are preserved; separate
factions per leader are not implemented.

The first world is the introductory campaign destination. Today it exposes
existing Earth missions and companion recruitment, not simulated travel or a
shared multiplayer overworld. Custom Games, invites, parties and existing
sieges remain available. Future planets, travel, strategic actions and new
archetypes are visibly disabled. Do not turn disabled buttons into fake demos.

The initial 20-archetype reference list is an OpenDota public-pick snapshot,
not a permanent ranking or a claim of implemented kits. See
`docs/leader-navigation.md`. Only Vanguard is available in custom creation;
previously recruited heroes remain playable. Requested future art direction:
space-marine interpretations of human archetypes and distinct science-fiction
alien interpretations. This pass adds no new archetype kits or abilities; it improves presentation of existing models.


## Fortress craft

Use the installed `rts-fortress-design` skill for walls, gates, bases and terrain
junction work. Read `docs/reusable-map-kit.md` for implementation and all-map
coverage. Passing path checks does not establish visual quality.

## Map composition requirement

Read `docs/reusable-map-kit.md` before map/layout work. Alex rejected the
streets-only #136 visual result; passing connectivity tests is not design approval.
Use reusable pieces and purposeful authored compositions, not scattered plots.

## Read Order

Read these files before you change code:

1. `docs/product-contract.md`
2. `docs/architecture.md`
3. `docs/agent-brief.md`
4. `docs/backend.md` for account, API, or data work
5. `docs/art-quality-standard.md`, `docs/art-direction.md`, and `docs/art-pipeline.md` for any visual or 3D asset work
6. The relevant source files and checks

Use `llms.txt` when you need a compact repository index.

## Chapter direction — Alex, 2026-11-22

Chapter-first account progression is now authorized: customizable chapter and
founder, named hero companions recruited by conquest, five Earth city campaigns,
then the existing frontier. The newer leader-first entry supersedes this
historical navigation; account progression and siege invariants remain. Read
`docs/chapter-campaign-plan.md` and the updated product contract.

## Product Boundary

Current implementation: Zillions has a sci-fi siege loop. Earlier shared-world
code was removed. The new shared-overworld decision above changes the product
target, not the current implementation status. Today the campaign selector
is a menu of planets/sites. Preserve this existing encounter loop:

1. Control one hero.
2. Found one terrain-aware colony.
3. Fund planned plots with gold.
4. Produce autonomous squads.
5. Take lane nodes.
6. Destroy every hive and the final champion.

The loop is continuous. Do not add a day, night, dawn, or bell phase.

The menu is one Bannerlord-style shell over the live planet. Boot opens the
title word list (Play, Squad, Armory, Settings, Account; Credits in the
footer). Sign-in lives on Account. Character Select sets the active character.
Enter World opens the campaign. Other battles is a secondary mode registry
with Campaign, Co-op, Versus, and Custom.
Campaign opens the star-system overworld; assaulting a site starts the siege.
Co-op holds Survival, The Labyrinth, Daily Siege, and Arcade. Versus is visible
and marked Coming soon until player-versus-player exists. Custom is the one
game browser. Unbuilt actions stay on screen, grey, and disabled. The
Labyrinth is a no-building hero gauntlet (`mode === 'labyrinth'`, level ids
9001+): keep it free of colony, economy, and army systems, and never let its
wins advance campaign progress. The campaign overworld is a menu of planets
and sites today; it does not yet implement the shared-overworld target.

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

### Controls

- Declare an action in `src/keybinds.js`. Never dispatch on a key literal.
- Two actions whose scopes overlap may not share a key. Scope is where an
  action listens, not the group it is displayed under. Alternates count.
- Update the README controls table with any binding change. `keybind-check`
  compares them and fails on a mismatch in either direction.
- Army stances stay off the number row. 1 and 2 are reserved for consumables.

### Gear and the Lattice

Read "Why This Exists" in `README.md` before reviewing a change here. It records
what this system was for and the boundary it was built under: the structure is
learned from an action-RPG passive tree, none of that game's content was
imported, and four constraints — a readable tactical minute, deterministic
simulation, agreeing lockstep peers, and unbroken saves — decided every trade.

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

Alex reduced the Dota-reference expansion to Lina, Sniper, Axe and Sven on
2026-11-23. Do not implement the remaining reference roster without a new request. The older
fixed-name roster below is now the legacy compatibility set, not a ban on new
kits. Preserve legacy character IDs and gear. See `docs/roster/implementation.md`
for completed mechanics and explicit gaps; a catalog entry is not a playable kit.

- Keep this roster: Scott English, Alexander Thomas, Daniel Donovan, Turtle
  Voss, John Marlowe, Tiger Reyes, and Aaron Whitlock.
- Treat `src/config.js` as the source of truth for hero data.
- Keep hero progression valid through level 100.
- Preserve temporary ability state through save, reconnect, and Watch restore.
- Do not invent portrait or voice paths for heroes without approved assets.

### Multiplayer

- Supabase owns identity, rooms, seats, chat, saves, and match history.
- Private Supabase Realtime channels carry signed-in player-room commands.
  Per-sender RLS checks both room seats. Invite links retain their separate
  WebRTC/Realtime fallback; Watch retains WebRTC. All use the same lockstep messages.
- The backend does not run the combat simulation. It is authoritative for
  rewards: only `api/match-result.js` (via `apply_match_result()`) grants
  signed-in XP, levels, loot, Alloy, and stats. Never add a client write path
  for `player_stats`, `match_history`, `game_characters`, `item_instances`, or
  `player_wallets`, and never trust a client-claimed reward.
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
- `src/items.js`: item bases, weapons, affixes, damage types, and item generation.
- `src/skilltree.js`: the Lattice — sectors, tree generation, allocation, payload.
- `src/lockstep-hash.js`: the per-window state hash every peer compares.
- `src/keybinds.js`: the control scheme — actions, defaults, and rebinding.
- `src/meta.js`: guest (offline) Alloy ledger, meta-upgrade tree, and threat tiers.
- `src/match-rewards.js`: pure, shared match-reward rules (validation, loot
  proofs, quests, XP, Alloy). Used by `api/match-result.js` and the client.
- `src/match-outbox.js`: unconfirmed signed-in match reports, resent by requestId.
- `src/map.js`: Three.js terrain rendering and set dressing.
- `src/plots.js`: colony plans, gates, ramparts, and plots.
- `src/lanes.js`: deterministic lane graph.
- `src/flowfield.js`: pathfinding fields.
- `src/main.js`: runtime composition, renderer, input, saves, and co-op.
- `src/nav/router.js`: menu route stack, back, one modal, toasts, and match-allowed routes. `src/shell-state.js` re-exports it.
- `src/modes.js`: play-hub mode registry. Coming soon modes stay visible and disabled.
- `src/ui.js`: menus, room UI, HUD, and overlays. `src/shell-markup.js` is the menu DOM. `shell.css` holds menu tokens and HUD lanes.
- `src/online.js`: Supabase lobby, rooms, seats, and signaling.
- `src/net.js`: WebRTC transport and diagnostics.
- `src/auth.js`: authentication, profile sync, and server-progress hydration.
- `src/backend.js`: Vercel API client.
- `src/supabase.js`: shared Supabase client and write timeout.
- `api/`: Vercel server routes. `api/match-result.js` grants match rewards;
  `api/economy.js` owns Market, stash, and Forge transactions.
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
npm run check:postgres   # local throwaway Postgres; never a real project
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
2. Press Deploy and start an Earth campaign mission.
3. Found a colony.
4. Build and upgrade one plot.
5. Change the army stance.
6. Verify that squads and hives continue to muster.
7. Create, join, Ready, start, leave, and close an online room.
8. Finish a signed-in match and confirm the end screen shows the
   server-confirmed XP, loot, and Alloy.
9. Verify that `assets.html` still loads.
10. Verify that `art-slice.html` loads when the change touches 3D art.

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

## Signed-in player relay (protocol 26)

`src/room-relay.js` carries player-room lockstep messages over private Supabase
Realtime channels, one authenticated sender and recipient per connection.
Migration `20261126000100_private_room_relay.sql` requires both player seats
and a host endpoint. Outsiders cannot receive; recipients cannot publish as
the sender. Each reconnect uses a new UUID topic. Packets are acknowledged,
retried and deduplicated; missing activity closes the connection. Ready and
the all-loaded start barrier are unchanged. Watch still uses WebRTC and may
need TURN on restrictive networks. The backend does not simulate combat.
