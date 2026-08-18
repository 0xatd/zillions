# Macro Layer — Persistent Galaxy Design

## V0 — Shared War Map

The first safe slice is deliberately small:

1. **Shared ownership map.** Worlds carry an owner (`hive` | `free`).
   One column, rendered on the existing star map, readable by everyone.
2. **Immutable battle events.** A server-only writer records each trusted
   battle result once. The public client cannot declare its own victory.
3. **Visible history.** The existing star map reads shared ownership and the
   latest war changes. If the service is unavailable, travel still works.

Zillions does not yet have a trusted match authority. Therefore, the live
client does not receive the galaxy write secret and does not report battle
results directly. Add that bridge only when a server can validate match
eligibility and completion. The Hive tick, exploration, and AI hub DM remain
destination work below. They are not part of V0.

Future AI DM work must never mutate state directly. Pattern:

```
player (freeform text)
  -> AI DM (interprets + roleplays, narrates)
  -> structured action request
  -> server validates against the action vocabulary
  -> state changes
  -> AI narrates the result
```

The DM is the translator and the theater. The referee stays code.

### Frontier Exploration (Future)

The galaxy is deterministic from seed, so the map is effectively infinite
on paper and only *revealed* where players have explored:

- The frontier is the edge of observed space. Systems beyond it generate
  from the seed on first visit, are cached server-side, and become visible
  to everyone. The shared map visibly grows — the retention hook, pointed
  outward.
- **Hazard curve, not 1000 hazards.** One survival roll per light-year of
  distance beyond the frontier. Odds degrade smoothly with distance; the
  DM narrates the flavor (radiation, Hive density, Folk space, hull
  failure) so one number *feels* like a thousand deaths.
- **Everyone explores, few discover.** Cheap short probes are survivable
  but find little. Deep runs spike both death risk and discovery value.
  Many explorers, few cartographers — but every death gets a story.
- Optional lore use for prime-gated routes ("cursed lanes" that are safe
  at 11 ly and lethal at 13 ly) is flavor on top of the curve, not a
  replacement for it.

### AI DM Endpoint Contract (Future)

Server-side Vercel route. Never touches the battle engine.

Request:

```json
{
  "userId": "<user-id>",
  "hubId": "<world-id>",
  "message": "<freeform player text>",
  "history": [ {"role": "npc|player", "text": "..."} ]
}
```

Server composes context (world ownership, recent tick events, player
reputation, inventory) and calls the LLM with a fixed system prompt that
includes the **action vocabulary** — the closed list of actions the DM may
request (initial proposal: `repair`, `trade`, `take_contract`, `launch_exploration`).

Response (validated before any state write):

```json
{
  "narration": "<in-character reply>",
  "action": { "kind": "repair", "args": { } } | null
}
```

Rules: actions are validated and idempotent; unknown or malformed actions
  are refused with in-character narration; the DM sees state but cannot
  write it. Expanding the DM later means growing the vocabulary, not
  changing the architecture.

---

## Full Design (destination map, not a to-do list)

This document specifies the server-authoritative macro layer: the shared
star map, world ownership, hub interactions, and the battle-instance
interface that connects the macro to the tactical game.

Read `docs/design-vision.md` for loop philosophy and
`docs/galaxy-meta-integration.md` for current shipped galaxy code.
This is a future-state spec. The tactical game is not redesigned here.

## Layer Split

| Layer | Model | State | Scale |
|---|---|---|---|
| Macro (galaxy map, hubs, ownership) | Server-authoritative | Supabase rows | All players |
| Micro (planet siege battles) | Deterministic lockstep (existing engine) | In-memory + snapshots | <=10 humans per instance |

The macro never simulates combat. Battles never write partial state.
They communicate only through the battle result message defined below.

## Macro Gameplay

Players do not travel through open space. The galaxy is a node graph
(star systems + lanes, already generated deterministically from a seed).
Interaction model:

- **Perceive**: open the shared map, see ownership, Hive spread, Folk
  territory, gate network, prices, recent events.
- **Move**: click a connected destination. Arrival is instant or a short
  jump timer. Some lanes require an activated gate.
- **Dock**: enter a hub world (town or city) for services.

### World Tiers

| Tier | Examples | Function |
|---|---|---|
| Town (small planet / moon) | Frontier outposts, Folk settlements | Vendors, repair, trade post, contracts, bank/storage |
| City (major planet) | Faction capitals, gate hubs | Markets, guild halls, faction services; ownership sets taxes + inventory |
| Contested world | Hive-held, Folk-held, frontier | Launch battles here; ownership changes only through battle results |

Every world has an owner: `hive`, a Folk faction, a player faction, or
`free`. Ownership changes only via validated battle results. Nothing in
a hub mutates the tactical engine.

