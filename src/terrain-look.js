// Forest masses, chunky rocks, worn roads and shore foam. Presentation only:
// nothing here writes a tile or reads the simulation random source.
import * as THREE from 'three';
import { TILE } from './config.js';
import { toyMat } from './toy-style.js';
import { makeRNG } from './utils.js';
import {
  makePineGeometry, makeLollipopGeometry, makeBushGeometry, makeTrunkGeometry, makeBoulderGeometry,
} from './toy-props.js';
import { propRecord } from './prop-pack.js';

const CHUNK = 32;

function chunked(group, geometry, items, { vertexColors = true, instanceColor = false, color = 0xffffff, cast = true, flat = false } = {}) {
  if (!items.length) return;
  const chunks = new Map();
  for (const it of items) {
    const key = ((it.x / CHUNK) | 0) + ':' + ((it.z / CHUNK) | 0);
    let list = chunks.get(key);
    if (!list) chunks.set(key, list = []);
    list.push(it);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  for (const list of chunks.values()) {
    const mat = toyMat(vertexColors
      ? { color: 0xffffff, vertexColors: true, flatShading: flat }
      : { color: instanceColor ? 0xffffff : color, flatShading: flat });
    const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    list.forEach((it, i) => {
      e.set(it.rx || 0, it.ry || 0, it.rz || 0);
      q.setFromEuler(e);
      s.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if ((vertexColors || instanceColor) && it.color !== undefined) {
        c.set(it.color);
        mesh.setColorAt(i, c);
      }
    });
    if ((vertexColors || instanceColor) && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
}

function nearestSite(map, x, z) {
  let best = 1e9;
  for (const site of map.sites || []) best = Math.min(best, Math.hypot(x - site.x, z - site.z));
  return best;
}

function forestNeighbours(map, x, z) {
  let n = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if (!map.inBounds(x + dx, z + dz)) continue;
      if (map.tiles[map.idx(x + dx, z + dz)] === TILE.FOREST) n++;
    }
  }
  return n;
}

// Shared pack geometry, scaled so `h` is the world height. Role colours come
// from the map palette. Instance colour tints a flat Lambert material.
function placeProp(group, rec, items, colorFor, { cast = true } = {}) {
  if (!rec || !items.length) return false;
  for (const part of rec.parts) {
    const scaled = [];
    for (const it of items) {
      const tint = colorFor(part.role, it);
      if (tint == null) continue;
      const target = it.h != null ? it.h : (it.s || 1);
      const k = target / rec.height;
      scaled.push({
        x: it.x, y: it.y - target * (it.sink || 0), z: it.z,
        sx: (it.sx || 1) * k, sy: (it.sy || 1) * k, sz: (it.sz || 1) * k,
        rx: it.rx, ry: it.ry, rz: it.rz,
        color: tint,
      });
    }
    if (scaled.length) {
      chunked(group, part.geometry, scaled, { vertexColors: false, instanceColor: true, cast, flat: true });
    }
  }
  return true;
}

export function buildForestGroup(map) {
  const g = new THREE.Group();
  g.name = 'forest';
  const rng = makeRNG((((map.seed | 0) * 17 + 11) >>> 0) || 1);
  const canopy = new THREE.Color(map.theme?.palette?.canopy ?? 0x9ad35a);
  const accent = canopy.clone().offsetHSL(0.08, 0.06, 0.16);
  const pines = [];
  const lollis = [];
  const bushes = [];
  const trunks = [];
  const N = map.size;
  const pushTree = (list, x, z, s, color, trunk) => {
    const gy = map.groundY(x, z);
    list.push({
      x, y: gy, z, s,
      ry: rng() * Math.PI * 2,
      rx: (rng() - 0.5) * 0.04,
      rz: (rng() - 0.5) * 0.04,
      color,
    });
    if (trunk) {
      trunks.push({
        x, y: gy, z,
        s: s * (0.85 + rng() * 0.3),
        sy: s * (0.9 + rng() * 0.5),
        ry: rng() * 6,
      });
    }
  };
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const t = map.tiles[map.idx(x, z)];
      const dist = nearestSite(map, x + 0.5, z + 0.5);
      if (t === TILE.FOREST) {
        const score = forestNeighbours(map, x, z);
        const near = dist < 48;
        let count = score >= 5 ? 3 : score >= 3 ? 2 : 1;
        if (!near) count = score >= 4 && rng() < 0.4 ? 1 : 0;
        const edge = score <= 2;
        for (let i = 0; i < count; i++) {
          const px = x + 0.28 + rng() * 0.44;
          const pz = z + 0.28 + rng() * 0.44;
          const tall = (score >= 5 ? 1.2 : 1.02) + rng() * 0.08;
          const tint = rng() < 0.12 ? accent : canopy;
          const c = tint.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.03);
          if (edge) pushTree(bushes, px, pz, 0.85, c, false);
          else if (rng() < 0.22) pushTree(lollis, px, pz, tall, c, true);
          else pushTree(pines, px, pz, tall, c, true);
        }
      } else if ((t === TILE.GRASS || t === TILE.SAND) && dist > 14 && dist < 46 && rng() < 0.22) {
        let wood = false;
        for (let dz = -1; dz <= 1 && !wood; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (map.inBounds(x + dx, z + dz) && map.tiles[map.idx(x + dx, z + dz)] === TILE.FOREST) wood = true;
          }
        }
        if (!wood) continue;
        if (map.tiles[map.idx(x, z)] === TILE.PATH) continue;
        pushTree(bushes, x + rng(), z + rng(), 0.65 + rng() * 0.4, canopy, false);
      }
    }
  }
  const pine = propRecord('tree_cone');
  const round = propRecord('tree_fat');
  const shrub = propRecord('plant_bush');
  const wood = 0x6b4a32;
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  const tintTree = (role, it) => (role === 'wood' ? wood : role === 'foliage' ? it.color : null);
  if (pine && round && shrub) {
    for (const it of pines) it.h = (it.s || 1) * 3.1;
    for (const it of lollis) it.h = (it.s || 1) * 2.7;
    for (const it of bushes) it.h = (it.s || 1) * 1.15;
    placeProp(g, pine, pines, tintTree);
    placeProp(g, round, lollis, tintTree);
    placeProp(g, shrub, bushes, tintTree, { cast: false });
    const tufts = [];
    const blooms = [];
    for (let i = 0; i < pines.length && tufts.length < 900; i += 2) {
      const src = pines[i];
      if (rng() > 0.55) continue;
      tufts.push({
        x: src.x + (rng() - 0.5) * 1.4, y: src.y, z: src.z + (rng() - 0.5) * 1.4,
        h: 0.36 + rng() * 0.18, ry: rng() * 6,
      });
      if (rng() < 0.16 && blooms.length < 220) {
        blooms.push({
          x: src.x + (rng() - 0.5) * 1.6, y: src.y, z: src.z + (rng() - 0.5) * 1.6,
          h: 0.48, ry: rng() * 6,
        });
      }
    }
    const grassRec = propRecord('grass');
    const flower = propRecord('flower_yellowA');
    if (grassRec) placeProp(g, grassRec, tufts, () => grassHex, { cast: false });
    if (flower) placeProp(g, flower, blooms, (role) => (role === 'accent' ? 0xf2c14e : grassHex), { cast: false });
  } else {
    chunked(g, makePineGeometry(), pines);
    chunked(g, makeLollipopGeometry(), lollis);
    chunked(g, makeBushGeometry(), bushes, { cast: true });
    chunked(g, makeTrunkGeometry(), trunks, { vertexColors: false, color: wood, cast: true });
  }
  return g;
}

