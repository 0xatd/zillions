# Pull Request Review Guide

Use this guide for every Zillions pull request.

## 1. Confirm Provenance

Record these facts:

- repository
- pull request number
- author
- base branch and SHA
- head branch and SHA
- draft state
- changed files

Review the full diff against the declared base. Do not review only the newest
commit.

## 2. Classify Risk

Mark each applicable risk:

- deterministic simulation
- snapshot or restore
- map generation or reachability
- WebRTC or multiplayer startup
- account identity or authorization
- Supabase schema or data ownership
- save migration
- Three.js performance or resource lifetime
- public menu or gameplay UX
- deployment configuration

Use the highest applicable risk for the review depth.

## 3. Read the Complete Flow

Trace each changed flow from input to final state.

For a multiplayer change, inspect:

```text
UI action -> Supabase room state -> WebRTC state -> start gate -> Game command
```

For a simulation change, inspect:

```text
input -> Game.exec() -> state mutation -> snapshot -> restore -> next tick
```

For a map change, inspect:

```text
seed -> terrain -> sites -> plots -> lanes -> reachability -> rendering
```

## 4. Check Required Invariants

Verify these conditions when applicable:

- All peers use deterministic data and command order.
- New future-affecting state survives snapshot and restore.
- Every hive is reachable from every city site.
- Every colony boundary is closed.
- Every principal gate is open.
- Friendly troops can leave the colony.
- Each hero starts on connected walkable ground.
- A watcher does not take a seat.
- A stale client cannot join or Watch.
- A host cannot start with a disconnected or ineligible seat.
- Private Google identity never reaches public UI.
- Failed writes show an actionable error.
- Removed Three.js objects release owned GPU resources.

## 5. Run Automated Checks

Install exact dependencies:

```bash
npm ci
```

Run the complete suite:

```bash
npm run check
```

Check patch hygiene:

```bash
git diff --check <base>...<head>
```

Validate audio metadata when audio changed:

```bash
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
```

Scan the changed files for secrets. Do not print secret values.

## 6. Run Targeted Checks

Add a committed regression check for each bug fix.

Use these existing checks as patterns:

- `scripts/sim-determinism-check.mjs`
- `scripts/hero-ability-restore-check.mjs`
- `scripts/map-check.mjs`
- `scripts/online-signaling-check.mjs`
- `scripts/multiplayer-start-check.mjs`
- `scripts/room-lifecycle-check.mjs`
- `scripts/lobby-hardening-check.mjs`

A temporary local script does not count as regression coverage.

## 7. Run the Production Build

Run the local Vercel build on the exact reviewed head:

```bash
vercel build
```

Do not call the pull request deployable if this command fails.

The Vercel preview check is useful evidence. It does not replace the local
build.

## 8. Test in a Browser

Test the changed user flow at desktop size.

Also test mobile size when the pull request changes menus, setup, lobby, or
HUD layout.

For multiplayer changes, test with at least two independent browser sessions.
Test join, Ready, start, disconnect, reconnect, leave, and host close when the
changed scope touches those actions.

## 9. Give a Hard Verdict

Use this format:

```text
Mergeable: YES or NO
Deployable: YES or NO
Blockers: exact defects or none
Risk: LOW, MEDIUM, or HIGH
Evidence: tests, local build, browser checks, and CI
```

Do not use a conditional approval when a known blocker remains.

## 10. After Merge

Monitor the production deployment.

Verify the canonical site:

https://zillions.taborlin.co

For protocol changes, tell all players to refresh. Close and recreate rooms
that an older build created.
