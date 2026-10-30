// Kenney CC0 prop pack. Presentation only.
//
// GLBs under assets/props/kenney are ground-centered and untextured. This
// module remembers one shared geometry per material role (foliage, wood,
// stone, accent, body). Headless checks never load them; callers keep the
// procedural meshes until ingestProp runs in the browser.
import * as THREE from 'three';

const PARTS = new Map();

export const PROP_FILES = Object.freeze([
  'tree_cone', 'tree_fat', 'tree_oak', 'plant_bush',
  'rock_largeA', 'rock_largeC', 'rock_smallA',
  'cliff_block_stone', 'cliff_large_stone',
  'grass', 'flower_yellowA', 'fence_simple', 'log', 'log_stack',
  'wall', 'wall-corner', 'wall-doorway', 'wall-narrow-wood', 'gate',
  'tower-square', 'tower-square-base', 'tower-square-mid-windows',
  'tower-square-roof', 'tower-square-top-roof',
  'tower-hexagon-base', 'tower-hexagon-roof',
  'flag-banner-short', 'stairs-stone',
]);

export function propUrl(name) {
  return `assets/props/kenney/${name}.glb`;
}

export function propRecord(name) {
  return PARTS.get(name) || null;
}

export function propGeometry(name, role = 'body') {
  const rec = PARTS.get(name);
  if (!rec) return null;
  const part = rec.parts.find((p) => p.role === role) || (role === 'body' ? rec.parts[0] : null);
  return part ? part.geometry : null;
}

// Bake node transforms into shared geometries and record height and footprint.
export function ingestProp(name, scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.userData.kitShared = true;
    geo.computeBoundingBox();
    box.union(tmp.copy(geo.boundingBox));
    const role = String(o.userData.name || o.name || 'body').replace(/_\d+$/, '');
    parts.push({ role, geometry: geo });
  });
  if (!parts.length) return null;
  const height = Math.max(0.001, box.max.y - box.min.y);
  const span = Math.max(0.001, box.max.x - box.min.x, box.max.z - box.min.z);
  const rec = { parts, height, span };
  PARTS.set(name, rec);
  return rec;
}
