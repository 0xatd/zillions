# Shared-world authority review — 2026-11-27

Review scope: the new strategic realm, recruitment transactions, encounter
reservations, match-ticket reuse, persistence and co-op handoff. This is a local
working-branch review, not a live deployment or an overall release verdict.

## Reproduced defects addressed during review

- A retried world ticket could carry the original ticket ID but a newly selected
  difficulty. Match start now rejects changed reserved setup rather than signing
  a report that the database would reject at battle completion.
- Battle metadata was omitted from autosaves. The runtime now retains the world
  encounter metadata used to return the army after a resumed battle.
- Abandoned reserved encounters had no release path. Explicit surrender and an
  expiry path now prevent permanent fleet reservations; late settlement must not
  charge the army twice.
- Six immediate compare-and-swap attempts synchronized concurrent polls. A
  16-caller fake-store reproduction initially completed only six requests. The
  retry policy now adds jitter and a larger bounded retry budget. This does not
  establish production capacity.
- Offline recruitment debited the guest ledger before persisting its soldier.
  A failed world write lost Alloy. `local-strategic-store.js` now uses a rollback
  journal, a shared Web Lock, expected-world-state comparison, and a forced
  ledger reload. Interrupted writes remain unconfirmed and recover before the
  next world operation. Corrupt journals are preserved, not silently reset.
- A shared encounter could otherwise accept a solo ticket while other
  participants remained reserved. Ticket linking now requires a matching room
  and complete encounter seats for multi-participant encounters.
- A consumed encounter ticket could be returned for another battle attempt.
  Linking now directs that path to result recovery instead.

## Evidence

- `tests/world-authority-review.test.mjs`: reserved difficulty, cancellable
  preparation, independent movement, failed offline save and concurrent polls.
- `tests/local-strategic-store.test.mjs`: successful transaction, either-write
  failure, interrupted-tab rollback, corrupt journal preservation, stale-world
  rejection and fresh-ledger spending.
- `scripts/strategic-world-postgres-cases.mjs`: real throwaway PostgreSQL
  ownership, atomic debit, idempotence, CAS and role grants; two actual account
  and character rows share one encounter with distinct tickets and the same
  frozen ordered army. Missing seats, solo tickets, room mismatch and consumed
  tickets are rejected. The independent-settlement checks feed the pure reducer
  accepted outcomes; they do not claim a rendered co-op battle or reward payout.

## Rendered local party verification

`CHROME_PATH=/opt/google/chrome/chrome node scripts/coop-e2e.mjs --world-army-fixture`
passed with GPU drawing enabled in two isolated browser contexts. The fixture
supplied only an ordered `[5, 7]` starting army at the host metadata boundary;
it did not authenticate accounts or mock a successful world API. Actual invite,
Ready, all-loaded start, relay messages, simulation and guest reload ran normally.

- Both peers deployed 12 troops with the same encounter metadata.
- Three identical sampled frame hashes at startup; 23 after reload/resync.
- During 120 seconds with a 4× CPU-throttled guest and 8% relay packet loss,
  maximum sampled stall was 273 ms and no resync hung.
- Guest reload recovered after 82.5 seconds under software GPU rendering. That
  establishes persistence correctness, not acceptable reconnect performance.
- Refreshing the host closed the old started invite as expected.

Evidence is retained by the operator under
`outputs/zillions-playability-20261127/authority-review/`. The authenticated
PostgreSQL reservation tests above and this local metadata fixture are separate
checks; together they are not a signed-in browser-to-API full-world test.

## Remaining release gates and limitations

- Complete a rendered two-account journey: join the encounter, join its room,
  Ready, all-loaded launch, matching army/simulation hashes, finish, confirm both
  reports, return each survivor count, reload and reconnect. Unit and SQL checks
  do not establish this.
- The first realm stores all fleets in one bounded snapshot and currently caps
  it at 256 character fleets, including offline characters. There is no inactive
  fleet archive/admission policy. This is a bounded initial implementation, not
  a claim of 256 concurrent players or unrestricted world population.
- Every poll currently advances/writes the shared snapshot. Before broad
  rollout, measure contention, request volume, latency and state size under a
  realistic multi-client load. Small fake-store collision tests are not a load
  test. Avoid raising population limits without changing this bottleneck.
- Browser Web Locks serialize this new world ledger path. Older offline shop
  and upgrade writers do not yet share that lock; simultaneous unrelated guest
  transactions across tabs are not covered by this review.
- Cloud snapshots keep the encounter reference (never the reward ticket) and
  recovery requests the existing reservation. The cloud metadata contract has
  a test; verify an actual authenticated new-device recovery before release.
- Migration application, production-build verification and deployment are owned
  by the parent task. No live schema or production data changed in this review.
