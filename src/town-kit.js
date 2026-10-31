// Kenney Fantasy Town Kit (CC0). Keeps and houses are kitbashed in
// tools/blender/build_keeps.py. Loose props dress the founded town.
// Presentation only: nothing here writes a tile or touches the sim.
import * as THREE from 'three';
import { TILE } from './config.js';
import { makeRNG } from './utils.js';
import { rimForm, rimRadius } from './site-plan.js';
import { activeCulture } from './cultures.js';

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

// Quaternius cottages plus an original haystack and well. See
// tools/blender/build_village.py.
export const VILLAGE_FILES = Object.freeze([
  'cottage-plaster', 'cottage-brick', 'cottage-timber', 'hay', 'well',
]);

function adopt(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const map = src?.map || null;
    if (map) {
      map.userData = map.userData || {};
      map.userData.kitShared = true;
    }
    const colored = !map && !!obj.geometry?.getAttribute?.('color');
    obj.material = new THREE.MeshLambertMaterial({
      map,
      color: map ? 0xffffff : (src?.color || new THREE.Color(0xffffff)),
      vertexColors: colored,
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

function blocked(plots, x, z, pad = 1.2) {
  for (const plot of plots) {
    if (plot.kind === 'wall') {
      for (const [tx, tz] of plot.tiles || []) {
        if (Math.abs(x - (tx + 0.5)) < 1.35 && Math.abs(z - (tz + 0.5)) < 1.35) return true;
      }
      continue;
    }
    const size = plot.size || 2;
    if (x > plot.x - pad && x < plot.x + size + pad && z > plot.z - pad && z < plot.z + size + pad) return true;
  }
  return false;
}

// The centre of a build pad stays empty so the footprint still reads.
function padHeart(plots, x, z) {
  for (const plot of plots) {
    if (plot.kind === 'wall' || plot.kind === 'hq') continue;
    const size = plot.size || 2;
    const cx = plot.x + size / 2;
    const cz = plot.z + size / 2;
    if (Math.abs(x - cx) < size * 0.42 && Math.abs(z - cz) < size * 0.42) return true;
  }
  return false;
}

function put(group, name, x, y, z, scale, yaw) {
  const mesh = cloneTown(name);
  if (!mesh) return false;
  mesh.scale.setScalar(scale);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  group.add(mesh);
  return true;
}

// Four neighbourhoods inside the walls: both sides of the street, and both
// sides of the court behind the keep. Houses come from the culture kit and
// the Quaternius cottages. Plots, the street and the gate mouths stay clear.
export function buildTownLife(map, plots) {
  const note = (debug) => {
    if (typeof window !== 'undefined') window.__townDebug = debug;
    return null;
  };
  if (!plots?.length) return note({ why: 'no-plots' });
  if (!TEMPLATES.has('tree') && !TEMPLATES.has(`${activeCulture()}-house`)) return note({ why: 'no-templates', keys: [...TEMPLATES.keys()] });
  const hq = plots.find((plot) => plot.kind === 'hq');
  if (!hq) return null;
  const site = (map.sites || []).find((entry) => Math.hypot(entry.x - hq.cx, entry.z - hq.cz) < 8) || map.sites?.[0];
  if (!site) return null;
  const facing = site.rim?.facing || 0;
  const ux = Math.cos(facing);
  const uz = Math.sin(facing);
  const px = -uz;
  const pz = ux;
  let reach = 14;
  if (site.rim) {
    for (let i = 0; i < 16; i++) reach = Math.max(reach, rimRadius(site.rim, (i / 16) * Math.PI * 2));
  }
  const gates = [];
  const form = site.rim ? rimForm(site.rim) : null;
  for (const g of form?.gates || []) {
    const ang = g + facing;
    const r = rimRadius(site.rim, g);
    gates.push([site.x + Math.cos(ang) * r, site.z + Math.sin(ang) * r]);
  }
  const culture = activeCulture();
  const houses = [`${culture}-house`, 'cottage-plaster', 'cottage-brick', `${culture}-house`, 'cottage-timber'];
  const rng = makeRNG(((map.seed | 0) * 17 + 5) >>> 0 || 1);
  const group = new THREE.Group();
  group.name = 'town-life';
  const taken = [];

  const inside = (x, z, margin) => {
    const dx = x - site.x;
    const dz = z - site.z;
    const ang = Math.atan2(dz, dx) - facing;
    const r = site.rim ? rimRadius(site.rim, ang) : reach;
    return Math.hypot(dx, dz) < r - margin;
  };
  const onStreet = (x, z) => {
    const dx = x - site.x;
    const dz = z - site.z;
    if (Math.hypot(dx, dz) < 5.6) return true;
    const along = dx * ux + dz * uz;
    const side = dx * px + dz * pz;
    return Math.abs(side) < 2.6 && along > -reach && along < reach;
  };
  const nearGate = (x, z) => gates.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 3.6);
  const ground = (x, z) => {
    if (!map.inBounds(x | 0, z | 0)) return false;
    const tile = map.tiles[map.idx(x | 0, z | 0)];
    return tile === TILE.GRASS || tile === TILE.SAND;
  };
  const crowded = (x, z, gap) => taken.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < gap);

  const limit = Math.max(reach * 0.82, 8);
  const candidates = [];
  for (let along = -limit; along <= limit; along += 1.15) {
    for (let side = -limit; side <= limit; side += 1.15) {
      if (Math.abs(side) < 2.9) continue;
      const x = site.x + ux * along + px * side;
      const z = site.z + uz * along + pz * side;
      if (!ground(x, z) || !inside(x, z, 2.1) || onStreet(x, z) || nearGate(x, z)) continue;
      if (blocked(plots, x, z, 0.7)) continue;
      candidates.push({ x, z, along, side });
    }
  }
  // Four neighbourhoods, grown from a seed in each quadrant so the houses
  // sit in clusters instead of a ring of lone cottages.
  const seeds = [
    [limit * 0.42, limit * 0.48],
    [limit * 0.36, -limit * 0.5],
    [-limit * 0.4, limit * 0.42],
    [-limit * 0.22, -limit * 0.55],
  ];
  let placed = 0;
  const yards = ['fence', 'hedge', 'tree', 'hay', 'fence', 'tree', 'hedge', 'lantern'];
  for (const [sa, ss] of seeds) {
    const near = candidates
      .map((c) => ({ ...c, d: Math.hypot(c.along - sa, c.side - ss) }))
      .filter((c) => c.d < 7.2)
      .sort((a, b) => a.d - b.d);
    let count = 0;
    let well = false;
    const members = [];
    for (const c of near) {
      if (count >= 9 || placed >= 40) break;
      if (crowded(c.x, c.z, 2.05)) continue;
      const name = houses[placed % houses.length];
      const meshName = TEMPLATES.has(name) ? name : `${culture}-house`;
      if (!TEMPLATES.has(meshName)) continue;
      const face = Math.atan2(-Math.sign(c.side || ss) * px, -Math.sign(c.side || ss) * pz);
      if (!put(group, meshName, c.x, map.groundY(c.x, c.z), c.z, 2.2 + rng() * 0.18, face + (rng() - 0.5) * 0.2)) continue;
      taken.push([c.x, c.z]);
      members.push(c);
      placed++;
      count++;
      if (!well && count === 2) {
        const wx = c.x + px * 1.3;
        const wz = c.z + pz * 1.3;
        if (ground(wx, wz) && !blocked(plots, wx, wz, 0.3) && !onStreet(wx, wz) && !crowded(wx, wz, 1.1)) {
          if (put(group, 'well', wx, map.groundY(wx, wz), wz, 1.15, facing)) {
            taken.push([wx, wz]);
            well = true;
          }
        }
      }
      for (let k = 0; k < 2; k++) {
        const ang = rng() * Math.PI * 2;
        const dist = 1.15 + rng() * 0.45;
        const yx = c.x + Math.cos(ang) * dist;
        const yz = c.z + Math.sin(ang) * dist;
        if (!ground(yx, yz) || onStreet(yx, yz) || blocked(plots, yx, yz, 0.25) || crowded(yx, yz, 0.85)) continue;
        const yard = yards[(placed + k) % yards.length];
        const ys = yard === 'tree' ? 1.55 : yard === 'hay' ? 1.25 : 0.78;
        if (put(group, yard, yx, map.groundY(yx, yz), yz, ys, rng() * Math.PI * 2)) taken.push([yx, yz]);
      }
    }
    if (members.length < 3) continue;
    let a0 = Infinity, a1 = -Infinity, s0 = Infinity, s1 = -Infinity;
    for (const c of members) {
      a0 = Math.min(a0, c.along); a1 = Math.max(a1, c.along);
      s0 = Math.min(s0, c.side); s1 = Math.max(s1, c.side);
    }
    a0 -= 1.4; a1 += 1.4; s0 -= 1.4; s1 += 1.4;
    const edge = (along, side, yaw) => {
      const x = site.x + ux * along + px * side;
      const z = site.z + uz * along + pz * side;
      if (!ground(x, z) || onStreet(x, z) || nearGate(x, z) || blocked(plots, x, z, 0.15)) return;
      if (crowded(x, z, 0.7)) return;
      const piece = (Math.round(along + side) & 1) ? 'fence' : 'hedge';
      if (put(group, piece, x, map.groundY(x, z), z, piece === 'fence' ? 1.55 : 1.25, yaw)) taken.push([x, z]);
    };
    for (let along = a0; along <= a1; along += 1.35) {
      edge(along, s0, facing);
      edge(along, s1, facing);
    }
    for (let side = s0; side <= s1; side += 1.35) {
      edge(a0, side, facing + Math.PI / 2);
      edge(a1, side, facing + Math.PI / 2);
    }
    // Gardens fill the block. The middle of a build pad stays clear.
    const garden = ['tree', 'hedge', 'hay', 'tree', 'hedge'];
    let g = 0;
    for (let along = a0 + 0.6; along <= a1 - 0.4; along += 1.9) {
      for (let side = s0 + 0.6; side <= s1 - 0.4; side += 1.9) {
        const x = site.x + ux * along + px * side;
        const z = site.z + uz * along + pz * side;
        if (!ground(x, z) || onStreet(x, z) || nearGate(x, z) || crowded(x, z, 1.15)) continue;
        if (padHeart(plots, x, z)) continue;
        const name = garden[g % garden.length];
        g++;
        const s = name === 'tree' ? 1.7 : name === 'hay' ? 1.2 : 1.05;
        if (put(group, name, x, map.groundY(x, z), z, s, rng() * Math.PI * 2)) taken.push([x, z]);
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.__townDebug = {
      placed,
      children: group.children.length,
      candidates: candidates.length,
      reach,
    };
  }
  return group.children.length ? group : null;
}
