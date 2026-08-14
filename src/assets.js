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
};

export function loadAssets() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(MANIFEST).map(async ([key, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Swap PBR for Lambert (cheaper) and dim toward the grimdark palette.
          const src = o.material;
          o.material = new THREE.MeshLambertMaterial({
            map: src.map || null,
            color: src.map ? new THREE.Color(0.82, 0.78, 0.72) : (src.color || new THREE.Color(0x8a8478)),
          });
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

export function hasAsset(key) { return !!TEMPLATES[key]; }

// Clone an asset scaled so its horizontal footprint fits `fit` world units
// (uniform scale). Returns a fresh Group positioned with base at y=0.
export function assetClone(key, fit) {
  const t = TEMPLATES[key];
  if (!t) return null;
  const g = t.clone(true);
  if (fit) {
    const s = t.userData.size;
    const scale = fit / Math.max(s.x, s.z);
    g.scale.setScalar(scale);
  }
  return g;
}
