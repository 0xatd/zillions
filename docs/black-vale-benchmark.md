# Black Vale playable art benchmark

Read [Art Quality Standard](art-quality-standard.md) first. This is a repeatable
review scene, not a claim that Zillions has reached the reference's finish.

## Fixed scene

- Campaign level 5, Black Vale, its built-in terrain and offline simulation seed.
- European colony, Scott, normal difficulty, first city site.
- Construct the planned inner plots with the existing development harness.
- Keep fog of war, normal HUD and the real game lighting enabled.
- Built overview: camera distance 100, 1440 × 1000, High quality.
- Ramp: place Scott at `sites[0].switchbacks[1][2]`, distance 55.
- Repeat the ramp at 844 × 390 and at Low quality.
- Battle: return Scott to the city; advance exactly 9,000 simulation ticks at
  1/30 second. Frame the surviving hero at distance 65. Do not claim this is
  five minutes of real-time GPU performance.
- Inspect level 1's five-minute battle as well. Inspect all five campaign
  palettes after shared lighting or material changes.

## Capture discipline

Stop the animation loop on a software-rendered host. Wait for `loadAssets()`
to finish. Render a complete frame after moving the camera or changing state,
then finish WebGL work before capturing. Delays alone do not establish readiness.
The frontier atlas starts loading when its material first compiles; `loadAssets()`
alone does not wait for it. Verify the atlas image is complete and has a nonzero
width, then render again. Use a fresh browser page or the normal match teardown
when changing maps: calling `startGame()` twice directly leaves old terrain.

For the closer combat comparison, place Scott on the walkable tile nearest
`(site.x, site.z - 10)` before the same 9,000 ticks, then frame him at distance 48.
This keeps him visible rather than hiding him behind the central keep.

For full-frame costs, turn `renderer.info.autoReset` off, reset just before
`frame()`, then record calls and triangles after it. Include shadow and post
passes equally. Compare the same scene against the previous commit. Report
software-renderer cost counters, not hardware GPU FPS.

Gallery images supplement gameplay. Inspect all changed models in normal and
silhouette views. Preserve limb pivots, faction identity and procedural fallback.
A missing GLB must not stop a match. Also inspect construction, damaged and
upgraded buildings when touching their shared materials.

## Authored combat family

`tools/art/toy_kit/combat.py` supplies European infantry and the shared hive
family. Low-ring sculpted armor, folded cloth, curved shells and named moving
parts export through the existing Blender kit. Color values are baked into
geometry; these assets add no textures, material slots or runtime generators.
`european.py` retains the hero identities and bikes and calls the same shape
helpers for their fairings and capes.

Regenerate:

```sh
blender --background --python tools/art/toy_kit/build.py -- --culture european \
  --only unit_soldier,unit_ranger,unit_sniper,hero_scott,hero_alexander,hero_danny,enemy_walker,enemy_runner,enemy_brute,enemy_spitter,enemy_burrower,enemy_sieger,enemy_caller
node scripts/toy-kit-check.mjs
npm run check
vercel build --prod
```

The shared building shader keeps blue roofs subordinate to unit/hero accents.
The existing sun and hemisphere lights provide warm/cool separation; no extra
light, shadow pass or day/night mechanic is introduced.

## Still below the north star

Terrain retains tile-derived cliff outlines. The hero rigs remain stylized
procedural-part animation, not finished skeletal performances. Other culture
armies retain their existing models. The small-screen HUD needs separate work.
Do not treat screenshots or passing tests as evidence that these gaps are closed.
