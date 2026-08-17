# 3D Asset Pipeline

The production site loads GLB files. Blender is an authoring tool only.

## Source

The first vertical slice is reproducible from
`tools/art/build_vertical_slice.py`. Later hand-authored Blender files belong
under `art-source/` and must use Git LFS before they are committed.

Do not commit Blender caches, renders, or temporary exports.

## Export

Run:

```bash
blender --background --python tools/art/build_vertical_slice.py
node scripts/art-asset-check.mjs
```

The script writes production files to `assets/art-slice/`.

Export rules:

- GLB format
- Y up
- negative Z forward in the GLB
- positive Y forward in Blender source
- origin at ground center
- apply object transforms
- include custom properties
- no cameras or lights
- no external texture paths

## Runtime

`src/assets.js` owns asset paths and loading. A missing authored model must fall
back to the current procedural model. Presentation assets must never stop the
simulation from starting.

`src/main.js` binds named moving parts and effect sockets. Model state does not
belong in deterministic snapshots.

## Review

Open `/art-slice.html`. Review each model in material and silhouette modes.
Use the State review control to inspect idle, run, attack, cast, hit, down,
construction, damaged, and critical presentation states. Test at the marked
gameplay camera distance.

Do not merge an asset when it only looks good in the close inspection view.

## First Slice Status

The first slice proves the authored-model pipeline and the visual language.

- Scott, the rifleman, HQ tiers, tower tiers, barracks tiers, and the mine are
  connected to gameplay with procedural fallbacks.
- Named limbs, weapons, turrets, rotors, and cores bind to the current runtime
  motion system.
- The Hive drone, wall, and gate are review targets. They are not used in a
  battle yet. Hive crowds need an instanced or batched authored-model path
  before replacement. Generated ramparts need module placement integration.
- Runtime construction, damage, critical, idle, run, attack, cast, hit, and
  down states are connected through `src/art-state.js`. They are presentation
  only and do not change deterministic simulation state.
- Destroyed shells, baked skeletal clips, and texture-atlas work remain
  expansion gates. The contract defines them now so later assets do not drift.
