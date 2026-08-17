# Architecture

This document explains the current Zillions runtime. It describes shipped
code. It does not describe future product plans.

## System Boundary

Zillions has three runtime layers:

1. The browser runs rendering, input, UI, and the complete combat simulation.
2. Supabase stores durable account and multiplayer coordination data.
3. Vercel serves the static application and same-origin API routes.

The production backend is not server-authoritative for combat.

## Browser Startup

`index.html` loads `src/main.js` as the application entry point.

The startup flow is:

```text
index.html
  -> src/main.js
     -> account gate
     -> main menu
     -> solo setup or online lobby
     -> deterministic Game instance
     -> Three.js render loop
```

`src/main.js` composes the system. Keep domain rules in smaller modules when a
module already owns that rule.

## Module Ownership

### Simulation

| File | Ownership |
| --- | --- |
| `src/game.js` | Deterministic game state, commands, combat, economy, buildings, snapshots, and restore |
| `src/config.js` | Heroes, levels, plot definitions, items, balance constants, and `levelById()` |
| `src/lanes.js` | Deterministic lane graph and route data |
| `src/flowfield.js` | Flow-field pathfinding |
| `src/multiplayer-windows.js` | Lockstep window helpers |
| `src/multiplayer-pacing.js` | Adaptive buffer targets and repair history |
| `src/multiplayer-readiness.js` | Direct connection readiness |
| `src/multiplayer-eligibility.js` | Campaign unlock eligibility |

Simulation code must produce the same result on every peer. Add all new state
to snapshots when the state can affect later simulation.

### World Generation and Rendering

| File | Ownership |
| --- | --- |
| `src/terrain.js` | Deterministic terrain field, elevation, sites, nodes, and chokepoints |
| `src/plots.js` | Colony plans, ramparts, gates, districts, and outer works |
| `src/map.js` | Three.js terrain geometry, relief, colors, rocks, and set dressing |
| `src/tactical-visuals.js` | Tactical presentation helpers |
| `src/assets.js` | Asset loading and asset paths |
| `src/audio.js` | Music, voice, and sound effect playback |

Terrain walkability belongs to the simulation. Visual relief must not silently
change walkability.

Authored unit and building models live under `assets/art-slice/`. Their source
and export contract is in `docs/art-pipeline.md`. `src/assets.js` loads each GLB
and `src/main.js` binds named moving parts. Missing GLBs fall back to the
procedural renderer and must not stop a match from starting.

### Application and UI

| File | Ownership |
| --- | --- |
| `src/main.js` | Runtime composition, render loop, input, save flow, co-op sequencing, and Watch |
| `src/ui.js` | Main menu, setup, lobby, room, HUD, and overlays |
| `src/runtime-guard.js` | Fatal frame-loop recovery |
| `style.css` | Application layout and visual styles |

### Account and Multiplayer Services

| File | Ownership |
| --- | --- |
| `src/supabase.js` | One shared Supabase client and write timeout |
| `src/auth.js` | Google sign-in, username, profile, stats, and cloud saves |
| `src/online.js` | Rooms, seats, roster refresh, chat, presence, and signaling |
| `src/net.js` | WebRTC channels, packets, route data, latency, and jitter |
| `src/backend.js` | Same-origin Vercel API client |
| `api/auth-config.js` | Public auth configuration route |
| `api/state.js` | Legacy state compatibility route |
| `api/lobby.js` | Legacy lobby compatibility route |

`supabase/schema.sql` defines the durable schema.

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
| Combat, units, buildings, loot, and Threat | Browser `Game` snapshot |
| Current peer commands | WebRTC lockstep |
| Account and public username | Supabase |
| Cloud saves and hero career | Supabase |
| Rooms, seats, chat, and signaling | Supabase |
| Local development fallback | Browser local storage |
| Legacy state mirror | Vercel Blob compatibility routes |

Do not move production social state back to Vercel Blob.

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
