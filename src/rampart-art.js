// Continuous ramparts. Presentation only.
//
// A wall plot is still one simulation tile at a time. On screen each run is
// one mesh: culture modules authored in tools/blender/build_ramparts.py are
// stamped along a smoothed polyline and sheared onto the ground, so a ring
// reads as a single wall instead of a row of blocks. Corner posts and
// gatehouses are the same kit. Unbuilt and ruined tiles stay a low footing.
// Nothing here writes tiles, occupancy, or combat state.

import * as THREE from 'three';
import { toyMat } from './toy-style.js';
import { activeCulture } from './cultures.js';

const RECS = new Map();
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const RAMPART_FILES = Object.freeze([
  'rubble',
  ...['european', 'asian', 'south_american', 'middle_eastern'].flatMap((key) => [
    `${key}-wall`, `${key}-post`, `${key}-gate`, `${key}-keep`, `${key}-house`, `${key}-spire`,
  ]),
]);

export function rampartUrl(name) {
  return `assets/ramparts/${name}.glb`;
}

export function rampartReady() {
  return RECS.has('rubble') && RECS.has(`${activeCulture()}-wall`);
}

function mergeGeometries(geos) {
  const positions = [];
  const normals = [];
  const colors = [];
  for (const src of geos) {
    const pos = src.attributes.position;
    const nrm = src.attributes.normal;
    const col = src.attributes.color;
    const index = src.index;
    const push = (i) => {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      else normals.push(0, 1, 0);
      if (col) colors.push(col.getX(i), col.getY(i), col.getZ(i));
      else colors.push(1, 1, 1);
    };
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        push(index.getX(i));
        push(index.getX(i + 1));
        push(index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) push(i), push(i + 1), push(i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.userData.kitShared = true;
  geo.computeBoundingBox();
  return geo;
}

export function ingestRampart(name, scene) {
  scene.updateMatrixWorld(true);
  const body = [];
  const glow = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    (/glow/i.test(o.name) ? glow : body).push(geo);
  });
  const rec = {
    body: body.length ? mergeGeometries(body) : null,
    glow: glow.length ? mergeGeometries(glow) : null,
  };
  for (const geo of [...body, ...glow]) geo.dispose();
  RECS.set(name, rec);
  return rec;
}

function bodyMaterial() {
  return toyMat({ color: 0xffffff, vertexColors: true, flatShading: true });
}

// A keep, house, or plot tower. The caller applies the building's visual scale.
// Geometry stays shared; materials do not, so damage tint stays per building.
export function rampartPlace(name) {
  const rec = RECS.get(name);
  if (!rec?.body) return null;
  const g = new THREE.Group();
  g.userData.pack = true;
  const body = new THREE.Mesh(rec.body, bodyMaterial());
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  if (rec.glow) {
    const glow = new THREE.Mesh(rec.glow, toyMat({
      color: 0xffd27a, emissive: 0xffd27a, emissiveIntensity: 0.7, flatShading: true,
    }));
    glow.castShadow = false;
    g.add(glow);
  }
  return g;
}

function keyOf(x, z) { return `${x},${z}`; }

function neighborsOf(tile, usable) {
  const out = [];
  for (const [dx, dz] of DIRS) {
    const next = usable.get(keyOf(tile.x + dx, tile.z + dz));
    if (next && next.built === tile.built) out.push(next);
  }
  return out;
}

// Degree-2 chains. Junctions (3+ links) become posts when the run is built.
function chainsOf(usable) {
  const link = (tile) => neighborsOf(tile, usable).length;
  const posts = [];
  for (const tile of usable.values()) {
    if (tile.built && link(tile) >= 3) posts.push(tile);
  }
  for (const tile of posts) usable.delete(keyOf(tile.x, tile.z));
  const used = new Set();
  const chains = [];
  const pending = [...usable.values()];
  for (const seed of pending) {
    if (used.has(keyOf(seed.x, seed.z))) continue;
    const open = pending.filter((tile) => !used.has(keyOf(tile.x, tile.z)) && neighborsOf(tile, usable).length <= 1);
    const start = open[0] || seed;
    const path = [start];
    used.add(keyOf(start.x, start.z));
    let prev = null;
    let cur = start;
    let closed = false;
    for (let guard = 0; guard < 5000; guard++) {
      const options = neighborsOf(cur, usable).filter((tile) => !prev || keyOf(tile.x, tile.z) !== keyOf(prev.x, prev.z));
      if (!options.length) break;
      const straight = prev && options.find((tile) => tile.x - cur.x === cur.x - prev.x && tile.z - cur.z === cur.z - prev.z);
      let next = straight || options.find((tile) => !used.has(keyOf(tile.x, tile.z)));
      if (!next && path.length > 2 && options.some((tile) => keyOf(tile.x, tile.z) === keyOf(start.x, start.z))) {
        closed = true;
        break;
      }
      if (!next || used.has(keyOf(next.x, next.z))) break;
      path.push(next);
      used.add(keyOf(next.x, next.z));
      prev = cur;
      cur = next;
    }
    path.closed = closed;
    path.built = start.built;
    chains.push(path);
  }
  return { chains, posts };
}