### The Tick

Galaxy state advances on a slow tick (minutes). Tick effects:

- Hive consumes adjacent worlds along its frontier
- Folk factions shift territory, respond to pressure
- Markets and prices drift by ownership and threat
- Contracts refresh at hubs

Implementation: lazy evaluation preferred — `galaxy_state = f(seed, tick)`
computed on read, diffed against stored events. Fallback: Vercel cron
advancing a `galaxy_tick` row on an interval. No real-time server process
is required.

### Retention Rule

Opening the map must always answer "what changed while I was away."
If a tick produces no visible, player-relevant change, the tick is not
doing its job. Ship event feed (recent conquests, gate losses, price
shifts) alongside the map.

## Battle Instance Interface

The only bridge between layers. Two messages:

### Enter Battle (macro -> instance)

```json
{
  "worldId": "sys-042-world-3",
  "faction": "hive",
  "threatTier": 2,
  "modifiers": ["arrived_late"],
  "players": ["<user-id>", "..."]
}
```

### Battle Result (instance -> macro)

```json
{
  "worldId": "sys-042-world-3",
  "outcome": "liberated" | "failed" | "partial",
  "ownerAfter": "free" | "<faction-id>",
  "casualties": { "players": 2 },
  "spoils": { "gold": 1200, "relics": 1 },
  "durationTicks": 3,
  "reportedBy": "<user-id>"
}
```

Rules:

- Results are written by a server route (Vercel), never directly by a
  client, even though the client reports the payload. Validation starts
  minimal (schema + eligibility) and hardens later.
- Results are idempotent per `(worldId, battleId)` so retries cannot
  double-apply conquests.
- The instance stays fully deterministic lockstep — existing WebRTC
  co-op, snapshots, and Watch are unchanged.

## Skills

- **Micro tree** (per-run / per-hero): existing PoE-style combat tree.
  Untouched.
- **Macro tree** (persistent, extends `src/meta.js`): trade margins,
  repair costs, contract slots, gate access, faction reputation gains,
  market alerts, storage capacity.
- **Bridge keystones** (rare, 3-5 total): translate progress between
  layers. Examples: "Warlord — each world you own adds +1 squad cap in
  battles"; "Gatecrasher — arriving via gate grants a 30s hero burst."

## Player Ownership (Future: Human-Run Worlds)

Endgame direction. Staged so each stage is shippable alone:

1. **Player factions** — guild-like groups with membership and a shared
   treasury. Server-side rows only.
2. **Faction claims** — a player faction may claim a `free` world after
   liberating it (battle result grants claim rights). Claimed worlds
   pay tribute to the faction treasury on each tick.
3. **World stewardship** — owners set a tax rate on hub services, choose
   vendor stock bias, and fund defenses. All expressed as **numbers on
   rows** validated by the server — never custom geometry or scripts.
   A world an owner neglects (defenses unfunded) becomes contestable
   again by other factions through normal battles.
4. **Governance limits** — no player-authored content in the sim. Owners
   pick from sanctioned option sets (tax bands, stock archetypes,
   defense budgets). This keeps the deterministic/validated boundary
   intact and prevents player worlds from becoming unmoderated spaces.

Ownership conflict between player factions resolves through the same
battle-instance path: attacker launches on a held world, result row
transfers ownership. No separate siege system.

## What Changes In Existing Code

| Module | Change |
|---|---|
| `src/galaxy.js` | Unchanged for generation. Becomes the *seed source* mirrored server-side for lazy tick evaluation. |
| `src/overworld.js` | Reframes from "travel + lifts" to "star map + dock + launch." Existing UI largely carries over. |
| `src/factions.js` | Faction roster reused; presence archetypes gain tick behaviors (spread/retreat) evaluated server-side. |
| `src/meta.js` | Extended with macro tree branch + bridge keystones. |
| `src/game.js` / sim modules | **No changes.** Battles receive a small entry payload and emit a result. |
| `supabase/schema.sql` | New tables: `galaxy_tick`, `worlds` (ownership/tier/state), `hub_services`, `player_factions`, `claims`, `battle_results`, `market_prices`. |
| `api/` | New routes: `advance-tick` (cron or lazy), `report-battle-result`, `dock`, `trade`, `claim-world`. |

## Build Order

1. `worlds` + `galaxy_tick` tables; static ownership rendering on the
   existing star map (read-only). Cheapest visible win.
2. Tick v1: Hive spread only. Event feed on the map.
3. Battle result route + enter-battle payload wired to existing engine.
4. Hubs v1: one city + two towns, repair + simple vendor.
5. Player factions + claims (stages 1-2 of ownership).
6. Macro skill tree + bridge keystones.
7. Folk macro behaviors + markets.
8. Stewardship options (stage 3).
