# Timed hero attacks — 2026-11-26

Stacked on `codex/siege-feel-20261126` (PR #157). No merge or production rollout.

## Implemented contract

- Right-click enemy pursues and repeatedly attacks that id, not a nearby substitute.
- Ground move cancels unreleased attacks and recovery. It never resets the attack cooldown.
- A + ground click pauses for in-range contacts and resumes the destination after they die.
- S stops and suppresses attacks; H holds position and attacks without chasing. Both are rebindable. WASD camera mode parks S; existing stored WASD settings migrate without losing their camera key.
- Hero-only wind-up, release and recovery. Ranged attacks apply damage on projectile arrival. Melee hits at release. Flight survives movement and shooter death. Squads retain their prior autonomous behavior.
- Attack poses use simulation state. Flight follows the simulation clock, including pause. Target highlight persists during pursuit; attack range appears while targeting/holding/winding up.
- Pending swing, released payloads, cooldown, moving state and order survive restore and enter the peer hash. Snapshot 14 reads 12/13; protocol and shared replay simulation 21 refuse mixed clients.

## Verification

`tests/timed-attacks.test.mjs` owns cancellation, target priority, pursuit, attack-move resumption, stop/hold, melee/ranged timing, spam bounds, shooter death, and mid-combat restore. Eight initial contracts failed against PR157's old code, and passed after implementation. The movement-restore regression was reproduced in two independent browsers: the old snapshot omitted `moving`, changing the attack decision immediately after restore. A committed regression exercises the real unit-before-hero update order.

`browser-shell-check.mjs` dispatches real S/H key events and checks the resulting orders, cleared movement and absence of the old H help-menu side effect. Existing real QWER/camera/direct-movement checks remain.

Additional browser scenario uses real pointer targeting, S/H, projectile flight before damage and pause synchronization, then a 180-second visible-target siege. One recorded run: 66 releases, first contact 16.13s, opening complete 29.03s, Keep 4200/4200, no hero deaths. This is a scripted combat scenario, not uncoached onboarding or proof of fun. Laptop 1366×768 and phone-landscape 844×390 inspected. Software-rendered host; no hardware FPS claim.

Two independent browser contexts exchange commands over real local WebRTC for 120 simulation seconds, including guest stop/hold and a guest snapshot restore at 50s. Every compared window hash agrees after the movement-state repair.

Full check, local production build, browser shell and throwaway PostgreSQL gates are required. Final command receipts and screenshots live in operator evidence `outputs/zillions-timed-attacks-20261126/`; do not treat this report as a production release receipt.

## Deliberate limits

No Dota item system, last-hit economy, denies, exact Dota patch parity or new art assets. Phone screenshots validate layout, not a new touch-control scheme. PR155/156 overlap the underlying PR157; integration must preserve the new timing/commands and re-evaluate protocol numbers before landing the stack. Human play-feel assessment remains necessary.
