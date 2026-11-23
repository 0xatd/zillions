# Architecture

This document explains the current Zillions runtime. It describes shipped
code. It does not describe future product plans.

## System Boundary

Zillions has three runtime layers:

1. The browser runs rendering, input, UI, and the complete combat simulation.
2. Supabase stores durable account and multiplayer coordination data.
3. Vercel serves the static application and same-origin API routes.

The production backend is not server-authoritative for combat. It is
authoritative for rewards: signed-in XP, levels, loot, Salvage Alloy, and
stats are granted only by `api/match-result.js`.

## Browser Startup

`index.html` loads `src/main.js` as the application entry point.

The startup flow is:

```text
index.html
  -> src/main.js
     -> account gate
     -> chapter identity + founder creation, or existing chapter campaign
     -> Deploy -> mission select, Custom Games, or an online room
     -> deterministic siege
     -> end screen with server-confirmed rewards
     -> chapter campaign and recruited companions
     -> Three.js render loop
```

`src/shell-state.js` owns the shell base state and temporary overlay state.
Character Select is the normal signed-in base state. Menus are temporary
overlays. There is no overworld; the living world was removed.

`src/main.js` composes the system. Keep domain rules in smaller modules when a
module already owns that rule.

## Module Ownership

### Simulation

| File | Ownership |
| --- | --- |
| `src/game.js` | Deterministic game state, commands, combat, economy, buildings, snapshots, and restore |
| `src/builders.js` | Shared colony crew orders, job planning, travel, refundable construction escrow and recovery |
| `src/config.js` | Heroes, levels, plot definitions, items, balance constants, and `levelById()` |
| `src/lanes.js` | Deterministic lane graph and route data |
| `src/flowfield.js` | Flow-field pathfinding |
| `src/multiplayer-windows.js` | Lockstep window helpers |
| `src/multiplayer-pacing.js` | Adaptive buffer targets and repair history |
| `src/multiplayer-readiness.js` | Direct connection readiness |
| `src/multiplayer-eligibility.js` | Campaign unlock eligibility |
| `src/items.js` | Item bases, weapon blocks, affix pools, damage types, and deterministic item generation from a key |
| `src/vendor.js` | Deterministic stock and valuation; mutation helpers are offline-only |
| `src/economy.js` | Signed-in economy client, fail-closed mutations, offline legacy archive, and snapshot projection |
| `src/crafting.js` | Pure crafting recipes, socket rules, revision checks, costs, and mutation proposals |
| `src/skilltree.js` | The Lattice: sector table, seeded tree generation, allocation rules, and the resolved payload |
| `src/keybinds.js` | The control scheme: every action, its default key, and rebinding |
| `src/lockstep-hash.js` | The per-window state hash every peer compares to detect divergence |
| `src/meta.js` | Guest (offline) Alloy ledger, the meta-upgrade tree, and threat tiers |
| `src/match-rewards.js` | Pure match-reward rules shared by client and server: report validation, loot-key proofs, quest re-evaluation, XP, Alloy, item rows |

Simulation code must produce the same result on every peer. Add all new state
to snapshots when the state can affect later simulation.

### World Generation and Rendering

| File | Ownership |
| --- | --- |
| `src/terrain.js` | Deterministic terrain field, elevation, sites, nodes, and chokepoints |
| `src/colony-roads.js` | Deterministic built-footprint-aware courtyard, gate and frontage street network |
| `src/colony-art.js` | Ground-following main/service paving and clearance-checked cliff defenses |
| `src/rampart-art-plan.js` | Presentation-only wall panels, clipped corner joins and gate support fitting |
| `src/plots.js` | Colony plans, ramparts, gates, districts, and outer works |
| `src/map.js` | Three.js terrain geometry, relief, colors, rocks, and set dressing |
| `src/landscape-art.js` | Seeded instanced forest kit, edge outcrops, shrubs, fallen timber and shore reeds |
| `src/environment-art.js` | Painted world-space materials, terrain control maps and animated shallow/deep water |
| `src/tactical-visuals.js` | Tactical presentation helpers |
| `src/horde-art.js` | Per-type instanced zombie models and the shared horde writer |
| `src/unit-art.js` | Procedural troop and hero rigs with animatable limbs |
| `src/building-art.js` | Colony-kit building meshes (authored GLB dispatch + procedural fallback) |
| `src/assets.js` | Asset loading and asset paths |
| `src/audio.js` | Music, voice, and sound effect playback |

