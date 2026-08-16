# Co-op Campaign Playthrough QA — 2026-08-16

## Scope

Alex and Ted will play the five campaign missions together. Ted will use a different hero on each mission. This document records observed bugs, fixes, usability problems, balance notes, and improvement recommendations.

## Test protocol

1. Start with a new public room for each mission.
2. Confirm the room roster, hero assignments, readiness, and host setup.
3. Confirm that all players spawn on reachable terrain.
4. Confirm that movement, commands, abilities, building, upgrades, and lockstep simulation continue correctly.
5. Record the network diagnostic chip when a freeze or hitch occurs.
6. Stop after a material issue. Add evidence and the proposed fix here before the next run.

## Hero rotation

- Mission 1 — Scott English
- Mission 2 — Alexander Thomas
- Mission 3 — Danny Donovan
- Mission 4 — Turtle Voss
- Mission 5 — John Marlowe
- Follow-up survival runs — Tiger Reyes and Aaron Whitlock

## Findings

### Confirmed before this run

- Fixed in PR #27: co-op parties could spawn inside impassable terrain when fixed center-map coordinates overlapped blocked geography.
- Fixed in PR #27: desktop room setup required page scrolling and made the roster, readiness state, and launch action difficult to understand.

### Live campaign findings

#### QA-001 — Host connection gate does not identify the blocked player

- Status: Confirmed
- Severity: Medium usability issue; blocks launch until manually recovered
- Room: `A2F6F9`, Greenfall Marches, three players
- Evidence: The host showed `CONNECTING 1 PLAYER` while all three roster rows showed `ready`. Ted's guest view independently showed a green direct connection to the host. Therefore the missing direct peer was Lyra, but the host UI did not identify that player.
- Cause: Readiness is durable room state. Direct WebRTC connectivity is host-local state. The room roster displays readiness but does not map each host peer connection back to its username.
- Immediate recovery: The affected guest must leave and rejoin, then mark Ready again.
- Recommendation: Show a separate connection badge on every roster row (`Connected`, `Connecting`, `Disconnected`). Change the launch gate to name the blocked player, for example `WAITING FOR @lyra TO CONNECT`. Add a host-side retry or remove-seat action for a stalled handshake.
- Console note: `ObjectMultiplex - orphaned data` came from a browser wallet extension and is unrelated to Zillions. Zillions reported normal host-route RTT samples.

## Final review

To be completed after the campaign playthrough.
