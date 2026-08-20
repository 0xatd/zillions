# Living-world battle authority

The tactical client does not own a battle result.

1. An authenticated commander requests a launch assignment.
2. The database locks the active engagement and encounter. It records the encounter revision and an immutable force, cargo, terrain, and seed snapshot.
3. The API signs the assignment with `LIVING_WORLD_BATTLE_SIGNING_SECRET`.
4. The battle service verifies the assignment and runs the tactical battle.
5. Only that service can return a result. It must use `LIVING_WORLD_BATTLE_AUTHORITY_SECRET`.
6. The API verifies the signed assignment, its expiry, and the result shape. The database checks the assignment nonce and encounter revision again.
7. One transaction applies casualties, wounds, morale, cargo transfers, prisoners, retreat data, engagement completion, encounter completion, and the audit event.

The assignment can be committed once. An exact retry returns success. A different replay fails. Casualties cannot exceed the healthy soldiers in a stack. Cargo cannot exceed unreserved stock. All affected stacks and parties must belong to the assigned encounter.

Keep both secrets server-only. Do not expose them through `VITE_` or `NEXT_PUBLIC_` variables. Rotate the authority secret if the battle service is compromised. Cancel old open assignments when the signing secret changes.

This boundary prevents a browser from inventing an army, victory, reward, or result. It does not make a browser-hosted simulation authoritative. Production battles must run on, or be attested by, the trusted battle service.