function cornerIndices(path, closed) {
  const n = path.length;
  const out = [];
  if (n < 4) return out;
  const last = closed ? n : n - 2;
  for (let i = closed ? 0 : 1; i < last; i++) {
    const prev = path[(i - 1 + n) % n];
    const cur = path[i];
    const next = path[(i + 1) % n];
    const ax = cur.x - prev.x;
    const az = cur.z - prev.z;
    const bx = next.x - cur.x;
    const bz = next.z - cur.z;
    if (ax === bx && az === bz) continue;
    const i2 = i + 2;
    if (!closed && i2 >= n) continue;
    const nxt = path[closed ? i2 % n : i2];
    const stair = nxt.x - next.x === ax && nxt.z - next.z === az;
    if (!stair) out.push(i);
  }
  return out;
}

function splitCorners(path) {
  if (!path.built) return { parts: [{ tiles: path, from: null, to: null, closed: path.closed }], posts: [] };
  const indices = cornerIndices(path, path.closed);
  if (!indices.length) return { parts: [{ tiles: path, from: null, to: null, closed: path.closed }], posts: [] };
  let seq = path;
  let ids = indices;
  if (path.closed) {
    const first = Math.min(...indices);
    seq = path.slice(first).concat(path.slice(0, first));
    ids = indices.map((i) => (i - first + path.length) % path.length).sort((a, b) => a - b);
  } else {
    ids = [...indices].sort((a, b) => a - b);
  }
  const posts = [];
  const parts = [];
  let cursor = 0;
  let prev = null;
  for (const index of ids) {
    posts.push(seq[index]);
    const tiles = seq.slice(cursor, index);
    if (tiles.length) parts.push({ tiles, from: prev, to: seq[index], closed: false });
    prev = seq[index];
    cursor = index + 1;
  }
  const tail = seq.slice(cursor);
  if (tail.length) parts.push({ tiles: tail, from: prev, to: path.closed ? seq[0] : null, closed: false });
  return { parts, posts };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pullEnd(points, target, stop) {
  if (!points.length) return points;
  const da = dist(points[0], target);
  const db = dist(points[points.length - 1], target);
  if (Math.min(da, db) > 4.8) return points;
  let pts = points.slice();
  const flipped = da < db;
  if (flipped) pts.reverse();
  const kept = pts.filter((point, index) => index === 0 || dist(point, target) >= stop * 0.8);
  const end = kept[kept.length - 1];
  const gap = dist(end, target);
  if (gap > stop + 0.04) {
    const u = (gap - stop) / gap;
    kept.push({ x: end.x + (target.x - end.x) * u, z: end.z + (target.z - end.z) * u });
  }
  if (flipped) kept.reverse();
  return kept;
}

function smooth(points, closed) {
  if (points.length < 3) return points.slice();
  let pts = points;
  for (let pass = 0; pass < 2; pass++) {
    const n = pts.length;
    const out = [];
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.78 + b.x * 0.22, z: a.z * 0.78 + b.z * 0.22 });
      out.push({ x: a.x * 0.22 + b.x * 0.78, z: a.z * 0.22 + b.z * 0.78 });
    }
    pts = closed ? out : [points[0], ...out, points[points.length - 1]];
    if (!closed) {
      pts[0] = points[0];
      pts[pts.length - 1] = points[points.length - 1];
    }
  }
  return pts;
}

function resample(points, spacing, closed) {
  if (points.length < 2) return points.slice();
  const seq = closed ? points.concat([points[0]]) : points;
  const out = [seq[0]];
  let acc = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1];
    const b = seq[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-5) continue;
    let walked = 0;
    while (acc + (len - walked) >= spacing - 1e-4) {
      const need = spacing - acc;
      walked += need;
      const u = walked / len;
      out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
      acc = 0;
    }
    acc += len - walked;
  }
  if (!closed) {
    const last = seq[seq.length - 1];
    const prev = out[out.length - 1];
    if (Math.hypot(last.x - prev.x, last.z - prev.z) > 0.18) out.push(last);
  } else if (out.length > 2 && dist(out[out.length - 1], out[0]) < 0.18) {
    out.pop();
  }
  return out;
}