Terrain walkability belongs to the simulation. Visual relief must not silently
change walkability.

The default colony GLBs live under `assets/kit/european/`, generated from
`tools/art/toy_kit/frontier.py` for buildings and defenses. Legacy shared units
and props still use `european.py`. The culture registry selects builders without
changing simulation IDs.

Additional authored unit and building models live under `assets/art-slice/`. Their source
and export contract is in `docs/art-pipeline.md`. `src/assets.js` loads each GLB
and `src/main.js` binds named moving parts. Missing GLBs fall back to the
procedural renderer and must not stop a match from starting.

### Application and UI

| File | Ownership |
| --- | --- |
| `src/main.js` | Runtime composition, render loop, input, save flow, co-op sequencing, and Watch |
| `src/ui.js` | Main menu, setup, lobby, room, HUD, and overlays |
| `src/shell-state.js` | Auth, character, mission, overlay, and return state |
| `src/match-outbox.js` | Signed-in match reports the server has not confirmed yet, resent with the same requestId |
| `src/runtime-guard.js` | Fatal frame-loop recovery |
| `style.css` | Application layout and visual styles |

### Account and Multiplayer Services

| File | Ownership |
| --- | --- |
| `src/supabase.js` | One shared Supabase client and write timeout |
| `src/auth.js` | Google sign-in, username, profile, cloud saves, and read-only hydration of server stats and character progress |
| `src/online.js` | Rooms, seats, roster refresh, chat, presence, and signaling |
| `src/net.js` | WebRTC channels, packets, route data, latency, and jitter |
| `src/backend.js` | Same-origin Vercel API client |
| `api/auth-config.js` | Public auth configuration route |
| `api/match-start.js` | Issues signed, single-use match tickets (seed, room) |
| `api/match-result.js` | The only grant path for signed-in XP, levels, loot, Alloy, and stats; keeps input logs of leaderboard candidates |
| `api/economy.js` | Market, stash, equipment, and Forge transactions |
| `api/account-upgrades.js` | Account upgrade tree purchases, one-time local import, paid Lattice rewire |

`supabase/schema.sql` defines the durable schema.

Co-op rooms support one to four players. The first player hosts the room.
The mission uses WebRTC lockstep.

## Deterministic Simulation

The host orders commands into windows. Each peer executes the same window in
the same order.

```text
player input
  -> WebRTC command
  -> host command window
  -> repeated recent windows
  -> guest consecutive-window buffer
  -> Game.exec()
  -> identical simulation tick
```

The host sends a window about every 66 milliseconds. The host keeps 64 recent
windows. A guest requests an exact missing window until the host repairs the
gap.

Do not resume a guest from nonconsecutive windows. A gap must stop execution
until the missing window arrives.

## Multiplayer Room Flow

Supabase coordinates the room. WebRTC carries match traffic.

```text
create or join room
  -> validate protocol and build version
  -> reserve or restore a seat
  -> exchange WebRTC signaling through Supabase
  -> verify each direct connection
  -> verify campaign unlocks
  -> collect guest Ready state
  -> run shared countdown
  -> load battlefield on each peer
  -> collect startReady from each guest
  -> start lockstep window 0
```

The host must cancel startup if a player disconnects or becomes ineligible.

Watch mode does not create a player seat. Mid-match Rejoin only restores a
seat that the same account owned before disconnect.

## State Ownership

| State | Owner |
| --- | --- |
| Combat, units, buildings, loot, and Threat during a match | Browser `Game` snapshot |
| Current peer commands | WebRTC lockstep |
| Account and public username | Supabase |
| Cloud saves (resume snapshot) | Supabase |
| Character level, XP, career stats | Supabase `game_characters`, written only by `apply_match_result()` |
| Account upgrade tree | Supabase `account_upgrades`, written only by `account_upgrade_mutate()` |
| Stash, equipment, Alloy wallet | Supabase `item_instances` / `player_wallets`, written only by service-role RPCs |
| Games, wins, kills, campaign progress, relics, quests | Supabase `player_stats`, written only by `apply_match_result()` |
| Match history and report idempotency | Supabase `match_history` / `match_reports`, written only by `apply_match_result()` |
| Character appearance, Lattice, selected character | Auth user metadata (client-writable; cosmetic and build data only) |
| Rooms, seats, chat, and signaling | Supabase |
| Guest (offline) progress | Browser local storage only, never uploaded |

## Match Results

When a signed-in match ends, the client never grants anything itself.