export function buildRockGroup(map) {
  const g = new THREE.Group();
  g.name = 'rocks';
  const rng = makeRNG((((map.seed | 0) * 29 + 3) >>> 0) || 1);
  const stone = new THREE.Color(map.theme?.palette?.mountain ?? 0xe3dcc2);
  const lists = [[], [], [], []];
  let budget = 2800;
  const drop = (x, z, s, bury) => {
    if (budget <= 0) return;
    budget--;
    const v = (rng() * 4) | 0;
    const gy = map.groundY(x, z);
    lists[v].push({
      x, y: gy - s * bury, z,
      sx: s * (0.85 + rng() * 0.4),
      sy: s * (0.7 + rng() * 0.55),
      sz: s * (0.8 + rng() * 0.45),
      ry: rng() * Math.PI * 2,
      rx: (rng() - 0.5) * 0.25,
      rz: (rng() - 0.5) * 0.2,
      color: stone.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06),
    });
  };
  const cluster = (x, z, hero) => {
    drop(x, z, hero ? 1.8 + rng() * 2.1 : 1.1 + rng() * 0.8, 0.28);
    const med = hero ? 2 + (rng() * 2 | 0) : 1;
    for (let i = 0; i < med; i++) drop(x + (rng() - 0.5) * 2.4, z + (rng() - 0.5) * 2.4, 0.7 + rng() * 0.7, 0.32);
    const peb = 3 + (rng() * 3 | 0);
    for (let i = 0; i < peb; i++) drop(x + (rng() - 0.5) * 3.2, z + (rng() - 0.5) * 3.2, 0.28 + rng() * 0.35, 0.2);
  };
  const N = map.size;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      if (budget <= 0) break;
      if (map.tiles[map.idx(x, z)] !== TILE.MOUNTAIN) continue;
      const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => map.isWalkable(x + dx, z + dz));
      const dist = nearestSite(map, x, z);
      if (rim && (dist < 56 ? rng() < 0.42 : rng() < 0.16)) cluster(x + rng(), z + rng(), rng() < 0.35);
      else if (!rim && rng() < (dist < 40 ? 0.12 : 0.04)) drop(x + rng(), z + rng(), 0.8 + rng() * 1.1, 0.3);
    }
  }
  const variants = ['rock_largeA', 'rock_largeC', 'rock_smallA', 'rock_largeA'].map((name) => propRecord(name));
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  if (variants.every(Boolean)) {
    for (let v = 0; v < 4; v++) {
      const ratio = variants[v].span / variants[v].height;
      for (const it of lists[v]) {
        const want = v >= 2 ? 0.32 + (it.sy || 0.4) * 0.06 : 0.48 + Math.min(it.sy || 1, 3) * 0.08;
        it.h = Math.min(want, 2.2 / ratio);
        it.sink = 0.12;
      }
      placeProp(g, variants[v], lists[v], (role, it) => (role === 'foliage' ? grassHex : (it.color || stone)));
    }
  } else {
    for (let v = 0; v < 4; v++) chunked(g, makeBoulderGeometry(v), lists[v]);
  }
  return g;
}