function hash01(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function stamp(geo, buckets, p0, p1, groundY, keep, mirrorAware = true, yScale = 1) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = geo.attributes.color;
  const box = geo.boundingBox;
  const minX = box.min.x;
  const span = Math.max(1e-4, box.max.x - minX);
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const tx = dx / len;
  const tz = dz / len;
  let rx = -tz;
  let rz = tx;
  const mx = (p0.x + p1.x) / 2 - keep.x;
  const mz = (p0.z + p1.z) / 2 - keep.z;
  if (mirrorAware && rx * mx + rz * mz < 0) { rx = -rx; rz = -rz; }
  const y0 = groundY(p0.x, p0.z);
  const y1 = groundY(p1.x, p1.z);
  const tint = 0.9 + hash01(Math.round(mx * 4), Math.round(mz * 4)) * 0.14;
  const count = pos.count;
  const base = buckets.pos.length / 3;
  for (let i = 0; i < count; i++) {
    const u = (pos.getX(i) - minX) / span;
    const ly = pos.getY(i);
    const lz = pos.getZ(i);
    buckets.pos.push(
      p0.x + tx * u * len + rx * lz,
      y0 + (y1 - y0) * u + ly * yScale,
      p0.z + tz * u * len + rz * lz,
    );
    if (nrm) {
      const nx = nrm.getX(i);
      const ny = nrm.getY(i);
      const nz = nrm.getZ(i);
      buckets.nrm.push(tx * nx + rx * nz, ny, tz * nx + rz * nz);
    } else buckets.nrm.push(0, 1, 0);
    if (col) buckets.col.push(col.getX(i) * tint, col.getY(i) * tint, col.getZ(i) * tint);
    else buckets.col.push(tint, tint, tint);
  }
  for (let i = 0; i < count; i += 3) {
    buckets.idx.push(base + i, base + i + 1, base + i + 2);
  }
}

