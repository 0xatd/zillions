# Future Design Vision

This document describes possible future systems. It is not a current-state
specification.

Read `docs/product-contract.md` for shipped product rules. Read
`docs/architecture.md` for current code ownership.

## Product Thesis

Zillions is a game about taking planets.

The player is a persistent hero commander. The Hive consumes one world after
another. The player lands on a contested planet, founds a colony, takes ground,
and destroys the local Hive.

The tactical game must stay direct and readable:

- control one hero
- use one gold resource
- hold one input to build, upgrade, repair, or rebuild
- direct autonomous squads with global stances
- move the front line across a terrain-derived map

Future systems must strengthen this loop. Future systems must not turn
Zillions into a unit-micro RTS or a blank-canvas city builder.

## Three Nested Loops

### The Minute

Move, fight, collect gold, cast an ability, and fund the next useful plot.

The hero is the player's direct expression. The hero should change the result
at a contested point without replacing the army.

### The Planet

Found a colony, buy pressure, take nodes, destroy hives, defeat the champion,
and keep the world.

The current continuous siege loop implements this layer.

### The Galaxy

Choose the next world. Carry hero progress, equipment, allies, and liberated
worlds forward.

The deterministic frontier-world picker is shipped. A strategic simulation of
factions spreading between worlds is not shipped.

## Shipped Foundations to Preserve

- deterministic simulation and snapshot restore
- terrain-derived landforms, sites, nodes, and chokepoints
- one unique colony plan for each Earth mission
- natural barriers that replace built ramparts
- continuous income and hive production
- Threat as the visible pressure clock
- autonomous squads and global stances
- persistent heroes, equipment, relics, and campaign progress
- four-player WebRTC co-op and read-only Watch

Do not rebuild these systems as future work. Extend the current code.

## Future Direction: The Folk

The galaxy can contain native factions that predate the player and the Hive.
Examples include werewolves, vampires, fae, deep kin, and barrow dead.

The Folk must change gameplay rules. A faction that only changes dialogue or
color does not justify the system.

A useful faction can provide:

- one battlefield rule
- one alliance cost
- one tactical benefit
- one strategic consequence
- one reason to reject the alliance

The player, the Hive, and the Folk form a three-sided conflict. The Folk are
not generic enemies and are not automatic allies.

## Future Direction: World Missions

Current side quests use tracked objectives and end-of-run rewards. A later
mission system can place objectives directly in the world.

Examples:

- escort a convoy between two lane nodes
- defend a shrine while the Hive attacks it
- rescue a trapped squad before a timer expires
- choose which native settlement receives scarce supplies
- destroy a Hive organ that changes local production

A world mission must create a visible place, a current decision, and a failure
state. Do not add achievement text and call it a mission.

## Future Direction: Information and Landmarks

Fog of war can make scouting and territory more important. Fog must stay
compatible with deterministic simulation and Watch.

Landmarks can make generated worlds easier to remember. A landmark should
affect navigation, economy, combat, or faction state.

Examples:

- a broken orbital elevator that marks the horizon
- a native fortress that controls one pass
- a reactor lake that powers nearby structures
- a buried Hive organ that increases local Threat

Do not add large visual props that block movement without clear collision and
map tests.

## Future Direction: Strategic Galaxy State

A later galaxy layer can model ownership and pressure between worlds.

Possible state:

- liberated worlds
- threatened worlds
- Hive expansion routes
- Folk alliances
- player supply routes
- time-limited rescue opportunities

The strategic layer must remain legible. It must not require the tactical game
to run on a server while no player is present.

## Future Direction: Multiplayer Operations

The next multiplayer improvements can include:

- host transfer
- reconnect grace periods
- public, invite-only, and private room policies
- duplicate-session handling
- per-player load progress
- AFK and Ready timeouts
- persistent room event history
- join, reconnect, and launch telemetry

Implement one lifecycle improvement at a time. Add a committed two-session
regression for each change.

## Future Direction: Hero Readability

The HUD can use a compact MOBA-style ability strip without copying a complete
MOBA interface.

The strip should show:

- hero portrait
- aura and passive names
- active ability key
- active ability rank
- cooldown sweep and time
- disabled, dead, and ready states

Keep one controlled active ability per hero unless playtests prove that the
current interaction model needs more complexity.

## Evaluation Rules

Evaluate a future proposal with these questions:

1. Does the proposal improve the minute, planet, or galaxy loop?
2. Does the proposal reuse a current system?
3. Does the proposal keep direct hero control readable?
4. Does the proposal preserve deterministic simulation?
5. Does the proposal create a visible player decision?
6. Can automated checks protect the new rule?
7. Can the proposal ship as one focused pull request?

If the answer to several questions is no, do not build the proposal yet.

## Explicitly Not Shipped

- folklore factions
- strategic faction simulation between worlds
- persistent explored-map memory beyond the shipped tactical vision shroud
- world-placed dynamic missions
- authored landmark system
- server-authoritative combat
- anti-cheat enforcement

Do not describe these systems as current behavior.
