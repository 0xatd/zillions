# Earth Bootstrap and Party Model

The first living-world shard is `earth-1`. The migration seeds one Greenfall province, four connected locations, local markets, and three AI-controlled parties. Stable identifiers and upserts make the bootstrap safe to replay.

The social party is separate from a world army. A social party stores invitations and membership across sessions. A world party stores the army that moves on the strategic map. This separation prevents a tactical room from becoming the durable source of truth for friends and ownership.

`social_party_command` provides idempotent invite, accept, decline, and revoke operations. Only leaders and officers can invite or revoke. Only the invited user can accept or decline. Direct client writes remain disabled.

The tutorial exit is server-authoritative:

1. Trusted game services record successful movement, town, recruitment, trade, and battle actions.
2. The client can read its progress, but it cannot write progress directly.
3. `enter_living_world` rejects an incomplete tutorial.
4. A successful exit creates one player world party and one social party at Greenfall Crossing.
5. Repeated exit requests return the existing party.

The authenticated `POST /api/living-world-entry` endpoint accepts only a `characterId`. It derives the user from the verified bearer token and calls the service-role RPC. The RPC checks character ownership and tutorial completion again before it creates state.

The migration grants no direct client writes. RLS limits reads to the player or social-party members. Service-role RPCs perform all mutations.