function meshFrom(buckets, material) {
  if (!buckets.pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buckets.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buckets.col, 3));
  geo.setIndex(buckets.idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function centers(tiles) {
  return tiles.map((tile) => ({ x: tile.x + 0.5, z: tile.z + 0.5 }));
}

export function buildRampartGroup(game, map) {
  const group = new THREE.Group();
  group.name = 'rampart';
  const cultureKey = activeCulture();
  const wallGeo = RECS.get(`${cultureKey}-wall`)?.body;
  const postGeo = RECS.get(`${cultureKey}-post`)?.body;
  const gateGeo = RECS.get(`${cultureKey}-gate`)?.body;
  const rubbleGeo = RECS.get('rubble')?.body;
  if (!wallGeo || !rubbleGeo) return group;

  const alive = new Set();
  for (const building of game.buildings) {
    if (building.alive && building.kind === 'wall') alive.add(keyOf(building.x, building.z));
  }
  const tiles = new Map();
  const gates = [];
  for (const plot of game.plots) {
    if (plot.kind !== 'wall') continue;
    const arch = new Set((plot.arch || []).map(([x, z]) => keyOf(x, z)));
    for (const [x, z] of plot.tiles || []) {
      const built = alive.has(keyOf(x, z));
      const open = arch.has(keyOf(x, z)) && built;
      if (open) continue;
      tiles.set(keyOf(x, z), { x, z, built, arch: arch.has(keyOf(x, z)) });
    }
    if (plot.gate && alive.has(keyOf(plot.gate[0], plot.gate[1]))) {
      const archTiles = plot.arch?.length ? plot.arch : [plot.gate];
      let sx = 0;
      let sz = 0;
      for (const [x, z] of archTiles) { sx += x + 0.5; sz += z + 0.5; }
      gates.push({ x: sx / archTiles.length, z: sz / archTiles.length, stop: 1.05 });
    }
  }

  const hq = game.plots.find((plot) => plot.kind === 'hq');
  const keep = { x: hq ? hq.cx : map.size / 2, z: hq ? hq.cz : map.size / 2 };
  const ground = (x, z) => map.groundY(x, z) - 0.06;
  const builtBuckets = { pos: [], nrm: [], col: [], idx: [] };
  const rubbleBuckets = { pos: [], nrm: [], col: [], idx: [] };
  const postSpots = [];

  const { chains, posts } = chainsOf(tiles);
  for (const post of posts) postSpots.push({ x: post.x + 0.5, z: post.z + 0.5 });
  for (const plot of game.plots) {
    if (plot.kind !== 'wall' || !plot.gate || alive.has(keyOf(plot.gate[0], plot.gate[1]))) continue;
    const gx = plot.gate[0] + 0.5;
    const gz = plot.gate[1] + 0.5;
    const ox = gx - keep.x;
    const oz = gz - keep.z;
    const ol = Math.hypot(ox, oz) || 1;
    const tx = -oz / ol;
    const tz = ox / ol;
    postSpots.push({ x: gx + tx * 1.35, z: gz + tz * 1.35, s: 0.46 });
    postSpots.push({ x: gx - tx * 1.35, z: gz - tz * 1.35, s: 0.46 });
  }

  for (const chain of chains) {
    const { parts, posts: corners } = splitCorners(chain);
    for (const post of corners) postSpots.push({ x: post.x + 0.5, z: post.z + 0.5 });
    for (const part of parts) {
      if (!part.tiles.length) continue;
      let points = centers(part.tiles);
      if (part.from) points = pullEnd(points, { x: part.from.x + 0.5, z: part.from.z + 0.5 }, 0.5);
      if (part.to) points = pullEnd(points, { x: part.to.x + 0.5, z: part.to.z + 0.5 }, 0.5);
      if (part.tiles[0].built) {
        for (const gate of gates) points = pullEnd(points, gate, gate.stop);
      }
      const closed = !!part.closed && points.length > 3;
      points = resample(smooth(points, closed), 1, closed);
      const buckets = part.tiles[0].built ? builtBuckets : rubbleBuckets;
      const geo = part.tiles[0].built ? wallGeo : rubbleGeo;
      if (points.length === 1) {
        const only = points[0];
        stamp(geo, buckets, { x: only.x - 0.5, z: only.z }, { x: only.x + 0.5, z: only.z }, ground, keep);
        continue;
      }
      const count = closed ? points.length : points.length - 1;
      const yScale = part.tiles[0].built ? 1 : 2.15;
      for (let i = 0; i < count; i++) stamp(geo, buckets, points[i], points[(i + 1) % points.length], ground, keep, true, yScale);
    }
  }

  const mat = bodyMaterial();
  const builtMesh = meshFrom(builtBuckets, mat);
  if (builtMesh) group.add(builtMesh);
  const rubbleMesh = meshFrom(rubbleBuckets, bodyMaterial());
  if (rubbleMesh) group.add(rubbleMesh);

  if (postGeo && postSpots.length) {
    const postsMesh = new THREE.InstancedMesh(postGeo, bodyMaterial(), postSpots.length);
    postsMesh.castShadow = true;
    postsMesh.receiveShadow = true;
    postsMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    postSpots.forEach((spot, index) => {
      dummy.position.set(spot.x, ground(spot.x, spot.z), spot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(spot.s || 1, spot.s || 1, spot.s || 1);
      dummy.updateMatrix();
      postsMesh.setMatrixAt(index, dummy.matrix);
    });
    postsMesh.instanceMatrix.needsUpdate = true;
    group.add(postsMesh);
  }

  if (gateGeo) {
    for (const gate of gates) {
      const ox = gate.x - keep.x;
      const oz = gate.z - keep.z;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      let samples = 0;
      for (const tile of tiles.values()) {
        if (!tile.built) continue;
        const dx = tile.x + 0.5 - gate.x;
        const dz = tile.z + 0.5 - gate.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.75 || d > 4.5) continue;
        sxx += dx * dx;
        szz += dz * dz;
        sxz += dx * dz;
        samples++;
      }
      let tx;
      let tz;
      if (samples >= 2) {
        const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        tx = Math.cos(ang);
        tz = Math.sin(ang);
      } else {
        const ol = Math.hypot(ox, oz) || 1;
        tx = -oz / ol;
        tz = ox / ol;
      }
      let ry = Math.atan2(-tz, tx);
      const zx = Math.sin(ry);
      const zz = Math.cos(ry);
      if (zx * ox + zz * oz < 0) ry += Math.PI;
      const mesh = new THREE.Mesh(gateGeo, bodyMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(gate.x, ground(gate.x, gate.z), gate.z);
      mesh.rotation.y = ry;
      group.add(mesh);
      const glow = RECS.get(`${cultureKey}-gate`)?.glow;
      if (glow) {
        const lamp = new THREE.Mesh(glow, toyMat({
          color: 0xffd27a, emissive: 0xffd27a, emissiveIntensity: 0.8, flatShading: true,
        }));
        lamp.castShadow = false;
        lamp.position.copy(mesh.position);
        lamp.rotation.y = ry;
        group.add(lamp);
      }
    }
  }
  return group;
}
