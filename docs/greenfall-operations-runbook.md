# Living World Operations Runbook

Greenfall is the first living-world region. The tutorial is complete only when the server records movement, town use, recruitment, trade, and battle evidence. Do not infer completion from client navigation.

Send `GET /api/living-world-operations` with the `x-admin-secret` header. Treat `status: degraded` as an exception. The response includes failed and threshold-breached runtime health rows. The five-minute health monitor sends degraded incidents to `LIVING_WORLD_ALERT_WEBHOOK_URL`. Keep that variable configured before activation; an absent or failed delivery makes the monitor fail visibly.

Recovery: stop the unhealthy worker, let its lease expire, start one replacement, confirm its newer lease epoch, replay the same request IDs, and verify the player projection plus latest `world_events` record. Do not apply migrations until the PostgreSQL authority suite, full repository checks, and Greenfall check pass on the same commit.

## Activation

Keep `LIVING_WORLD_RUNTIME_ENABLED` unset or set it to `0` during code deployment and migration rehearsal. The scheduled endpoint then returns `status: inactive` without reading the database.

1. Take a named pre-activation database backup. Restore it to an isolated project. Compare the restored manifest hash, topology fingerprint, player count, event sequence, and authority-table counts with production. Record the backup ID, restore project ID, fingerprints, and operator approval. A backup that has not passed this restore drill is not verified.
2. Run `npm run check:earth-region-postgres`. This command applies all migrations, rehearses transaction rollback of the runtime-unification migration, and applies it again.
3. Apply the reviewed migrations to the isolated release database.
4. Run the hosted rehearsal against all 72 Earth regions. It must prove two-account entry, recruit, supply, trade, movement, lease takeover, encounter, deterministic autosim, battle commit, casualties, prisoners/cargo consequences, and persistent writeback.
5. Set `LIVING_WORLD_RUNTIME_ENABLED=1` only in the isolated environment.
6. Confirm that one scheduled invocation selects all 72 regions, current lease epochs, runtime-health rows, alert delivery, command latency, and conservation checks.
7. Promote the same configuration to production only after approval.

## Rollback

Set `LIVING_WORLD_RUNTIME_ENABLED=0` first. Confirm that the worker returns `status: inactive`. Do not start the retired shard worker. Restore the exact backup that passed the isolated restore drill if a schema or data rollback is required. Compare its recorded fingerprints before traffic resumes. Re-run player projection, event sequence, topology fingerprint, and battle-writeback checks.
