// CC0 3D assets (KayKit Dungeon Remastered, kaylousberg.com) loaded at startup.
// Everything degrades gracefully: if a GLB fails to load, callers fall back to
// the procedural meshes, so the game always runs.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const TEMPLATES = {};

const MANIFEST = {
  wall: 'assets/wall.glb',
  wallCracked: 'assets/wall_cracked.glb',
  torch: 'assets/torch.glb',
  banner: 'assets/banner_red.glb',
  crates: 'assets/crates_stacked.glb',
  boxes: 'assets/box_stacked.glb',
  barrel: 'assets/barrel.glb',
  chest: 'assets/chest_gold.glb',
  pillar: 'assets/pillar.glb',
  heroScott: 'assets/art-slice/hero_scott.glb',
  humanRifleman: 'assets/art-slice/human_rifleman.glb',
  hiveDrone: 'assets/art-slice/hive_drone.glb',
  humanHqT1: 'assets/art-slice/human_hq_t1.glb',
  humanHqT2: 'assets/art-slice/human_hq_t2.glb',
  humanHqT3: 'assets/art-slice/human_hq_t3.glb',
  humanTowerT1: 'assets/art-slice/human_tower_t1.glb',
  humanTowerT2: 'assets/art-slice/human_tower_t2.glb',
  humanTowerT3: 'assets/art-slice/human_tower_t3.glb',
  humanBarracksT1: 'assets/art-slice/human_barracks_t1.glb',
  humanBarracksT2: 'assets/art-slice/human_barracks_t2.glb',
  humanBarracksT3: 'assets/art-slice/human_barracks_t3.glb',
  humanMine: 'assets/art-slice/human_mine.glb',
  humanWall: 'assets/art-slice/human_wall.glb',
  humanGate: 'assets/art-slice/human_gate.glb',
};

export const ART_SLICE_KEYS = Object.freeze([
  'heroScott', 'humanRifleman', 'hiveDrone',
  'humanHqT1', 'humanHqT2', 'humanHqT3',
  'humanTowerT1', 'humanTowerT2', 'humanTowerT3',
  'humanBarracksT1', 'humanBarracksT2', 'humanBarracksT3',
  'humanMine', 'humanWall', 'humanGate',
]);

export function loadAssets() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(MANIFEST).map(async ([key, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      const authored = ART_SLICE_KEYS.includes(key);
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Keep the authored slice's metal, roughness, and emissive response.
          // Legacy KayKit props use Lambert because they are ambient set
          // dressing and can use the cheaper material path.
          if (!authored) {
            const src = o.material;
            o.material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.03,
              map: src.map || null,
              color: src.map ? new THREE.Color(0.82, 0.78, 0.72) : (src.color || new THREE.Color(0x8a8478)),
            });
          }
        }
      });
      // Normalize: sit on y=0, remember footprint for scaling at clone time.
      const box = new THREE.Box3().setFromObject(root);
      root.position.y -= box.min.y;
      const holder = new THREE.Group();
      holder.add(root);
      holder.userData.size = box.getSize(new THREE.Vector3());
      TEMPLATES[key] = holder;
    } catch (e) {
      // Asset missing/unloadable — procedural fallback will be used.
    }
  }));
}

// Clone an asset scaled so its horizontal footprint fits `fit` world units
// (uniform scale). Returns a fresh Group positioned with base at y=0.
export function assetClone(key, fit) {
  const t = TEMPLATES[key];
  if (!t) return null;
  const g = t.clone(true);
  // Runtime unit meshes are disposed when they leave the battlefield. Clone
  // GPU resources so disposing one live instance cannot invalidate the cached
  // template or another instance.
  g.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry = o.geometry.clone();
    if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
    else if (o.material) o.material = o.material.clone();
  });
  if (fit) {
    const s = t.userData.size;
    const scale = fit / Math.max(s.x, s.z);
    g.scale.setScalar(scale);
  }
  return g;
}

export function assetPart(root, name) {
  let found = null;
  root?.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}
