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

No findings yet.

## Final review

To be completed after the campaign playthrough.
