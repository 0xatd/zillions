# Tynor — Zillions hero (tynor)

Character: **Tynor** — the blue-and-orange visor marine (concept B1). Built with the same pipeline as Rykus (Sniper v3).
Asset: `hero_tynor.glb`, suggested manifest key `marineHero_tynor`, suggested integration path `assets/art-marines/hero_tynor.glb` (not copied into the game repo; nothing deployed; no abilities/saves/roster changes).

## Files
| File | What |
|---|---|
| `hero_tynor.glb` | Full-detail hero, the default for every graphics preset except Low. 49,201 tris, 9.8 MB, embedded textures. |
| `hero_tynor_lod1.glb` | Light copy for the **Low** graphics preset in the video options only. About 15k tris, 1024² textures, same nodes/roles/extras (+ `lod: 1`, `graphics_preset: "Low"` on asset_root). |
| `hero_tynor.blend` | Blender 5.2 source (TRELLIS high-poly in SRC, game meshes/pivots in GAME). |
| `textures/T_tynor_albedo.jpg`, `T_tynor_normal.png` | 2048² albedo (painted lighting for the game's Lambert path) + tangent normal (scale 0.7). |
| `build_report.json` | Measured build numbers. |
| `screenshots/` | Blender renders of the exported GLB and LOD1, silhouettes, Three.js captures (`threejs/`, `tynor_threejs_sheet.jpg`, `tynor_anim_sheet.jpg`). |
| `preview/index.html` | Three.js r160 preview of the actual GLB: in-game Lambert / PBR / silhouette; idle, walk (run), attack (recoil), cast. `?glb=../hero_tynor_lod1.glb` previews the LOD. |
| `tools/` | GLTFLoader contract check (`verify.html`) and headless capture script (`shoot.mjs`). |

## Runtime contract (three r160 GLTFLoader: ok=true, problems=0)
Unique nodes `asset_root > body > leg_l, leg_r, arm_l, arm_r > weapon > socket_muzzle`, `body > socket_ability`; every node has `extras.role` = its name; rest rotations 0, scales +1, pose baked into meshes. Legs pivot at the hips, arms at the shoulders, weapon under `arm_r`.
glTF Y up, −Z forward, origin at ground centre, height **2.203**. No cameras/lights/skins/animations, no negative scales, 1 PBR material.
asset_root extras: `character_name: "Tynor"`, `manifest_key: "marineHero_tynor"`, `two_handed: true`, `grip_l_gltf` (left-hand foregrip point, glTF coords), `two_hand_note`.
Sockets (glTF world): muzzle [-0.558, 1.189, -1.403], ability [0, 2, -0.3].

| | Full | LOD1 (Low preset) |
|---|---|---|
| Triangles | 49,201 (body 30,254, legs 3,101/3,147, arms 3,994/3,905, weapon 4,800) | ~15,000 |
| Materials | 1 | 1 |
| Textures | 2× 2048² (33.5 MB decoded) | 2× 1024² |

Budget per Alex (t1618u–t1620u): heroes are built at full detail (up to ~50k tris, 2048² textures) by default; the LOD1 file maps to the **Low** graphics preset only.

## Weapon / grip (two-handed low-ready, re-posed per Alex t1622u/t1623u)
The railgun is held two-handed: right hand on the pistol grip at chest height, left arm bent with the hand on the handguard, barrel angled forward (−Z) and turned across the body (yaw 40°, pitch 5° down), stock tucked toward the right shoulder. The pose is baked into the meshes: all pivot rest rotations are still 0, the weapon node still sits under `arm_r`.
Measured (Blender, Z-up): grip [0.2, 0.5, 1.15], foregrip [0.063, 0.663, 1.177], muzzle [-0.558, 1.403, 1.189]; reach ratios R 0.885 / L 1.135.

**Game requirement:** `asset_root.userData.two_handed === true`. The game must drive **arm_l and arm_r with the same rotation** (same `rotation.x`; the existing two-hand fix) for idle/walk/attack/cast. Driving the arms independently (opposite walk swing) pulls the left hand off the handguard. The preview's `fix=1` mode does exactly this; the Three.js walk/recoil/cast frames in `screenshots/threejs/anim_*_fix_*` show the left-hand gap (probe on `grip_l_gltf`) staying at 0.0 cm.
Compromise: the TRELLIS arms are short for the wide pauldrons, so the left forearm is stretched slightly (~14 cm) to reach the handguard and the rifle is angled across the chest rather than straight ahead. The one-hand originals (GLB, LOD, .blend, build report) are backed up in `onehand/` next to this README on the Alienware.

## Notes
- Hero role/abilities not assigned (character model only); manifest key is a suggestion.
- Re-pose cleanup removed TRELLIS floor-skirt fragments around the boots.
- Fine paint speckle on large flat plates at close range (TRELLIS vertex colour); not visible at RTS distance.
