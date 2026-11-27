# Rykus — Zillions Sniper hero (v3, TRELLIS pipeline)

Character: **Rykus**, the grizzled veteran marksman with the cigar (concept B3). Role: Sniper.
Asset: `hero_sniper.glb`, manifest key `marineHero_sniper`, integration target `assets/art-marines/hero_sniper.glb` (not copied into the repo; nothing deployed).
v1 and v2 remain untouched in the parent folder (`../`, `../v1/`, `../hero_sniper_v2_package.zip`).

## Files
| File | What |
|---|---|
| `hero_sniper.glb` | Full-detail hero (default for all graphics presets except Low). 48,743 tris, 10.4 MB, embedded textures. |
| `hero_sniper_lod1.glb` | Light copy for the **Low** graphics preset (video options). ~15k tris, 1024² textures, same nodes/roles/extras (+ `lod: 1`, `graphics_preset: "Low"` on asset_root). |
| `sniper_space_marine.blend` | Blender 5.2 source: high-poly TRELLIS sources (SRC collection) + game meshes/pivots (GAME collection). |
| `textures/T_rykus_albedo.jpg` | 2048² albedo with painted lighting (AO x top light x edge highlight) so the game's Lambert path looks right. |
| `textures/T_rykus_normal.png` | 2048² tangent-space normal (glTF normal scale 0.7). |
| `build_report.json` | Measured build numbers. |
| `screenshots/` | Blender Eevee renders of the exported GLB (`rykus_*`), LOD1 renders (`rykus_lod1_*`), silhouettes, and Three.js captures (`threejs/`, sheets `rykus_threejs_sheet.jpg`, `rykus_anim_sheet.jpg`). |
| `preview/index.html` | Three.js r160 preview of the actual GLB: in-game Lambert, PBR, silhouette; idle / walk(run) / attack(recoil) / cast. `?glb=../hero_sniper_lod1.glb` previews the LOD. |
| `tools/verify.html`, `tools/shoot.mjs` | GLTFLoader contract check + headless captures. |
| `source/` | Pipeline scripts (TRELLIS workflow, build, remesh/decimate, UV, LOD, review). |

## Runtime contract (verified with three r160 GLTFLoader: ok, 0 problems)
Nodes (unique): `asset_root > body > leg_l, leg_r, arm_l, arm_r > weapon > socket_muzzle`, `body > socket_ability`. Every node has `extras.role` = its name; all rest rotations 0, scales +1, pose baked into meshes.
Legs pivot at hips (±0.20, 0.72), arms at shoulders (±0.50, 1.45), rifle under `arm_r`. asset_root extras: `two_handed: true`, `grip_l_gltf` (left-hand foregrip point, glTF coords), `two_hand_note`.
glTF: Y up, −Z forward, origin at ground centre, height **2.204**. No cameras, lights, skins or animations; no negative scales. 1 material (`M_Rykus`, Principled/PBR).
Sockets (glTF world): muzzle (-0.734, 1.239, -1.334) at the railgun tip, ability (0.12, 1.80, −0.30) above the right shoulder.

### Budget (measured)
| | Full | LOD1 (Low preset) |
|---|---|---|
| Triangles | 48,743 (body 29,772, legs 3,155/3,300, arms 3,789/3,927, railgun 4,800) | 14,995 |
| Materials | 1 | 1 |
| Textures | 2× 2048² (33.5 MB decoded RGBA, ~44.7 MB with mips) | 2× 1024² (~8.4 MB decoded) |
| GLB | 10.4 MB | 5.0 MB |

Budget per Alex (t1618u/t1619u): heroes up to ~50k triangles and 2048² textures on desktop/gaming laptops; the LOD1 file maps to the **Low** graphics preset only. This supersedes the original ≤8k / ≤4 MB targets.

## Grip: two-handed low-ready (re-posed per Alex t1622u/t1623u)
Rykus now holds the railgun **two-handed**: right hand on the pistol grip at chest height, left arm bent with the hand on the handguard, barrel forward (−Z) and turned across the body (yaw 45°, 5° down), stock toward the right shoulder. The pose is baked into the meshes; every pivot rest rotation is still 0 and the weapon node is still under `arm_r`.
Measured (Blender Z-up): grip [0.1, 0.5, 1.2], foregrip [-0.051, 0.651, 1.227], muzzle [-0.734, 1.334, 1.239]; reach ratio R 0.922 / L 1.103.

**Game requirement:** `asset_root.userData.two_handed === true`, so the game must drive **arm_l and arm_r with the same rotation** (same `rotation.x`, the existing two-hand fix) in idle, walk, attack and cast. With that, the left-hand gap stays at 0.0 cm in every captured frame (`screenshots/rykus_anim_twohand_sheet.jpg`, `threejs/anim_*_fix_*`). Driving the arms independently, as the current `main.js` does for one-hand heroes, pulls the left hand up to ~40 cm off the gun during walk (`rykus_anim_sheet.jpg`, `anim_*_runtime_*`). For a long rifle, the gentle shared swing from the v2 README (`x = stride*0.12 + recoil*0.30 − windup*0.06 − cast*0.35`) on both arms is still recommended. The game repo was not touched.
Compromise: the TRELLIS arms are short for the wide pauldrons, so the left forearm is stretched about 10 cm to reach the handguard and the rifle angles across the chest instead of pointing straight ahead. Re-pose script: `source/repose.py` (config `pose2h`). The one-hand originals (GLB, LOD, .blend, build report) are backed up in `onehand/` next to this README on the Alienware.

## Pipeline
Concept (B3) → TRELLIS.2 int8 at 1024 in ComfyUI v0.46.0 core, offline, on the Alienware (7.1M-face painted mesh; railgun separately) → Blender 5.2: normalise to 2.2 units, paint material (vertex colour × AO × top light × edge gain) → ComfyUI core narrow-band dual-contouring remesh (`solid`, 512³, removes TRELLIS double shells) → split into body/limb groups → GPU QEM decimation per group (body 30k, legs 3.2k, arms 3.8k, railgun 4.8k) → ComfyUI core `pec` UV unwrap (≈54% atlas fill) → Cycles OptiX bake of albedo + normal at 2048² → split, cap cut openings, pivots/sockets, export → LOD1 by collapse-decimating the clean game meshes to 15k with 1024² textures.

## Known defects / notes
- Re-pose cleanup removed TRELLIS floor-skirt fragments around the boots and below the old hand position.
- Texture shows fine speckle on large flat plates at close range (from TRELLIS vertex colour + DC remesh); invisible at the RTS camera.
- Lowest vertex is −0.002 (caps on the leg cut sit 2 mm below y=0); verify's strict 1 mm "feet_on_ground" flag reads false. Harmless; can be snapped if the game cares.
- Material appears twice in GLTFLoader (same `M_Rykus`, split by primitive attributes); still one material in the file.