export function buildCliffGroup(map) {
  const g = new THREE.Group();
  g.name = 'cliffs';
  const face = propRecord('cliff_large_stone');
  const block = propRecord('cliff_block_stone');
  if (!face && !block) return g;
  const rng = makeRNG((((map.seed | 0) * 41 + 7) >>> 0) || 1);
  const stone = new THREE.Color(map.theme?.palette?.mountain ?? 0xe3dcc2);
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  const faces = [];
  const blocks = [];
  let budget = 640;
  const N = map.size;
  for (let z = 1; z < N - 1 && budget > 0; z++) {
    for (let x = 1; x < N - 1 && budget > 0; x++) {
      if (map.tiles[map.idx(x, z)] === TILE.WATER) continue;
      const px0 = x + 0.5, pz0 = z + 0.5;
      // The play camera sits on +Z. Keep that foreground clear of cliff blocks.
      if ((map.sites || []).some((s) => Math.hypot(px0 - s.x, pz0 - s.z) < 46 && pz0 > s.z - 8)) continue;
      const y0 = map.groundY(px0, pz0);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!map.inBounds(x + dx, z + dz)) continue;
        const drop = y0 - map.groundY(x + dx + 0.5, z + dz + 0.5);
        if (drop < 1.15 || rng() > 0.55) continue;
        budget--;
        const item = {
          x: x + 0.5 + dx * 0.42,
          y: map.groundY(x + dx + 0.5, z + dz + 0.5),
          z: z + 0.5 + dz * 0.42,
          h: Math.min(drop * 0.72, 1.8),
          ry: Math.atan2(dx, dz),
          color: stone,
        };
        if (drop > 2.2 && block && rng() < 0.4) blocks.push(item);
        else faces.push(item);
        break;
      }
    }
  }
  const tint = (role, it) => (role === 'foliage' ? grassHex : it.color);
  if (face) placeProp(g, face, faces, tint);
  if (block) placeProp(g, block, blocks, tint);
  return g;
}

