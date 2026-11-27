# Castle-defense polish — review checkpoint, 2026-11-27

## Scope and preservation

Core checkout: `/tmp/zillions-castle-core-20261127`, branch `codex/castle-core-20261127`, base `8ba5ee1`.
Strategic work remains unchanged at `/tmp/zillions-reference-integration-20261127`, checkpoint `6decb54`.
The latest supplied goal string includes that strategic scope, while the active goal and Alex's explicit direction pause it. Scope clarification is pending. This checkpoint improves the existing core; it does not claim the larger integration finished.

## Pass 1 — gameplay and correctness

Existing command-only evidence is retained in `core-defense-playtest-20261127/README.md` and its JSONL logs. Greenfall wins with Develop (287s) and Mobilize (221s); Rotmire wins at602s; defensive Cinder wins at565s. The failed Cinder rush and earlier capped Rotmire run remain recorded. These are reachable victory paths, not human fun or novice balance proof.

Existing fixes add five starting troops per commander, avoid duplicating expedition armies/restored troops, pause passive income during the safe opening, and distinguish first-wave cleanup from resumed reinforcements. Protocol28 and simulation25 separate incompatible peers/replays.

## Pass 2 — presentation and usability

Existing work adds a framed sci-fi HUD, original SVG ability/item treatments, a closer camera, canopy depth and material detail. It is not WC3 asset-quality parity.

This continuation removes the duplicate map chooser and empty preview from standalone preparation. The chosen map remains in the heading; hero selection leads the panel. Duplicate leader controls and verbose culture methodology are omitted on that screen. Online room settings remain intact. Start remains accessible with scrolling configuration choices.

Evidence root: `/home/atd/.openclaw/workspace/outputs/zillions-castle-core-20261127/`.
`journey-final/` contains laptop1366×768, phone390×844 and landscape844×390 map/setup/battle captures. The browser journey exercises real Play/map/Start controls and difficulty buttons at each viewport. Founding is a disclosed simulation fixture for the battle screenshots. These are software-rendered captures, not hardware FPS evidence.

Known visual limits: several legacy heroes lack authored portraits; some legacy emoji glyphs render as missing glyph boxes in this browser. The art family remains simpler and more repetitive than the reference. Broader touched-screen and loading/error-state acceptance is not complete.

## Pass 3 — regression and release readiness

The former two-browser failure was an obsolete navigation assumption: it clicked the hidden old character-menu button after Play. The test now opens a map, enters preparation and clicks Invite. Transport, explicit Ready, hash, packet-loss, throttle and reload assertions were not relaxed.

Final check/build/journey/transport receipts are recorded below when settled. A local relay is not authenticated staging. Prior staging inventory found no dedicated candidate Supabase project/branch; see the preserved integration's `docs/reviews/staging-capability-20261127.md`. No candidate migration was applied to production.

## Remaining acceptance work

- Resolve core-only versus restored strategic integration scope before packaging a single final PR.
- Complete all touched-screen/error-state visual review and retained regression gates.
- Run the authenticated candidate journey on isolated staging; do not substitute local fixtures.
- Human assessment of core feel and representative hardware performance remain unproven.

No merge, production deployment, or completion claim.

## Settled receipts from this continuation

- `journey-final/result.json`: passed, zero page errors; real Start and difficulty controls at all three viewports; five fresh troops; no mandatory character creation or world encounter.
- `verification/final-build.log`: local `vercel build --prod --yes` passed after final CSS changes. This command builds locally; no deploy command ran.
- `verification/final-postgres.log`: 74 reward checks plus friend-party/replay/strategic-world authority suites passed in throwaway local PostgreSQL.
- `git diff --check`: passed.
- Rendered local relay: full check passed with WebRTC blocked and8% injected packet loss. Two-minute4×CPU-throttle phase: maximum sampled stall307ms, resync0ms. Guest reload recovered64.584s after page load, frame gap44; host refresh closed the stale invite. Slow software-rendered recovery remains a usability caveat, not a hardware benchmark.
- Full `npm run check`: passed, all script checks and337tests, zero failures.
