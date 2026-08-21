# Greenfall Operations Runbook

Greenfall is the first living-world region. The tutorial is complete only when the server records movement, town use, recruitment, trade, and battle evidence. Do not infer completion from client navigation.

Send `GET /api/living-world-operations` with the `x-admin-secret` header. Treat `status: degraded` as an exception. A lease is stale after 45 seconds without a heartbeat or after its deadline. A command is stuck after 60 seconds incomplete.

Recovery: stop the unhealthy worker, let its lease expire, start one replacement, confirm its newer lease epoch, replay the same request IDs, and verify the player projection plus latest `world_events` record. Do not apply migrations until the PostgreSQL authority suite, full repository checks, and Greenfall check pass on the same commit.

## Activation

Keep `LIVING_WORLD_RUNTIME_ENABLED` unset or set it to `0` during code deployment and migration rehearsal. The scheduled endpoint then returns `status: inactive` without reading the database.

1. Take and verify a database backup.
2. Run `npm run check:earth-region-postgres`. This command applies all migrations, rehearses transaction rollback of the runtime-unification migration, and applies it again.
3. Apply the reviewed migrations to the isolated release database.
4. Run the two-account HTTP journey and the tactical replay check against that database.
5. Set `LIVING_WORLD_RUNTIME_ENABLED=1` only in the isolated environment.
6. Confirm one bounded worker batch, current lease epochs, command latency, and conservation checks.
7. Promote the same configuration to production only after approval.

## Rollback

Set `LIVING_WORLD_RUNTIME_ENABLED=0` first. Confirm that the worker returns `status: inactive`. Do not start the retired shard worker. Restore the verified pre-activation database backup if a schema or data rollback is required. Re-run the player projection and event-sequence checks before traffic resumes.