```text
POST /api/match-start           signed single-use ticket: user, mission, seed, room
  -> new Game(..., { rngSeed })   ticket seed; commands logged with their tick
victory/defeat event
  -> Main._matchReport()          what the client claims (buildMatchReport)
  -> match outbox (localStorage)  survives a closed tab; same requestId on resend
  -> POST /api/match-result       bearer token verified with Supabase auth
       -> validateMatchReport()   bounds vs duration, map, level unlocks
       -> verifyLootKey()         every pack key re-derived from the map seed
       -> evaluateQuests()        quests re-run on the reported counters
       -> verifyTicket()          HMAC, expiry, user, mission; room from ticket
       -> server clock            duration fits time since the ticket
       -> reviewReasons()         bests / suspicious runs keep their input log
                                  for a later leaderboard check (no replay)
       -> co-op room check        reporter must be a seated room participant
       -> computeMatchRewards()   XP, levels, items, Alloy, stats
       -> apply_match_result()    one transaction: idempotency, rate limit,
                                  duration clock, CAS on progress_revision,
                                  quest/item dedupe, stash cap, wallet credit
  -> end screen shows exactly what the server returned
```

A replayed `requestId` returns the stored response and grants nothing. A
player can report one result per co-op room. Reports are rate limited and must
fit inside the wall-clock time since the match ticket was issued. Combat
counters are still client claims, bounded but not replayed; see
`docs/backend.md` and `docs/leaderboards.md`.

## Gear, the Lattice, and Meta

`src/items.js` owns gear. An item is a string, and the string can be a seed:
`scatter_mk2:7f3a91:62:2` is base, roll seed, item level, and rarity.
`resolveItem()` turns the key back into the full item and is pure, so the same
key produces the same affixes on every peer and every reload. Nothing is stored
but the key, which is why rolled loot needed no change to the snapshot, the
hero pack, the drop command, or the profile blob. A key with no `:` resolves
from the authored `ITEMS` table in `src/config.js`; those items are the
signatures of the system and every profile written before it keeps working.

Local and global mods stay apart. A weapon's own `+% damage` scales that
weapon; the same roll on a coat scales the hero. `applyLocal()` folds the local
bag into the weapon exactly once.

`src/skilltree.js` owns the Lattice, the shared passive tree every persistent
character allocates into. The tree is generated from a fixed seed and a
nine-sector table rather than hand-authored, the same way `terrain.js` and
`lanes.js` generate their structures. Traces, relays and
attribute nodes are bags of numbers on the mod keys `itemMods()` already
speaks. Doctrines are flags: `src/game.js` owns each rule in simulation code,
because a node cannot ship behaviour without breaking snapshot restore and
lockstep.

Both modules resolve to numbers before a run starts. `characterCamp()` folds
gear, the Lattice, and each weapon set into flat bags, and the simulation never
queries an item, an affix, or a tree node while it runs.

`src/meta.js` holds the guest (offline) Alloy ledger. `runScore()` in
`src/game.js` folds a finished run into one score and `awardRun()` converts it
into local Alloy for guests. Signed-in Alloy comes only from
`matchAlloy()` in `src/match-rewards.js`, credited by the server.

Campaign maps past the five authored Earth missions are generated by
`levelById()` in `src/config.js` from the level number alone, so every peer
builds the same map without shipping data.

## Save and Restore

`Game.snapshot()` must include all state that changes future results. Examples
include temporary units, active ability zones, custom combat stats, node
ownership, loot, and random generator state.

`Game.restore()` must create the same future simulation as an uninterrupted
run. `scripts/sim-determinism-check.mjs` and
`scripts/hero-ability-restore-check.mjs` enforce this rule.

If restore fails, the game removes the corrupt save and returns to the menu.

## Map Generation

Each authored mission selects one landform and one colony plan.

`src/terrain.js` creates terrain, elevation, sites, hives, nodes, and
chokepoints. `src/plots.js` fits the colony plan to the selected site.
`src/map.js` renders the resulting relief.

`src/fog-of-war.js` selects living allied vision sources. `src/main.js`
renders the presentation-only world shroud. `src/ui.js` applies the same
source list to the minimap. Fog must not add simulation state or commands.

Natural water, crag, and deep woods can replace built rampart sections. Gates
must remain reachable. Friendly troops must be able to leave the colony.

Run `node scripts/map-check.mjs --report` after a map-generation change.

## Failure Behavior

