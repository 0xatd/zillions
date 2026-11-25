# Art Direction and Asset Contract

This document defines the production target for Zillions 3D art. It applies to
units, heroes, buildings, and defensive works.

## Reference priority — Alex, 2026-11-21

Read [Art Quality Standard](art-quality-standard.md). StarCraft II now leads
sci-fi architecture, scale and battlefield readability. Dawn of War IV supplies
weight and distinct faction silhouettes; Forsaken supplies painterly richness.
Compare gameplay with gameplay. Label cinematic, loading, menu and promotional
references separately. Apply one coherent language across those surfaces, not
only the map. Preserve the original Zillions identity and existing siege rules.

## Sci-fi direction (2026-11-21)

Alex explicitly chose stronger sci-fi. The default human settlement now targets
armored expedition architecture: ivory ceramic armor, blue-grey panels, steel
frames, amber markings and sparse cyan sensors. Author gatehouses as deep
mechanical passages with retracted blast doors. Keep openings visibly clear.
The reproducible source is `tools/art/toy_kit/frontier.py`; stable European
asset IDs preserve loading and saves. Other culture kits remain legacy.

## Target

Use a stylized, chunky science-fiction RTS style.

- Read the silhouette before the surface detail.
- Exaggerate weapons, shoulders, doors, turrets, and power systems.
- Keep broad armor planes and simple material groups.
- Use warm amber for human interaction and construction.
- Use cyan for human power and sensors.
- Use violet and magenta for Hive organs and weak points.
- Do not pursue photorealism.
- Do not use detail that disappears at the gameplay camera distance.

The player must identify a unit or building from its black silhouette at the
normal gameplay zoom.

## Scale

One world unit is one terrain tile.

| Asset | Target height | Target footprint |
| --- | ---: | ---: |
| Marine | 1.0 | 0.55 |
| Hero | 1.3 | 0.75 |
| Basic Hive unit | 0.9 | 0.7 |
| Wall module | 1.2 | 1.0 |
| Gate pylon | 2.4 | 0.55 |
| Mine | 2.5 | 2.0 |
| Barracks | 2.2 | 2.2 |
| Tower tier 1-3 | 3.5-5.2 | 2.0 |
| HQ tier 1-3 | 5.5-8.0 | 4.8 |

The asset origin must be at ground center. Positive Y is up in the GLB. The
model faces negative Z, which matches the Three.js camera convention. Blender
source faces positive Y before export axis conversion.

## Human Shape Language

- Use trapezoids, armored wedges, cylinders, and chamfered rectangles.
- Make the base heavy and the functional top easy to read.
- Show a building's job in its largest moving or glowing part.
- Keep one hull family: warm ivory plate, dark graphite frame, orange hazard
  trim, cyan power.
- Use faction color as a controlled secondary panel, not a full-body tint.

## Hive Shape Language

- Use asymmetry, curved shells, exposed tissue, and uneven limbs.
- Keep the center of mass low and forward.
- Make weak points emissive and visible from above.
- Do not reuse human mechanical shapes.

## Tier Language

An upgrade must change the silhouette.

- Tier 1: deployed field equipment. Low, exposed, and lightly armored.
- Tier 2: fortified production asset. Add mass, armor, and one secondary system.
- Tier 3: landmark. Add height, a unique crown, and an unmistakable active
  mechanism.

Do not communicate a tier by color or tiny attachments alone.

## Unit Requirements

Every production unit must provide:

- idle, move, attack, hit, and death motion
- one named weapon or ability socket
- readable feet and facing direction
- a shadow-safe ground origin
- faction color support
- a low-cost crowd variant when the normal asset exceeds the crowd budget

Heroes also need a cast pose and one silhouette-defining prop.

## Building Requirements

Every production building must provide:

- complete model for each visible tier
- construction or deployment state
- damaged state below 50 percent health
- destroyed shell or ruin state
- named effect sockets
- doors, muzzles, rotors, or cores that show its function

Terrain-derived walls and gates remain assembled at runtime. Their authored
modules must follow the generated rampart path instead of replacing it.

## Names and Sockets

Use lower snake case.

- Root: `asset_root`
- Animated body: `body`
- Weapon: `weapon`
- Limbs: `leg_l`, `leg_r`, `arm_l`, `arm_r`
- Muzzle: `socket_muzzle`
- Ability: `socket_ability`
- Damage smoke: `socket_damage`
- Building moving part: `part_turret`, `part_rotor`, or `part_core`

Do not rename a socket after the asset reaches `main` without updating the
asset validator and runtime binding.

## Browser Budgets

These are hard budgets for the first production slice.

| Asset | Triangles | Materials | Texture memory |
| --- | ---: | ---: | ---: |
| Hero | 8,000 | 4 | 4 MB |
| Marine | 4,000 | 4 | 2 MB |
| Basic Hive unit | 3,500 | 3 | 2 MB |
| Small building | 8,000 | 4 | 4 MB |
| HQ | 18,000 | 5 | 8 MB |
| Wall or gate module | 2,500 | 3 | 2 MB |

Use one atlas per faction kit where practical. Prefer 1024 px atlases. Use
2048 px only when the gameplay camera proves that 1024 px is insufficient.

## Acceptance

An asset is not approved from a Blender viewport alone.

1. Validate the GLB.
2. Load the review gallery.
3. Test the silhouette view.
4. Test normal gameplay zoom.
5. Test High and Low graphics modes.
6. Run a five-minute Level 1 battle.
7. Confirm no gameplay collision or deterministic state changed.

## Runtime Procedural Art Playbook

The runtime art layer (everything that renders without a GLB) lives in three
modules, one pattern each. Read this before "improving the art" — it encodes
what was learned shipping the current look.

