// Kenney Fantasy Town Kit (CC0). Keeps and houses are kitbashed in
// tools/blender/build_keeps.py. Loose props dress the founded town.
// Presentation only: nothing here writes a tile or touches the sim.
import * as THREE from 'three';
import { TILE } from './config.js';
import { makeRNG } from './utils.js';
import { rimRadius } from './site-plan.js';

const TEMPLATES = new Map();

export const TOWN_PROPS = Object.freeze([
  'fence', 'fence-gate', 'hedge', 'stall', 'stall-red', 'lantern', 'tree', 'cart', 'banner-red', 'rock-small',
]);

export const KEEP_FILES = Object.freeze([
  'european-keep', 'european-house',
  'asian-keep', 'asian-house',
  'south_american-keep', 'south_american-house',
  'middle_eastern-keep', 'middle_eastern-house',
]);

function adopt(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const src = obj.material;
    const map = src?.map || null;
    obj.material = new THREE.MeshLambertMaterial({
      map,
      color: map ? 0xffffff : (src?.color || new THREE.Color(0xffffff)),
      flatShading: true,
    });
    if (obj.geometry) obj.geometry.userData.kitShared = true;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  return scene;
}

export function loadTownFile(loader, url, name) {
  return loader.loadAsync(url).then((gltf) => {
    TEMPLATES.set(name, adopt(gltf.scene));
  }).catch(() => null);
}

export function cloneTown(name) {
  const template = TEMPLATES.get(name);
  if (!template) return null;
  const group = template.clone(true);
  group.traverse((obj) => {
    if (obj.isMesh && obj.material) obj.material = obj.material.clone();
  });
  group.userData.pack = true;
  return group;
}

function blocked(plots, x, z) {
  for (const plot of plots) {
    if (plot.kind === 'wall') {
      for (const [tx, tz] of plot.tiles || []) {
        if (Math.abs(x - (tx + 0.5)) < 1.15 && Math.abs(z - (tz + 0.5)) < 1.15) return true;
      }
      continue;
    }
    const size = plot.size || 2;
    if (x > plot.x - 0.7 && x < plot.x + size + 0.7 && z > plot.z - 0.7 && z < plot.z + size + 0.7) return true;
  }
  return false;
}

// Props cluster along the street and around the courtyard. Build plots stay clear.
export function buildTownLife(map, plots) {
  if (!TEMPLATES.has('tree') || !plots?.length) return null;
  const hq = plots.find((plot) => plot.kind === 'hq');
  if (!hq) return null;
  const site = (map.sites || []).find((entry) => Math.hypot(entry.x - hq.cx, entry.z - hq.cz) < 8) || map.sites?.[0];
  if (!site) return null;
  const facing = site.rim?.facing || 0;
  let reach = 14;
  if (site.rim) {
    for (let i = 0; i < 12; i++) reach = Math.max(reach, rimRadius(site.rim, (i / 12) * Math.PI * 2));
  }
  const rng = makeRNG(((map.seed | 0) * 17 + 5) >>> 0 || 1);
  const group = new THREE.Group();
  group.name = 'town-life';
  const kinds = ['tree', 'hedge', 'stall', 'fence', 'lantern', 'tree', 'stall-red', 'cart', 'fence-gate', 'rock-small'];
  let placed = 0;
  for (let n = 0; n < 80 && placed < 26; n++) {
    const along = 4 + rng() * Math.max(6, reach * 0.62);
    const side = (rng() - 0.5) * reach * 0.85;
    const ang = facing + (rng() - 0.5) * 0.9;
    const x = site.x + Math.cos(ang) * along + Math.cos(ang + Math.PI / 2) * side;
    const z = site.z + Math.sin(ang) * along + Math.sin(ang + Math.PI / 2) * side;
    if (Math.hypot(x - hq.cx, z - hq.cz) < 4.2) continue;
    if (!map.inBounds(x | 0, z | 0)) continue;
    const tile = map.tiles[map.idx(x | 0, z | 0)];
    if (tile !== TILE.GRASS && tile !== TILE.SAND) continue;
    if (blocked(plots, x, z)) continue;
    const name = kinds[placed % kinds.length];
    const mesh = cloneTown(name);
    if (!mesh) continue;
    const s = name.startsWith('tree') ? 1.35 + rng() * 0.4 : name === 'cart' ? 0.85 : 0.7 + rng() * 0.25;
    mesh.scale.setScalar(s);
    mesh.position.set(x, map.groundY(x, z), z);
    mesh.rotation.y = rng() * Math.PI * 2;
    group.add(mesh);
    placed++;
  }
  return placed ? group : null;
}
