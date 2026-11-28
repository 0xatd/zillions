# Playability and shared-space delivery

Alex authorized this work on 2026-11-27. Hero art remains separate.

## Review gates

1. Reproduce and fix corner sticking, battle-exit leakage, camera/input, workers.
2. Inspect the complete first-entry/menu/result journey, not only isolated screens.
   Centered RTS command deck: minimap, hero controls, army/worker orders. Preserve
   actual keyboard dispatch, touch controls, inventory and construction access.
3. Deliver one persistent shared star system: movement, NPC/other-player fleets,
   arrival-based planet services, encounters, battle and return/reconnect.
4. Production build, deterministic simulation checks, browser interactions,
   local database authority/concurrency checks, and multiplayer verification.

## Strategic authority contract (implementation target)

- A realm is a shared space, not a four-seat battle room. Social parties, owned
  warbands, assembled armies and political affiliations remain distinct.
- Server clock and server-authenticated ownership govern travel. The browser
  interpolates the returned path; it cannot write a position, army or balance.
- One versioned realm snapshot is advanced and committed with compare-and-swap.
  A request ID makes retries idempotent. Concurrent callers reload and retry;
  no last-writer-wins loss of another player's move.
- NPC traders, patrols and hostiles are explicitly NPCs. They have actual paths
  and encounter behavior. Player entries come only from authenticated players.
- Travel is continuous; click a destination, stop, pan/zoom, or intercept a fleet.
  Opening a menu never pauses a shared realm. A disconnected player's travel
  is bounded; reconnect loads persisted position rather than rewinding time.
- Planet services require arrival. Trading reuses the real item economy,
  recruitment uses an atomic debit and owned army change, and dialogue supplies
  contextual information/objectives rather than nonfunctional buttons.
- Encounters reserve only their participants. Tactical room readiness/all-loaded
  barriers remain mandatory. World travel and population continue elsewhere.
- Battle return must reference an accepted match report/ticket for that encounter.
  No world endpoint trusts a client-supplied victory or grants arbitrary rewards.
- Defeat, cancellation, stale requests, interrupted reward saving and disconnect
  must have explicit recoverable states. No delete-and-recreate world migration.
- Offline training is explicitly local, never represented as a populated shared
  realm. No fabricated online counts, friends, political ranks or players.

## Existing verification artifacts

See `outputs/zillions-playability-20261127` in the operator workspace for the
three failing baseline corner routes, before/after battle cleanup, real input
checks and rendered laptop/phone/landscape screenshots. Test status is recorded
per checkpoint; screenshots and tests do not by themselves establish art parity.

The existing title/character art remains the current shipped assets. This work
must not represent that art as meeting the requested Dota-quality hero target.

## Implemented slice and acceptance evidence

- Centered command deck with minimap camera navigation, hero controls, army
  F1–F4 and worker F5–F8. Edge pan/Space and overlay input isolation are checked
  with real browser events. Worker construction and reserve behavior are
  exercised, not inferred from button highlighting.
- Title → six-step creation → character → world, contextual preparation,
  inventory services and results share the dark-panel/warm-accent treatment.
  Screens own their backdrop; battle exit clears coin/corpse/horde instances.
- Continuous world travel, stop, pan/zoom; patrol, convoy and hostile NPC fleets;
  arrival-based trade/recruit/dialogue; nearby friend-party encounter joining;
  existing private rooms and Ready/all-loaded barriers for tactical co-op.
- A four-soldier starting warband, recruitment, ordered per-player expedition
  troops in battle, casualties, snapshot/replay preservation, and independent
  survivor return. NPC victories remove that hostile fleet temporarily. Defeat
  or explicit surrender loses expedition troops and returns to Greenfall.
- Server-owned clock/position, authenticated character ownership, atomic
  recruitment, request receipts, bounded CAS retry, signed ticket linking and
  accepted-report settlement. The offline path is explicitly local and uses a
  recoverable world/Alloy transaction journal.
- Local saves retain the encounter. Cloud saves retain its reference, not the
  reward ticket; an online resume requests the existing reserved ticket again.

Verification commands:

```sh
npm run check
npm run check:postgres
node scripts/menu-journey-review.mjs
node scripts/playability-input-check.mjs
node scripts/playability-hud-camera-check.mjs
node scripts/browser-shell-check.mjs
node scripts/playability-world-check.mjs
node scripts/coop-e2e.mjs --world-army-fixture
vercel build --prod
```

The world browser test uses real UI travel/recruitment/preparation and a forced
battle outcome solely to test the return boundary. The co-op world-army fixture
exercises rendered transport/Ready/start/reload with supplied metadata; it is
not a substitute for a signed-in live shared-world journey. The independent
PostgreSQL test separately covers real account rows, tickets and transactions.

## Rollout boundary

This PR is a reviewable first-system slice, **not** a complete Bannerlord-scale
campaign or a claim of equal art quality. Political factions, assembled armies,
quests/economic simulation and new hero art are not implemented by this PR.
Trade uses the existing equipment economy; conversations are contextual port
and fleet dialogue, not a finished quest system. Fleet encounters reuse the
current tactical siege mode rather than reproducing Bannerlord combat.

Before release, apply the additive migration in a review/staging environment
and complete the signed-in two-account world-to-encounter-to-results journey.
The bounded snapshot realm needs realistic load/capacity work before broader
population rollout; see the authority review for its explicit limits.

No live schema was changed during implementation. Apply the migration before
shipping this frontend; without it online world entry reports unavailable.
Rollback means reverting the application commit, **not dropping world tables**:
retain fleet, ticket-link and receipt records for recovery.
