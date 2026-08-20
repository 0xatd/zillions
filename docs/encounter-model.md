# Living-world encounter model

The world server owns movement, contact, encounter choices, combat state, and results. Clients can request a choice. They cannot decide an outcome.

## Contact and pursuit

Contact does not start a tactical battle. The server first compares mobility and evasion. Speed, terrain, scouting, fatigue, army size, and baggage affect the result. A force that cannot escape does not receive a misleading escape action.

The caught force can fight, surrender, use auto-command, parley, call nearby allies, escape, commit a rearguard, create a diversion, fortify, or scatter. The server returns only valid actions. A rearguard removes named troops from the escaping force and exposes those troops to a high capture risk. It is not a free escape.

The pursuer can attack, demand surrender, negotiate safe passage, disengage, or choose between the main force and a committed rearguard.

## Battle modes

A sealed tactical engagement requires mutual agreement and an authoritative clear interference horizon. A hostile force that can arrive before the expected end makes the engagement ineligible.

Open engagements continue as deterministic server rounds. Troops, quality, morale, supplies, fatigue, terrain, and bounded seeded variance determine each round. The seed, engagement ID, and round number make results reproducible for audit and recovery.

A commander can play a tactical Zillions battle or use auto-command. A tactical result is a contribution to the authoritative engagement. Each contribution has a stable ID. Replaying the same contribution is a no-op. The authority layer must persist the contribution ID and state update in one transaction.

## Integration contract

The domain module is pure. It does not read clocks, storage, network state, or random globals. Callers supply snapshots and seeds. The authority layer must validate ownership and freshness, serialize competing commands, persist events, and broadcast the accepted state.
