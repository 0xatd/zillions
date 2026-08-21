# Living-world worker

The database owns each region tick. The scheduled endpoint selects a bounded set of regions. It then claims a renewable region lease and calls `process_world_region_runtime` with the service role. The function applies queued commands in a stable order and advances one simulation tick in one transaction. `living_world_process_shard` is retired and always fails closed.

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

Only one worker can hold a region lease. The lease epoch fences stale worker processes. The PostgreSQL advisory lock serializes tick advancement for the region. An expired lease can be recovered by another worker.

Each region tick performs these actions under the same lease:

1. Complete inbound region handoffs.
2. Apply queued player commands.
3. Create encounters when hostile parties meet.
4. Advance movement and faction AI.
5. Process logistics and markets.
6. Advance active sieges and resolve terminal siege states.
7. Store one durable runtime-tick result.

## Operations

Keep `LIVING_WORLD_RUNTIME_ENABLED` unset until the migrations and activation checks pass. The scheduled endpoint returns `inactive` without database access while this flag is off. Do not use a browser or an untrusted client as a worker. Give the endpoint only the service-role environment at runtime. Use a unique worker ID. Treat a held lease as a healthy no-op.

Do not apply this migration to production until it passes isolated PostgreSQL tests for concurrent command retries, lease takeover, movement arrival, trade conservation, command rejection, and transaction rollback. The repository check verifies the contract statically. It does not replace database integration tests.