// Corner-cutting. Open polylines keep their ends. Closed rings (first point
// repeated) lose the duplicate and wrap.
function chaikin(pts, iters, closed) {
  let cur = pts.map((p) => [p[0], p[1]]);
  if (closed && cur.length > 2) cur.pop();
  for (let k = 0; k < iters; k++) {
    const n = cur.length;
    if (n < 3) break;
    const next = [];
    const last = closed ? n : n - 1;
    if (!closed) next.push(cur[0]);
    for (let i = 0; i < last; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
}

// A strip across `rows` (fractions of half-width, -1..1) with a colour at
// each row. The centre can wander; edges fade to the outer colour.
function colorRibbon(map, pts, halfWidth, rows, yAt) {
  if (pts.length < 2) return null;
  const pos = [];
  const col = [];
  const n = pts.length;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz;
    const nz = dx;
    const w = halfWidth(i);
    samples.push(rows.map((row) => {
      const x = pts[i][0] + nx * w * row.t;
      const z = pts[i][1] + nz * w * row.t;
      return [x, yAt(x, z), z, row.c];
    }));
  }
  const push = (a) => { pos.push(a[0], a[1], a[2]); col.push(a[3].r, a[3].g, a[3].b); };
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < rows.length - 1; r++) {
      const a = samples[i][r], b = samples[i][r + 1], c = samples[i + 1][r + 1], d = samples[i + 1][r];
      for (const v of [a, b, c, a, c, d]) push(v);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const upN = geo.attributes.normal;
  for (let i = 0; i < upN.count; i++) upN.setXYZ(i, 0, 1, 0);
  const mat = toyMat({
    vertexColors: true, flatShading: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noOutline = true;
  return mesh;
}

export function buildRoadGroup(map) {
  const g = new THREE.Group();
  g.name = 'roads';
  const N = map.size;
  const isP = (x, z) => {
    if (!map.inBounds(x, z)) return false;
    const i = map.idx(x, z);
    return map.tiles[i] === TILE.PATH || !!(map.swRoad && map.swRoad[i]);
  };
  const seen = new Uint8Array(N * N);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const neighbours = (x, z) => dirs.filter(([dx, dz]) => isP(x + dx, z + dz));
  const path = new THREE.Color(map.theme?.palette?.path ?? 0xb07a4f);
  const grass = new THREE.Color(map.theme?.palette?.grass ?? 0x2f7d66);
  const grassLum = grass.r * 0.3 + grass.g * 0.59 + grass.b * 0.11;
  // A worn track. On snow the authored path is a cold grey, so pull it up
  // toward the ground until it reads as packed dirt, not a dark stamp.
  const dirt = path.clone().lerp(new THREE.Color(0xb08968), 0.45);
  if (grassLum > 0.62) dirt.lerp(grass, 0.55);
  const mid = dirt.clone().lerp(grass, 0.45);
  const edge = dirt.clone().lerp(grass, 0.82);
  const center = dirt.clone().lerp(new THREE.Color(0xfff6ea), grassLum > 0.62 ? 0.22 : 0.1);
  const rows = [
    { t: -1, c: edge }, { t: -0.55, c: mid }, { t: 0, c: center }, { t: 0.55, c: mid }, { t: 1, c: edge },
  ];
  const stones = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!isP(x, z) || seen[map.idx(x, z)]) continue;
      const raw = [];
      let cx = x;
      let cz = z;
      let px = -999;
      let pz = -999;
      while (map.inBounds(cx, cz) && isP(cx, cz) && !seen[map.idx(cx, cz)]) {
        seen[map.idx(cx, cz)] = 1;
        raw.push([cx + 0.5, cz + 0.5]);
        const opts = neighbours(cx, cz).filter(([dx, dz]) => cx + dx !== px || cz + dz !== pz);
        if (!opts.length) break;
        let pick = opts[0];
        for (const o of opts) {
          if (px > -100 && o[0] === cx - px && o[1] === cz - pz) pick = o;
        }
        px = cx;
        pz = cz;
        cx += pick[0];
        cz += pick[1];
      }
      if (raw.length < 2) continue;
      const smooth = chaikin(raw, 3, false);
      let arc = 0;
      const wandered = smooth.map((p, i) => {
        if (i) arc += Math.hypot(p[0] - smooth[i - 1][0], p[1] - smooth[i - 1][1]);
        const prev = smooth[Math.max(0, i - 1)];
        const next = smooth[Math.min(smooth.length - 1, i + 1)];
        let dx = next[0] - prev[0];
        let dz = next[1] - prev[1];
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L;
        const nz = dx / L;
        const wob = Math.sin(arc * 0.55 + raw[0][0] * 0.2) * 0.16;
        return [p[0] + nx * wob, p[1] + nz * wob];
      });
      const mesh = colorRibbon(
        map, wandered,
        (i) => 0.72 + 0.16 * Math.sin(i * 0.35 + raw[0][1]),
        rows,
        (vx, vz) => map.groundY(vx, vz) + 0.04,
      );
      if (mesh) g.add(mesh);
      for (let i = 2; i < wandered.length - 2; i += 7) {
        const p = wandered[i];
        const q = wandered[Math.min(wandered.length - 1, i + 1)];
        let dx = q[0] - p[0];
        let dz = q[1] - p[1];
        const L = Math.hypot(dx, dz) || 1;
        const side = (i & 1) ? 1 : -1;
        const ox = p[0] + (-dz / L) * side * 0.78;
        const oz = p[1] + (dx / L) * side * 0.78;
        stones.push({ x: ox, y: map.groundY(ox, oz), z: oz, h: 0.16 + (i % 3) * 0.04, ry: i });
      }
    }
  }
  const rock = propRecord('rock_smallA');
  if (rock) {
    placeProp(g, rock, stones, (role) => (role === 'foliage' ? grass : dirt), { cast: false });
  }
  return g;
}

