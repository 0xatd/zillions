# Draco — Zillions hero (draco)

Character: **Draco** — the green/teal marine with the red scarf (concept B2). Built with the same pipeline as Rykus (Sniper v3).
Asset: `hero_draco.glb`, suggested manifest key `marineHero_draco`, suggested integration path `assets/art-marines/hero_draco.glb` (not copied into the game repo; nothing deployed; no abilities/saves/roster changes).

## Files
| File | What |
|---|---|
| `hero_draco.glb` | Full-detail hero, the default for every graphics preset except Low. 47,404 tris, 10.2 MB, embedded textures. |
| `hero_draco_lod1.glb` | Light copy for the **Low** graphics preset in the video options only. About 15k tris, 1024² textures, same nodes/roles/extras (+ `lod: 1`, `graphics_preset: "Low"` on asset_root). |
| `hero_draco.blend` | Blender 5.2 source (TRELLIS high-poly in SRC, game meshes/pivots in GAME). |
| `textures/T_draco_albedo.jpg`, `T_draco_normal.png` | 2048² albedo (painted lighting for the game's Lambert path) + tangent normal (scale 0.7). |
| `build_report.json` | Measured build numbers. |
| `screenshots/` | Blender renders of the exported GLB and LOD1, silhouettes, Three.js captures (`threejs/`, `draco_threejs_sheet.jpg`, `draco_anim_sheet.jpg`). |
| `preview/index.html` | Three.js r160 preview of the actual GLB: in-game Lambert / PBR / silhouette; idle, walk (run), attack (recoil), cast. `?glb=../hero_draco_lod1.glb` previews the LOD. |
| `tools/` | GLTFLoader contract check (`verify.html`) and headless capture script (`shoot.mjs`). |

## Runtime contract (three r160 GLTFLoader: ok=true, problems=0)
Unique nodes `asset_root > body > leg_l, leg_r, arm_l, arm_r > weapon > socket_muzzle`, `body > socket_ability`; every node has `extras.role` = its name; rest rotations 0, scales +1, pose baked into meshes. Legs pivot at the hips, arms at the shoulders, weapon under `arm_r`.
glTF Y up, −Z forward, origin at ground centre, height **2.202**. No cameras/lights/skins/animations, no negative scales, 1 PBR material.
asset_root extras: `character_name: "Draco"`, `manifest_key: "marineHero_draco"`, `two_handed: true`, `grip_l_gltf` (left-hand foregrip point, glTF coords), `two_hand_note`.
Sockets (glTF world): muzzle [-0.82, 1.236, -1.189], ability [0, 2, -0.3].

| | Full | LOD1 (Low preset) |
|---|---|---|
| Triangles | 47,404 (body 29,037, legs 3,105/3,099, arms 3,658/3,705, weapon 4,800) | ~15,000 |
| Materials | 1 | 1 |
| Textures | 2× 2048² (33.5 MB decoded) | 2× 1024² |

Budget per Alex (t1618u–t1620u): heroes are built at full detail (up to ~50k tris, 2048² textures) by default; the LOD1 file maps to the **Low** graphics preset only.

## Weapon / grip (two-handed low-ready, re-posed per Alex t1622u/t1623u)
The railgun is held two-handed: right hand on the pistol grip at chest height, left arm bent with the hand on the handguard, barrel angled forward (−Z) and turned across the body (yaw 60°, pitch 10° down), stock tucked toward the right shoulder. The pose is baked into the meshes: all pivot rest rotations are still 0, the weapon node still sits under `arm_r`.
Measured (Blender, Z-up): grip [0.2, 0.6, 1.3], foregrip [0.014, 0.707, 1.309], muzzle [-0.82, 1.189, 1.236]; reach ratios R 0.892 / L 1.134.

**Game requirement:** `asset_root.userData.two_handed === true`. The game must drive **arm_l and arm_r with the same rotation** (same `rotation.x`; the existing two-hand fix) for idle/walk/attack/cast. Driving the arms independently (opposite walk swing) pulls the left hand off the handguard. The preview's `fix=1` mode does exactly this; the Three.js walk/recoil/cast frames in `screenshots/threejs/anim_*_fix_*` show the left-hand gap (probe on `grip_l_gltf`) staying at 0.0 cm.
Compromise: the TRELLIS arms are short for the wide pauldrons, so the left forearm is stretched slightly (~13.5 cm) to reach the handguard and the rifle is angled across the chest rather than straight ahead. The one-hand originals (GLB, LOD, .blend, build report) are backed up in `onehand/` next to this README on the Alienware.

## Notes
- Hero role/abilities not assigned (character model only); manifest key is a suggestion.
- Red scarf/cape is a stiff shape that belongs to the body group (no pivot, never moves with the arms): the arm split ignores geometry more than 0.3 behind the shoulders, and the re-pose moved another 630 red cape faces from the arm meshes into the body. In the two-hand pose, the cape tails show as flared flaps beside the back.
- TRELLIS painted a black slab on Draco's left side (both seeds 42 and 123); the build refills it from the mirrored right side (`slab_fix` in build_report.json).
- Re-pose cleanup removed TRELLIS floor-skirt fragments and leftover fist pieces where the arms used to hang.
- Fine paint speckle on large flat plates at close range (TRELLIS vertex colour); not visible at RTS distance.
