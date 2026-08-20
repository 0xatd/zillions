# Living World API

The API is the only browser boundary for the persistent world. The browser sends a bearer token and an intent. It never sends an actor identity or receives a service-role key.

## Read a projection

Send `GET /api/living-world?shardId=earth` with `Authorization: Bearer <access-token>`. The server returns the user's parties and a filtered map. Faction access, current presence, and current scouting reports grant visibility. Routes require both endpoints to be visible. Enemy parties expose scouting intelligence instead of raw private army fields.

## Submit a command

Send `POST /api/living-world` with the bearer token and an envelope with `type`, `requestId`, `shardId`, `partyId`, `expectedRevision`, and `payload`. The endpoint rejects actor or user ID fields, unknown commands, unknown payload fields, and invalid identifiers. It calls service-only `living_world_command`; `p_actor` always comes from the verified token. The RPC checks ownership and revision.

Supported commands are `issue_movement`, `cancel_movement`, `set_encounter_choice`, `submit_battle_order`, `accept_surrender`, and `trade_market`.

Keep `SUPABASE_SERVICE_ROLE_KEY` on the server. Do not apply the migration to production until concurrency, replay, conservation, disconnect, and RLS tests pass in isolation.
