# Living-world worker

The database owns each shard tick. A worker calls `living_world_process_shard` with the service role. The function acquires the shard lock and a renewable lease. It applies queued commands in a stable order and advances one simulation tick in one transaction.

## Command lifecycle

1. `living_world_command` authenticates ownership and checks the party revision.
2. The function reserves the next party revision and stores a queued command.
3. The worker locks each pending command. It applies the domain mutation or records a terminal rejection.
4. The worker stores the response and an ordered `command.applied` event.
5. A retry with the same request ID returns the stored state. A changed retry returns an idempotency conflict.

The reservation prevents two clients from using one stale party snapshot. A rejected command still consumes its reserved revision. Clients must refresh after a terminal response.

This slice accepts only unconditional surrender terms. It rejects non-empty terms until a separate authority validates cargo, currency, prisoners, and safe passage atomically.

## Tick rules

The worker uses `simulation_tick`, route distance, and party speed. It does not use wall-clock time for movement or supply consumption. A successful call advances exactly one tick. Movement arrival, fatigue, and supplies change in that transaction.

Only one worker can hold a shard lease. The PostgreSQL advisory lock also serializes command acceptance, event sequence allocation, and tick advancement. An expired lease can be recovered by another worker.

## Operations

Run the caller on an always-on process. Do not use a browser or an untrusted client. Give the caller only the service-role environment at runtime. Use a unique worker ID. Call the RPC at the ruleset tick interval. Treat `lease_held` as a healthy no-op.

Do not apply this migration to production until it passes isolated PostgreSQL tests for concurrent command retries, lease takeover, movement arrival, trade conservation, command rejection, and transaction rollback. The repository check verifies the contract statically. It does not replace database integration tests.