### The three modules and their contracts

- `src/horde-art.js` — every zombie type is merged vertex-colored geometry
  drawn as instanced meshes: `body` + swinging `arms` (single pivot, per-type
  cadence) + unlit glow `eyes`. Both the game renderer and the menu vignette
  write through the same `HordeArt` writer, so the menu horde IS the game's.
  Budget: keep massed types near 1,200–1,600 triangles — these instance up to
  `ZMAX` (1,700) times, and smooth vertex normals keep low-segment capsules
  looking round at gameplay zoom.
- `src/unit-art.js` — troops and heroes share one articulated rig: leg and
  arm groups pivot at hip/shoulder with rest rotation 0, registered in
  `userData.limbs`, which is exactly what `_syncUnits`' stride animation
  drives. Weapons carry `userData.restPos/restRot` and live in
  `userData.weaponParts`. Bodies are capsules/ellipsoids (smooth), gear and
  armor plates stay crisp — soft body under hard equipment.
- `src/building-art.js` — each building is MERGED geometry: one shadowed
  body mesh + one always-lit glow mesh + one night-window mesh (≈3 draw
  calls regardless of part count — that budget is what buys the detail).
  Only parts that move (turret `head`, `rotor`, `flame`, `flag`, `core`)
  stay separate meshes, on the same `userData` names the renderer binds.
  Damage soot, critical flicker, and construction ghosts all work by
  mutating the merged materials — never share those materials across
  buildings.

### Surface detail: the atlas pipeline

Vertex colors carry hue; textures carry SURFACE. `tools/art/gen_textures.py`
(python3 + Pillow) generates `assets/textures/colony-atlas.png` — panel
seams, rivets, grime streaks, brushed steel, cracked concrete, solar cells —
and `assets/textures/terrain-grain.png`. Two rules make it composable:

1. Tiles are near-neutral luminance so they multiply under any palette hue.
2. Every tile carries an edge-AO vignette, so every mapped face gets contact
   shadows at its corners for free.

`building-art.js` picks a tile per part from the part's hex
(`atlasTileFor`), and `build()` bakes a vertical AO ramp (dark footings →
bright crowns — hand-painted value structure) plus positional grime noise
into the vertex colors. If you add a material family, add a tile and a hex
mapping — do not hand-UV individual parts.

### Authored GLBs

`USE_AUTHORED_BUILDINGS` in `building-art.js` is off: the textured
procedural kit outclasses the first art-slice GLBs. The GLB path still
works — drop better models (purchased packs, sculpted exports) into
`assets/` and flip the flag, or extend the manifest in `src/assets.js`.
Runtime network access cannot fetch asset packs (the sandbox proxy blocks
asset CDNs); authored assets must be committed to the repo.

### Verify against REAL renders, never flat previews

The single biggest trap: judging art from a headless rasterizer or Blender
viewport. The live renderer has ACES tone mapping, hemisphere + directional
light, 2048 px shadows, bloom, and fog — flat previews systematically
undersell it and will steer you toward over-darkening and over-detailing.
Use `tools/preview-shot.mjs`:

    python3 -m http.server 8123        # from the repo root
    node tools/preview-shot.mjs city out.png 1 8   # boots a built city
    ZOOM=16 node tools/preview-shot.mjs city close.png

It boots the actual game headless (Chromium + playwright-core), can found
and fully construct a city instantly, and screenshots true gameplay frames.
Judge every art change there before pushing.

## Painted frontier environment pass — November 2026

Alex's new reference bar is the terrain/base readability and material richness of
StarCraft and Warcraft III. This supersedes the previous texture-free environment
constraint, not the requirement for readable silhouettes or original assets.

- Blend painted grass into worn working earth; keep routes in continuous stone.
- Dark slate faces and pale ramp beds separate impassable cliffs from entrances.
- Preserve biome palettes, unit colours, building tiers and collision geometry.
- Use fuller clustered foliage, restrained roof joints and weathered foundations.
- Judge the actual playable camera, not a texture sheet or a cinematic close-up.

`assets/materials/frontier-atlas.webp` is an original AI-generated four-material
atlas (grass, earth, paving, rock), generated for this project on 2026-11-20.
It contains no extracted Blizzard assets. World-space sampling and shared atlas
storage keep detail coherent without per-building image downloads. Control maps
are presentation-only and consume no simulation randomness.

Reference study (composition/material principles only):
- https://news.blizzard.com/en-us/article/5740267/game-guide-terran-ramp-defense
- https://news.blizzard.com/en-us/article/23395649/revisiting-the-warcraft-iii-editor
- https://www.playground.ru/warcraft_3/news/blizzard_vernuli_originalnyj_warcraft_3_v_battle_net-1841635

Cliff contour refinement incorporates the reviewed terrace-mesh changes from
`cursor/smooth-cliff-rims-0f49` (PR #128), without importing its unrelated files.
The navigation regression suite remains the authority on actual access.

## Colony crew

The shared builder is a compact amber utility rig with dark feet/backpack, a
cyan visor, and a work tool. It is smaller than the hero and has no gun. Its
route bob and working-tool movement reflect simulation status without changing
collision. The procedural mesh is retained across frames and disposed on a
new battlefield. High and Low must both keep its silhouette readable.
## Combat intent cues

A small red ring marks the hero's current automatic attack target; amber marks
an explicit Focus attacks choice. Inspection retains its larger cyan/red ring.
Acid impact warnings use yellow-green outlines; heavy smashes use orange.
A growing white timing ring approaches the fixed impact boundary.
Only show pending warnings within allied vision, in both High and Low. Render
from simulation windup state rather than a presentation event timer, and pool
up to 48 cue meshes to bound cost. Dispose the pool when the game changes.
