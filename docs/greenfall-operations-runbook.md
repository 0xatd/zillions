# Greenfall Operations Runbook

Greenfall is the first living-world region. The tutorial is complete only when the server records movement, town use, recruitment, trade, and battle evidence. Do not infer completion from client navigation.

Send `GET /api/living-world-operations` with the `x-admin-secret` header. Treat `status: degraded` as an exception. A lease is stale after 45 seconds without a heartbeat or after its deadline. A command is stuck after 60 seconds incomplete.

Recovery: stop the unhealthy worker, let its lease expire, start one replacement, confirm its newer lease epoch, replay the same request IDs, and verify the player projection plus latest `world_events` record. Do not apply migrations until the PostgreSQL authority suite, full repository checks, and Greenfall check pass on the same commit.
