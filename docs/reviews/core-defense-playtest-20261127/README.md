# Greenfall command-only headless playtest

Scope: current core checkout, normal difficulty, Scott level 1, Greenfall seed 20101, deterministic combat seed 43. Runs capped at 600 simulated seconds. No gold, health, damage, kill, teleport or direct construction mutations. Driver sends ordinary `Game.exec` commands for movement, founding, builder orders/doctrines, ability casts, upgrade choices, focus and army stance. The crew purchases using earned currency.

Commands:

```
node scripts/core-defense-playtest.mjs develop 600
node scripts/core-defense-playtest.mjs mobilize 600
```

The first 60 seconds use the named crew order; both then use Develop. Hero clears nearby enemies and the first wave, then advances on reachable hives. Army switches Follow to Advance after the first defense. The driver spends earned skill points and casts available abilities. The implementation uses full terrain knowledge and per-tick input; this is not a representative human first-time session.

| Result | Develop opening | Mobilize opening |
|---|---:|---:|
| Outcome | Victory | Victory |
| Simulated duration | 287s | 221s |
| First defense cleared | 27s | 28s |
| Hives destroyed | 142s, 189s, 247s | 102s, 154s, 173s |
| Boss fight | 40s | 48s |
| Hero deaths | 0 | 0 |
| Troop losses | 25 | 18 |
| Structure losses | 0 | 1 house |
| Total kills | 663 | 452 |
| Earned gold telemetry | 2310 | 1060 |
| Crew spending | 1622 | 750 |

## Findings

1. **Actual end-to-end completion is demonstrated for both openings.** All three original hives (none marked off-map) are destroyed and the final boss dies. No terrain obstruction prevented these scripted completions. This does not rule out transient movement problems or other routes.
2. **Army-first is faster in this sample.** It wins 66 seconds sooner, with fewer troop casualties and less infrastructure. This is evidence to playtest opening choices, not proof that economy is unbalanced: both drivers share a rush-forward strategy, which favors early military production.
3. **Defense danger is low for this optimized driver.** Both finish without hero deaths; Develop's Keep was still 4105/4200 at 240s, Mobilize's 4200/4200 at 180s. Before increasing difficulty, inspect a real novice session: perfect routing and ability use are substantial advantages. If playtesting confirms excessive safety, tune one opening encounter rather than globally accelerating all hives.
4. **The core can be short.** These victories take 3.7–4.8 minutes, not 90 minutes. Duration is not a failure by itself. Decide whether one polished replayable short map is the intended initial product before adding bases or inflating HP.

## Driver limitation discovered and corrected

The first version updated direction only every 0.25s while following tile-center waypoints. It oscillated during the founding approach. Recomputing input every simulation tick, matching the existing movement regression harness, fixed this. Those preliminary non-founding runs are not included as game balance evidence. The retained runs use per-tick steering.

No game, map, UI, economy or authority code was changed by this playtest task. No browser/visual-quality or subjective-fun verdict is made.

## Additional curated maps (600-second cap, one run each)

Harness now accepts an optional fourth argument `levelId`, defaulting to 1. Maps without the Greenfall first-defense lesson switch the army to Advance after 45 seconds. This is a driver policy, not a game rule.

```
node scripts/core-defense-playtest.mjs develop 600 2
node scripts/core-defense-playtest.mjs develop 600 3
```

| Map | Actual result | Evidence |
|---|---|---|
| Rotmire (2) | **Unfinished at 600s**, not victory | All 3 hives destroyed at 469/508/558s; final boss alive with 195.594 HP. Hero level17, no hero deaths, upgraded Keep9000HP; crew136 construction purchases,137 troop losses. |
| Cinder (3) | **Defeat at 117s** | Keep destroyed; all4 hives remain, two damaged. Hero alive,324 kills,7 construction purchases,8 troop losses. |

### Interpretation

- **Do not claim all three maps passed completion.** Greenfall has two proven wins. Rotmire reaches the boss but does not finish within this authorized cap. Cinder loses.
- Rotmire shows sustained combat/progression rather than a demonstrated hard pathfinding deadlock: kills rise262→1775 between120–480s, the army eventually destroys every hive, and the boss takes nearly all its damage. The 469s delay to the first destroyed hive deserves a closer player-facing pacing review, not an automatic HP reduction based on this bot.
- Cinder's driver advances after45s and prioritizes enemies near the hero over enemies at the Keep. By60s the hero is roughly34tiles from the Keep, which has already lost360HP; the crew eventually retreats and the Keep dies. **The chosen rush policy fails to defend this map.** This is not evidence that Cinder is unwinnable or that route-finding is broken. Next useful validation is a defensive human/command run holding the first attacks before pushing; no difficulty change follows from this one loss.
- No additional runs or overtime boss resolution were used to turn either result into a claimed pass. No game changes.

## Authorized completion follow-up

The subsequent request permitted a720s Rotmire cap and a900s defensive Cinder run. These establish successful completion; the failed/limited earlier logs remain retained rather than overwritten.

```
node scripts/core-defense-playtest.mjs develop 720 2
node scripts/core-defense-playtest.mjs develop 900 3 defensive
```

- **Rotmire: victory at602s.** Same policy and600s prefix as the earlier capped run. All3 bases, then boss dead43s after spawn. Zero hero deaths,137 troop losses,2 farm losses. The earlier cap was two seconds short, not a hard deadlock. Log: `rotmire-complete.jsonl`.
- **Cinder: victory at565s.** Defensive policy holds army in Defend until180s, at least2 camps and3 towers; prioritizes threats within12tiles of the Keep and returns to defend when necessary. Purchases remain earned via crew. All4 bases fall at269/331/457/518s; boss fight47s. Zero hero deaths,153 troop losses,1 farm lost. No game tuning. Log: `cinder-defensive.jsonl`.
- Thus all three curated maps now have at least one command-only completed run. This establishes a reachable victory path, not that every reasonable strategy wins or that novice pacing/visual quality is approved.

The existing `scripts/playthrough-stuck-check.mjs` was also reviewed: it controls gameplay via `Game.exec`, with no gold/health/damage/construction fixture cheats. Its movement-method wrappers observe movement intent without changing returned movement results; it includes a snapshot/twin determinism check. Its separate Cinder win is legitimate command-driven evidence, although its build/attack policy differs from this harness.
