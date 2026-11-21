# Zillions reusable map kit

Status: authored prototype, not a production release or finished art target.

Alex rejected the streets-only #136 result on 2026-11-21. Technical connectivity
was not enough: the screenshot did not read as an intentional fortress. Alex
requested reusable map parts in the spirit of the Warcraft II editor. This is
an authoring model reference, not permission to copy Warcraft assets.

## Composition contract

A map is a composition of reusable pieces, not a single custom mesh. Keep the
existing painterly art standard. Plan districts and roads before placing their
buildings. Use a dominant keep, readable gatehouse, three-tile main street,
smaller district lanes, grouped residential and economic frontages, and defenses
anchored to real terrain. A road graph passing tests is not visual acceptance.

## Files and flow

```text
map-kit.js: piece definitions + rotatable prefab groups
   ├─ map-kit-page.js: placement workbench → versioned JSON export/import
   └─ fortress-plan.js: Black Vale main-site composition
          → plot positions + reserved court/street cells
          → colony-roads.js: connected, built-footprint-safe network
          → colony-art.js: paving + cliff-top parapet rendering
          → existing Game simulation, occupancy and movement
```

- `src/map-kit.js`: integer tile coordinates; clockwise quarter-turn rotation;
  terrain, roads, ramps, wall, gate and tower descriptors; N/E/S/W neighbor
  ports; reusable boulevard, lane, gatehouse, courtyard and district groups.
- `map-kit.html`: local authoring workbench. Place or rotate pieces/groups,
  undo edits, clear, export and import a versioned 48×48 layout. Test walking
  routes with the shared collision/elevation compiler. This is a
  composition tool, not a campaign loader. Exported maps do not yet become
  playable missions. Terrain colors are schematic, not final material previews.
- `src/fortress-plan.js`: first playable consumer. Black Vale's **first city
  site only** rearranges existing economic buildings into district frontages,
  keeps IDs/counts, reserves courts and avenue, and rejects placements that
  sever access. Alternate sites and other missions keep their existing plans.
- `src/colony-art.js`: parapets occupy existing impassable cliff-edge ground;
  they are a visual treatment of natural barriers, not free simulated buildable
  walls. Buildable gate walls use the existing stone kit from their first tier;
  their upgrade stats remain unchanged.

## Scope and limitations

This proves a reusable data/placement foundation and one in-game composition.
The workbench's terrain and defense palette is an authoring catalog; only court,
street and district definitions feed the first campaign consumer. Full campaign
import, campaign terrain adapter, elevation editing, arbitrary prefab save,
and automatic validation of user-authored missions are not implemented. Do not
claim the workbench can publish playable maps or that all five maps are redesigned.

Natural cliffs, graded ramps, gate locations and military plots remain. Changes
to economic building positions can affect combat; simulation equivalence to the
old layout is neither expected nor claimed. Validate actual movement, campaign
behavior, deterministic restore and art at gameplay distance.

Snapshot version 7 and lobby protocol 8 protect this new layout. Old in-progress
sieges cannot be resumed by this branch; original save archival and account
progression remain intact. Do not merge or deploy without reviewing that impact.

## Next reuse boundary

Design a second distinct authored composition from the same pieces before
expanding the palette. A future editor must compile walkability and elevations
from the same data used for rendering, refuse blocked gate exits and overlapping
footprints, and keep stable prefab/layout versions for saves and multiplayer.

## Cross-map reuse and visual acceptance

Black Vale is the proving ground, not a bespoke asset exception. Shared cliff
crowns and rock materials now apply to both ledge-bearing biomes (Barrow Hills
and Black Vale). Crown geometry derives from the same clipped terrain triangles
and leaves graded ramps clear; it does not change walkability or height queries.
The road renderer distinguishes main stone streets from quieter earth lanes.
`applyFortressComposition` accepts authored street/district data; Black Vale
selects `crownCourts`, while other maps retain their own layout until deliberately
authored. Reuse the rules and pieces, not the identical fortress footprint.

For every new composition, inspect near, far and both side cliffs from the normal
gameplay camera, plus overview, ramp approach, crowded combat, Low quality and
phone. Check all five biome overviews whenever shared terrain/materials change.
Keep wall bases seated in rock, ramps visibly open, road hierarchy clear and
district edges natural. Save actual screenshots and traversal results. A test
pass is necessary, but does not establish visual quality. See
[reference study](city-reference-study.md) for observed design principles.