- Supabase writes fail after the configured eight-second timeout.
- Room actions show actionable errors and permit retry.
- A missing lockstep window triggers an exact repair request.
- A dropped peer shows per-player connection state.
- A fatal frame-loop error stops the battlefield and shows a reload action.
- A corrupt save returns the player to the menu.

Do not hide these failures or continue with partial state.

## Extension Rules

When you add a system:

1. Put the rule in the module that owns the state.
2. Define the state owner.
3. Define snapshot behavior.
4. Define multiplayer behavior.
5. Define failure behavior.
6. Add a committed check.
7. Update this document if module ownership changes.

## Reusable map-kit prototype

See `docs/reusable-map-kit.md`. `src/map-kit.js` owns piece/prefab contracts,
rotation, connections and authored-layout collision/elevation compilation.
`src/fortress-plan.js` composes Black Vale site0; `map-kit.html` and
`map-kit-page.js` provide local placement, route testing and JSON roundtrip.
Campaign loading of workbench exports is not implemented.

### Mission arrival presentation

`main.js` owns the optional fresh-solo campaign arrival and its camera distance.
`ui.js` renders mission identity and the skip action. The four-second sequence
blocks local simulation advancement and commands, never multiplayer startup.
It is not serialized. Resumed games and reduced-motion users bypass it. The
existing loading screen remains separate and clears on both success and failure.

## Chapter campaign (2026-11-22)

`src/chapter.js` owns cosmetic normalization, five-city presentation and
leader unlock thresholds. `player_stats.campaign_cleared` remains authority;
there is no second conquest ledger. Auth metadata stores chapter name, colors,
insignia and founder ID, plus companion identity links on existing character
records. Capacity is fifteen: eight legacy characters plus seven companions.
Recruitment uses the existing server character-registration/economy path;
repeat recruitment selects the same deterministic per-account character ID.
Founder models remain customizable; named companions use their named hero kit.
No new simulation/snapshot format, database migration or reward grant path.

Chapter/founder/recruit writes suspend older auth hydration while in flight;
otherwise USER_UPDATED can replace a founder just created locally with the
previous roster. A behavioral regression and live create/reload smoke cover
this race. Campaign setup binds the chosen roster leader and announces changes
through the existing multiplayer hero-pick path when switching modes.

## Multi-ability runtime (roster expansion)

`hero-abilities.js` owns the six-slot/cooldown compatibility contract.
`hero-kits.js` owns authored core kits, registered by `config.js`.
`hero-spells.js` owns deterministic targeted spell execution and pending effects.
`game.js` integrates updates, snapshots, upgrades and attack hooks; no DOM timer
may resolve a spell. Legacy single-ability leaders retain their Q action.
`lockstep-hash.js` covers cooldowns, mana, charges, pending effects and hit history.
Protocol 14 rejects older rooms; snapshot 13 is written and snapshot 12 can be
read with empty additional slots. Old clients reject the new snapshot version.

Point/enemy spells enter a target-selection mode. Pointer selection emits the
same cast command as other input; Escape cancels before spending resources.
The sim checks range, visibility for unit targeting, mana and cooldown before
accepting a cast. The host sanitizes guest slots and target coordinates.

### Persistent friend parties

`src/friend-party.js` owns the guarded Supabase RPC client and invite parsing.
`src/friend-party-ui.js` owns the compact chapter modal and bounded-lifetime
refresh loop. Closing it stops polling. `src/main.js` connects its actions to
existing private-room creation/joining. The party never simulates combat.

Chapter -> private party -> existing room -> Ready -> WebRTC siege -> same party.
A failed party request leaves the old room system available. A room that finishes
or becomes stale is no longer offered as the next match; membership survives.

## Hero hit feedback

`src/hit-feedback.js` draws up to 24 short-lived hero damage labels. Gold `!` labels
identify the existing attack critical roll. Shot metadata reports primary target
HP loss after mitigation, before follow-up ability damage. It does not add RNG
rolls, change combat math or pause simulation. Fog hides labels; expired labels
and match teardown dispose textures/materials. Spell/range indicators and HUD
layout remain unchanged. This replaces only the hit/crit portion of PR #124.

## Music and ambience

`src/audio-beds.js` owns the lazy-loaded CC0 score salvaged from PR #132.
`AudioSys` shares its context/master limiter with beds. Existing music and master
settings control them; combat SFX remain procedural and hero-local. Base warnings
remain global and duck beds. Failed tracks keep procedural fallback; late loads
cannot switch the current scene. Source records: `assets/audio/cc0/LICENSES.md`.