export function buildFoamGroup(map) {
  const g = new THREE.Group();
  g.name = 'foam';
  const N = map.size;
  const land = (x, z) => map.inBounds(x, z) && map.tiles[map.idx(x, z)] !== TILE.WATER;
  const water = (x, z) => map.inBounds(x, z) && map.tiles[map.idx(x, z)] === TILE.WATER;
  // Directed edges, land on the right as we walk them.
  const edges = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!water(x, z)) continue;
      if (land(x + 1, z)) edges.push({ ax: x + 1, az: z, bx: x + 1, bz: z + 1 });
      if (land(x - 1, z)) edges.push({ ax: x, az: z + 1, bx: x, bz: z });
      if (land(x, z + 1)) edges.push({ ax: x + 1, az: z + 1, bx: x, bz: z + 1 });
      if (land(x, z - 1)) edges.push({ ax: x, az: z, bx: x + 1, bz: z });
    }
  }
  if (!edges.length) return g;
  const startAt = new Map();
  edges.forEach((e, i) => {
    const k = e.ax + ',' + e.az;
    if (!startAt.has(k)) startAt.set(k, []);
    startAt.get(k).push(i);
  });
  const used = new Uint8Array(edges.length);
  const chains = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const chain = [];
    let cur = i;
    while (cur != null && !used[cur]) {
      used[cur] = 1;
      const e = edges[cur];
      if (!chain.length) chain.push([e.ax, e.az]);
      chain.push([e.bx, e.bz]);
      const nexts = startAt.get(e.bx + ',' + e.bz) || [];
      cur = nexts.find((j) => !used[j]);
    }
    if (chain.length >= 3) chains.push(chain);
  }
  const lava = !!(map.isLava && map.isLava());
  const grass = new THREE.Color(map.theme?.palette?.grass ?? 0x2f7d66);
  const sand = new THREE.Color(lava ? 0x4a2a18 : (map.theme?.palette?.sand ?? 0xcbb892));
  const foam = new THREE.Color(lava ? (map.theme?.palette?.foam ?? 0xffd27a) : (map.theme?.palette?.water ?? 0x3fa9e0));
  if (!lava) foam.lerp(new THREE.Color(map.theme?.palette?.foam ?? 0xe8f6ff), 0.35);
  const shore = sand.clone().lerp(grass, 0.35);
  const lip = sand.clone().lerp(grass, 0.78);
  const rows = [
    { t: -0.55, c: foam }, { t: -0.05, c: foam.clone().lerp(sand, 0.45) },
    { t: 0.35, c: shore }, { t: 1, c: lip },
  ];
  const yAt = (x, z) => {
    const tx = x | 0, tz = z | 0;
    if (!map.inBounds(tx, tz) || map.tiles[map.idx(tx, tz)] === TILE.WATER) return lava ? 0.0 : 0.03;
    return map.groundY(x, z) + 0.05;
  };
  for (const chain of chains) {
    const closed = chain.length > 8
      && chain[0][0] === chain[chain.length - 1][0]
      && chain[0][1] === chain[chain.length - 1][1];
    const smooth = chaikin(chain, 3, closed);
    const ring = closed ? smooth.concat([smooth[0]]) : smooth;
    const mesh = colorRibbon(map, ring, () => 1.15, rows, yAt);
    if (mesh) g.add(mesh);
  }
  return g;
}
