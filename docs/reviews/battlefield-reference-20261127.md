# Battlefield presentation reference pass — 2026-11-27

This is a restrained environment/material improvement, **not parity with the supplied WC3 battlefield**. The established simulation, colony footprint, walkable routes, fortification geometry, fog and game protocol are unchanged.

## Changes

- Taller, darker forest interiors and lower route-facing fringes give existing groves a layered silhouette without widening crowns or changing root positions.
- Broad warm/cool canopy shading improves the existing foliage material at normal tactical distance.
- Existing European/sci-fi colony paving has procedural recessed service-deck seams and subtle fasteners. Other cultures retain their armor material.
- No additional geometry or draw batches are introduced by this pass. No textures or third-party assets are added.

## Reproduction and evidence

Run `node scripts/battlefield-reference-capture.mjs`. Optional environment variables: `CAPTURE_TAG`, `CAPTURE_LEVEL`, `CAPTURE_QUALITY`, `CAPTURE_DISTANCE`.

Evidence directory: `/home/atd/.openclaw/workspace/outputs/zillions-reference-integration-20261127/battlefield`.

- `before-{partial,developed}.png` and `after-{partial,developed}.png`: Greenfall at the same distance 48 and HQ focus. Battlefield draw count remained 590. HUD changes in the shared worktree belong to the separate HUD pass.
- `high-close-*` and `low-close-*`: distance 42, partial/developed colonies, active combat and 844×390 landscape viewport.
- `biome-2-*` through `biome-5-*`: corresponding developed/partial/combat fixtures for the other campaign biomes. These are sibling render regression checks, not additional bespoke art passes.
- Developed screenshots use a **test fixture** that constructs existing colony plots and adds troops, not an organically earned save. Combat spawns existing enemies and advances the real simulation 75 steps. These images demonstrate rendering and readability, not balance or campaign progression.

Ten existing targeted tests pass: landscape state and impassable-root checks across five biomes, culture paving and lane containment, cliff geometry and fortress boundaries. Capture JSON records page errors and frame geometry; software-rendered browser captures are not a hardware FPS benchmark.

## Remaining gap

The existing models remain visibly low-poly; buildings are repetitive, troops small, and combat effects simple. This work does not claim to replace the model family or deliver the rich authored asset quality of the reference. A developed real colony is more substantial than its empty opening state, but further unit/building art direction and composition work remain necessary. Parent integration owns camera framing, HUD and gameplay changes.

The captured shared-worktree HUD was still in progress: mobile landscape shows horizontally clipped global controls and oversized/overlapping build-mode text; tutorial and upgrade panels obscure much of the battlefield. Those frames are not final HUD acceptance evidence. Final integrated responsive inspection must happen after the HUD agent finishes.
