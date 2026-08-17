# Art Direction and Asset Contract

This document defines the production target for Zillions 3D art. It applies to
units, heroes, buildings, and defensive works.

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
