# Living World Authority

The living world is the main game. The tutorial releases a player into a persistent multiplayer shard. The server owns the shard clock, map state, armies, trade, pursuits, encounters, and battle outcomes.

## Authority boundary

The client sends intent. It does not write world tables. An API authenticates the user and calls `living_world_command` with the service role. The command verifies party ownership and revision, stores an idempotent request, and appends an ordered event.

A single-writer simulation worker consumes events and advances a shard. Every writer must acquire locks in the same order: shard advisory lock, command advisory lock when applicable, then aggregate row locks. The shard lock also serializes event sequence allocation. Each battle round stores its RNG cursor and state hash so replay can detect divergence. Raw tables are not a public map feed. A server endpoint must build visible map projections from scouting, faction access, and intelligence expiry.

## Domain

- Shards own clocks, seeds, rulesets, provinces, and ordered events.
- Provinces own locations, towns, and directed routes.
- Parties have one valid position. Armies and persistent unit stacks travel with them.
- Cargo and supplies belong to parties. Markets belong to locations.
- Movement and scouting create pursuits. Pursuit decides contact.
- Encounters support fight, auto-command, surrender, escape, rearguard, diversion, and negotiation.
- Engagements resolve deterministic autosim rounds. Live play changes commander orders, not authority.
- Results write casualties, prisoners, cargo, morale, and retreat routes back to the world.

Players do not have to enter a battle. A caught force receives choices supported by terrain and force state. A rearguard commits real units. A diversion consumes real assets. Huge wars can simulate all troops while a tactical client renders an active slice.

## Integration hooks

1. Add an authenticated API. Derive the actor from the token. Never accept an actor ID from the browser.
2. Run one leased simulation writer per shard.
3. Add a server-filtered map projection endpoint.
4. Connect tactical round completion to stale-revision-checked commands.
5. Test event replay before enabling persistent losses.

Do not apply this migration directly to production. Test concurrent retries, stale revisions, worker takeover, replay, RLS, conservation of money/cargo/units, and disconnect recovery in an isolated project first.
