// Border forest, culture props and the small landmarks that make each
// campaign map read as a place. Presentation only: seeded from the map seed,
// never from the simulation random source, and nothing here writes a tile.
import * as THREE from 'three';
import { TILE } from './config.js';
import { makeRNG } from './utils.js';
import { activeCulture } from './cultures.js';
import { angDiff, rimForm, rimRadius } from './site-plan.js';

function pal(map) {
  return (map.theme && map.theme.palette) || {};
}

function wallR(site) {
  if (!site.rim) return 16;
  let m = 0;
  for (let i = 0; i < 16; i++) m = Math.max(m, rimRadius(site.rim, (i / 16) * Math.PI * 2));
  return m;
}

function instanced(geo, mat, items, tint) {
  if (!items.length) return null;
  if (tint) mat.vertexColors = true;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.userData.noOutline = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    s.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1);
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (tint) {
      c.setHex(it.color || tint);
      mesh.setColorAt(i, c);
    }
  });
  if (tint) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function add(group, mesh) {
  if (mesh) group.add(mesh);
}

// A worn quad lying on the ground. Used for fields, ice, and the river ribbon.
function groundQuad(w, d) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildLandDressing(map) {
  const group = new THREE.Group();
  group.name = 'land-dressing';
  const N = map.size;
  const rng = makeRNG(((map.seed | 0) * 91 + 17) >>> 0);
  const P = pal(map);
  const pineTop = P.canopy ?? 0x9ad35a;
  const pineDark = P.forest ?? 0x2e6a4e;
  const rockC = P.mountain ?? 0xe3dcc2;
  const shadow = P.shadow ?? 0x1d3a5a;
  const waterC = P.water ?? 0x3fa9e0;
  const foam = P.foam ?? 0xe8f6ff;
  const pathC = P.path ?? 0xb07a4f;
  const grass = P.grass ?? 0x2f7d66;
  const city = map.theme && map.theme.city;
  const culture = activeCulture();
  const yAt = (x, z, lift = 0) => map.groundY(x, z) + lift;

  const nearSite = (x, z, r) => (map.sites || []).some((s) => Math.hypot(x - s.x, z - s.z) < r);
  const road = new Uint8Array(N * N);
  for (const r of map.roadPaths || []) {
    for (const [x, z] of r.pts || []) {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const tx = (x | 0) + dx, tz = (z | 0) + dz;
        if (map.inBounds(tx, tz)) road[tz * N + tx] = 1;
      }
    }
  }
  const blocked = (x, z, pad = 4) => {
    const tx = x | 0, tz = z | 0;
    if (!map.inBounds(tx, tz)) return true;
    if (road[tz * N + tx]) return true;
    return nearSite(x, z, pad);
  };

  const pines = [], trunks = [], rocks = [], crystals = [], pylons = [], pylonCaps = [];
  const band = N * 0.25;
  // Outer quarter: clumps of pines and faceted blocks. The inner floor stays
  // almost empty so the battle reads.
  for (let z = 2; z < N - 2; z += 3) {
    for (let x = 2; x < N - 2; x += 3) {
      const edge = Math.min(x, z, N - 1 - x, N - 1 - z);
      if (edge > band) continue;
      const t = map.tiles[map.idx(x, z)];
      if (t === TILE.WATER) continue;
      if (nearSite(x, z, 18)) continue;
      if (rng() > 0.72) continue;
      const clump = 8 + Math.floor(rng() * 10);
      const spread = 2.2 + rng() * 2.4;
      for (let k = 0; k < clump; k++) {
        if (pines.length > 1500) break;
        const px = x + (rng() - 0.5) * spread * 2;
        const pz = z + (rng() - 0.5) * spread * 2;
        if (!map.inBounds(px | 0, pz | 0)) continue;
        const tt = map.tiles[map.idx(px | 0, pz | 0)];
        if (tt === TILE.WATER) continue;
        const s = 0.85 + rng() * 1.35;
        const py = yAt(px, pz);
        pines.push({ x: px, y: py + s * 1.15, z: pz, s, ry: rng() * 6.28, color: rng() < 0.5 ? pineTop : pineDark });
        trunks.push({ x: px, y: py + s * 0.35, z: pz, sx: 0.18 * s, sy: 0.7 * s, sz: 0.18 * s, color: shadow });
      }
      if (rocks.length < 420 && rng() < 0.55) {
        const h = 3 + rng() * 7;
        const px = x + rng() * 2, pz = z + rng() * 2;
        rocks.push({
          x: px, y: yAt(px, pz) + h * 0.45, z: pz,
          sx: 1.4 + rng() * 2.2, sy: h, sz: 1.2 + rng() * 2.4,
          ry: rng() * 3, rx: (rng() - 0.5) * 0.15, color: rng() < 0.3 ? shadow : rockC,
        });
      }
    }
  }

  // A few crystals and pylons — the sci-fi note, kept off the battle floor.
  for (let n = 0; n < 36 && crystals.length < 36; n++) {
    const x = 4 + rng() * (N - 8), z = 4 + rng() * (N - 8);
    if (Math.min(x, z, N - x, N - z) > band + 8 && rng() < 0.7) continue;
    if (blocked(x, z, 14)) continue;
    const tt = map.tiles[map.idx(x | 0, z | 0)];
    if (tt === TILE.WATER) continue;
    const s = 0.5 + rng() * 1.1;
    crystals.push({ x, y: yAt(x, z) + s * 0.7, z, s, ry: rng() * 6, color: city === 'outpost' ? 0xffb15a : 0x9af6ff });
  }
  for (let n = 0; n < 18; n++) {
    const x = 6 + rng() * (N - 12), z = 6 + rng() * (N - 12);
    if (Math.min(x, z, N - x, N - z) < 8) continue;
    if (blocked(x, z, 16)) continue;
    if (map.tiles[map.idx(x | 0, z | 0)] === TILE.WATER) continue;
    const h = 3.2 + rng() * 2.4;
    pylons.push({ x, y: yAt(x, z) + h * 0.5, z, sx: 0.18, sy: h, sz: 0.18, color: shadow });
    pylonCaps.push({ x, y: yAt(x, z) + h + 0.25, z, s: 0.38, color: 0x8ff3ff });
  }

  // Play floor: a handful of single trees and rock pairs, clear of the sites.
  for (let n = 0; n < 70; n++) {
    const x = 8 + rng() * (N - 16), z = 8 + rng() * (N - 16);
    if (Math.min(x, z, N - x, N - z) < band * 0.7) continue;
    if (blocked(x, z, 10)) continue;
    const tt = map.tiles[map.idx(x | 0, z | 0)];
    if (tt !== TILE.GRASS && tt !== TILE.SAND) continue;
    const s = 0.7 + rng() * 0.5;
    pines.push({ x, y: yAt(x, z) + s * 1.15, z, s: s * 0.85, ry: rng() * 6, color: pineDark });
    trunks.push({ x, y: yAt(x, z) + s * 0.3, z, sx: 0.14, sy: 0.5, sz: 0.14, color: shadow });
    if (rng() < 0.4) {
      rocks.push({
        x: x + 0.8, y: yAt(x + 0.8, z) + 0.35, z,
        sx: 0.6, sy: 0.5, sz: 0.5, ry: rng() * 3, color: rockC,
      });
    }
  }

  const fields = [], crops = [], reeds = [], graves = [], bastions = [], river = [];
  const palmTrunks = [], palmCrowns = [], pools = [], ice = [], plinths = [];

  for (const site of map.sites || []) {
    const wr = wallR(site);
    const facing = site.rim ? site.rim.facing : 0;
    const key = site.rim ? site.rim.key : city;
    const form = site.rim ? rimForm(site.rim) : null;
    const gateAngles = form && form.gates ? form.gates : [];
    // A pine belt just outside the walls. The camera sits on the base, so this
    // is the frame the player actually sees — the map-edge forest is the horizon.
    for (let n = 0; n < 80; n++) {
      const a = rng() * Math.PI * 2;
      const local = a - facing;
      if (gateAngles.some((g) => angDiff(local, g) < 0.5)) continue;
      const d = wr + 2.5 + rng() * 11;
      const x = site.x + Math.cos(a) * d;
      const z = site.z + Math.sin(a) * d;
      if (!map.inBounds(x | 0, z | 0)) continue;
      const tt = map.tiles[map.idx(x | 0, z | 0)];
      if (tt === TILE.WATER || tt === TILE.PATH) continue;
      if (road[(z | 0) * N + (x | 0)]) continue;
      const s = 0.9 + rng() * 1.1;
      pines.push({ x, y: yAt(x, z) + s * 1.15, z, s, ry: rng() * 6, color: rng() < 0.45 ? pineTop : pineDark });
      trunks.push({ x, y: yAt(x, z) + s * 0.35, z, sx: 0.16 * s, sy: 0.65 * s, sz: 0.16 * s, color: shadow });
      if (rng() < 0.22 && rocks.length < 700) {
        const h = 1.4 + rng() * 2.6;
        rocks.push({ x: x + 0.6, y: yAt(x, z) + h * 0.45, z, sx: 0.9, sy: h, sz: 0.8, ry: a, color: rockC });
      }
    }

    // Fields and orchards sit outside the wall, on the low ground.
    if (culture === 'european' || key === 'bastion' || key === 'fort') {
      for (let n = 0; n < 10; n++) {
        const a = rng() * Math.PI * 2;
        const d = wr + 3 + rng() * 6;
        const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
        if (blocked(x, z, 0) && road[(z | 0) * N + (x | 0)]) continue;
        if (!map.inBounds(x | 0, z | 0)) continue;
        const tt = map.tiles[map.idx(x | 0, z | 0)];
        if (tt !== TILE.GRASS && tt !== TILE.SAND) continue;
        if (nearSite(x, z, wr * 0.8)) continue;
        fields.push({ x, y: yAt(x, z, 0.05), z, ry: a, sx: 2.1, sy: 1, sz: 1.5, color: grass });
      }
    }

    if (culture === 'south_american' || key === 'keyhole') {
      for (let ring = 0; ring < 3; ring++) {
        const d = 7 + ring * 4.2;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + ring * 0.2;
          const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
          if (!map.inBounds(x | 0, z | 0)) continue;
          const tt = map.tiles[map.idx(x | 0, z | 0)];
          if (tt !== TILE.GRASS && tt !== TILE.PATH) continue;
          crops.push({ x, y: yAt(x, z, 0.06), z, ry: a, sx: 2.4, sy: 1, sz: 0.7, color: 0xc6d86a });
        }
      }
    }

    if (key === 'crescent') {
      // Frozen moat on the open side (local angle 0 faces the war).
      const a = facing;
      const x = site.x + Math.cos(a) * (wr + 2.2);
      const z = site.z + Math.sin(a) * (wr + 2.2);
      ice.push({ x, y: yAt(x, z, 0.05), z, ry: a, sx: 8, sy: 1, sz: 2.4, color: foam });
      for (let n = 0; n < 8; n++) {
        const ga = rng() * Math.PI * 2;
        const gd = wr + 8 + rng() * 10;
        const gx = site.x + Math.cos(ga) * gd, gz = site.z + Math.sin(ga) * gd;
        if (!map.inBounds(gx | 0, gz | 0)) continue;
        if (map.tiles[map.idx(gx | 0, gz | 0)] !== TILE.GRASS) continue;
        graves.push({ x: gx, y: yAt(gx, gz) + 0.35, z: gz, sx: 1.3, sy: 0.7, sz: 1.1, ry: ga, color: rockC });
      }
    }

    if (key === 'bastion') {
      // Bright water ribbon on the woods that close the spur — the U-bend.
      const x0 = Math.round(site.x), z0 = Math.round(site.z);
      const R = Math.ceil(wr) + 4;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (river.length > 500) break;
          const x = x0 + dx, z = z0 + dz;
          if (!map.inBounds(x, z)) continue;
          if (map.tiles[map.idx(x, z)] !== TILE.FOREST) continue;
          const d = Math.hypot(x + 0.5 - site.x, z + 0.5 - site.z);
          if (d < wr * 0.7 || d > wr + 3.5) continue;
          let grassN = false;
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (map.inBounds(x + ox, z + oz) && map.tiles[map.idx(x + ox, z + oz)] === TILE.GRASS) grassN = true;
          }
          if (!grassN || rng() > 0.55) continue;
          river.push({ x: x + 0.5, y: 0.2, z: z + 0.5, sx: 1.15, sy: 1, sz: 1.15, color: waterC });
        }
      }
    }

    if (key === 'fort' || key === 'star') {
      // Star bastion tips shoved into the moat, plus reeds and dead trees.
      for (let k = 0; k < 5; k++) {
        const a = facing + (k / 5) * Math.PI * 2;
        const x = site.x + Math.cos(a) * (wr + 1.4);
        const z = site.z + Math.sin(a) * (wr + 1.4);
        bastions.push({
          x, y: yAt(x, z) + 0.55, z,
          sx: 1.6, sy: 1.1, sz: 2.8, ry: -a, color: rockC,
        });
      }
      for (let n = 0; n < 24; n++) {
        const a = rng() * Math.PI * 2;
        const d = wr + 1 + rng() * 5;
        const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
        if (!map.inBounds(x | 0, z | 0)) continue;
        const tt = map.tiles[map.idx(x | 0, z | 0)];
        if (tt === TILE.WATER && reeds.length < 200) {
          reeds.push({ x, y: yAt(x, z) + 0.45, z, sy: 0.7 + rng() * 0.6, sx: 0.08, sz: 0.08, ry: rng() * 3, color: pineDark });
        } else if (tt === TILE.GRASS && rng() < 0.35) {
          trunks.push({ x, y: yAt(x, z) + 0.7, z, sx: 0.12, sy: 1.3, sz: 0.12, color: shadow });
        }
      }
    }

    if (key === 'outpost' || culture === 'middle_eastern') {
      // Oasis / cistern on the shaded side, tucked against rock when there is any.
      let ox = site.x + 8, oz = site.z + 6;
      let found = false;
      const x0 = Math.round(site.x), z0 = Math.round(site.z);
      for (let dz = -14; dz <= 14 && !found; dz++) {
        for (let dx = 4; dx <= 16; dx++) {
          const x = x0 + dx, z = z0 + dz;
          if (!map.inBounds(x, z)) continue;
          if (map.tiles[map.idx(x, z)] !== TILE.MOUNTAIN) continue;
          ox = x - 1.2; oz = z; found = true; break;
        }
      }
      if (!found) { ox = site.x + wr + 4; oz = site.z + 2; }
      pools.push({ x: ox, y: yAt(ox, oz, 0.06), z: oz, sx: 3.2, sy: 1, sz: 2.4, color: city === 'outpost' ? 0x2a6a7a : waterC });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const x = ox + Math.cos(a) * 2.1, z = oz + Math.sin(a) * 1.6;
        palmTrunks.push({ x, y: yAt(x, z) + 1.1, z, sx: 0.16, sy: 2.2, sz: 0.16, color: 0x8a5a32 });
        palmCrowns.push({ x, y: yAt(x, z) + 2.4, z, s: 0.85, color: 0x3f8a45 });
      }
    }
  }

  const lambert = (fallback) => new THREE.MeshLambertMaterial({ color: fallback, flatShading: true });
  const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({
    color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
  });

  add(group, instanced(new THREE.ConeGeometry(0.7, 2.2, 6), lambert(0xffffff), pines, pineTop));
  add(group, instanced(new THREE.CylinderGeometry(0.12, 0.16, 1, 5), lambert(0xffffff), trunks, shadow));
  add(group, instanced(new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff), rocks, rockC));
  add(group, instanced(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), crystals, 0x9af6ff));
  add(group, instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), lambert(0xffffff), pylons, shadow));
  add(group, instanced(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), pylonCaps, 0x8ff3ff));
  add(group, instanced(groundQuad(1, 1), basic(grass, 0.92), fields, grass));
  add(group, instanced(groundQuad(1, 1), basic(0xc6d86a, 0.9), crops, 0xc6d86a));
  add(group, instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 4), lambert(0xffffff), reeds, pineDark));
  add(group, instanced(new THREE.SphereGeometry(1, 6, 4), lambert(0xffffff), graves, rockC));
  add(group, instanced(new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff), bastions, rockC));
  add(group, instanced(groundQuad(1, 1), basic(waterC, 0.88), river, waterC));
  add(group, instanced(groundQuad(1, 1), basic(waterC, 0.9), pools, waterC));
  add(group, instanced(new THREE.CylinderGeometry(0.5, 0.6, 1, 5), lambert(0xffffff), palmTrunks, 0x8a5a32));
  add(group, instanced(new THREE.SphereGeometry(0.7, 6, 5), lambert(0xffffff), palmCrowns, 0x3f8a45));
  add(group, instanced(groundQuad(1, 1), basic(foam, 0.55), ice, foam));
  add(group, instanced(new THREE.CylinderGeometry(0.5, 0.62, 0.28, 8), lambert(0xffffff), plinths, rockC));

  // Path colour is referenced so a map with no streets still compiles the
  // palette slot the roads use. Cobble itself is the founded plaza.
  group.userData.path = pathC;
  return group;
}
