// Forest masses, chunky rocks, worn roads and shore foam. Presentation only:
// nothing here writes a tile or reads the simulation random source.
import * as THREE from 'three';
import { TILE } from './config.js';
import { toyMat } from './toy-style.js';
import { makeRNG, makeNoise } from './utils.js';
import {
  makePineGeometry, makeLollipopGeometry, makeBushGeometry, makeTrunkGeometry, makeBoulderGeometry,
} from './toy-props.js';
import { propRecord } from './prop-pack.js';
import { activeCulture } from './cultures.js';
import { rimForm, rimMaxRadius, rimRadius } from './site-plan.js';

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
      const vale = map.theme?.terrain === 'vale';
      if (rim && (dist < 56 ? rng() < (vale ? 0.72 : 0.42) : rng() < (vale ? 0.28 : 0.16))) cluster(x + rng(), z + rng(), vale || rng() < 0.35);
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
      const vale = map.theme?.terrain === 'vale' || map.theme?.terrain === 'hills';
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!map.inBounds(x + dx, z + dz)) continue;
        const baseY = map.groundY(x + dx + 0.5, z + dz + 0.5);
        const drop = y0 - baseY;
        if (drop < 1.15 || rng() > (vale ? 0.82 : 0.55)) continue;
        const layers = vale ? Math.min(3, 1 + Math.floor(drop / 1.1)) : 1;
        for (let layer = 0; layer < layers && budget > 0; layer++) {
          budget--;
          const item = {
            x: x + 0.5 + dx * (0.28 + layer * 0.16),
            y: baseY + layer * Math.min(drop / layers, 0.7),
            z: z + 0.5 + dz * (0.28 + layer * 0.16),
            h: Math.min((drop / layers) * 0.85, vale ? 1.15 : 1.8),
            ry: Math.atan2(dx, dz) + (layer - 1) * 0.06,
            color: stone.clone().offsetHSL(0, 0, -0.04 * layer),
          };
          if (drop > 2.2 && block && rng() < 0.35) blocks.push(item);
          else faces.push(item);
        }
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

function catmullRom(points, samples) {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  const src = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < src.length - 2; i++) {
    const p0 = src[i - 1];
    const p1 = src[i];
    const p2 = src[i + 1];
    const p3 = src[i + 2];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// A few open splines: each gate to the keep, and each war road onward to its hive.
// No tile-graph loops.
function angDelta(a, b) {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

// One main street per city: the war gate, a keep courtyard, and the back gate.
// Side gates are a single spur onto that street. War roads stop at the war
// gate, so they do not draw a second path through the town.
function roadSplines(map) {
  const lines = [];
  const plazas = [];
  const meets = new Map();
  for (const site of map.sites || []) {
    const form = site.rim ? rimForm(site.rim) : null;
    const gates = form && form.gates && form.gates.length ? form.gates : [0, Math.PI];
    const facing = site.rim ? site.rim.facing : 0;
    const gatePt = (g) => {
      const ang = g + facing;
      const r = site.rim ? rimRadius(site.rim, g) + 1.2 : 16;
      return [site.x + Math.cos(ang) * r, site.z + Math.sin(ang) * r];
    };
    let main = gates[0];
    let back = null;
    let mainD = Infinity;
    let backD = Infinity;
    for (const g of gates) {
      const frontD = angDelta(g, 0);
      const rearD = angDelta(g, Math.PI);
      if (frontD < mainD) { mainD = frontD; main = g; }
      if (rearD < backD && frontD > 0.45) { backD = rearD; back = g; }
    }
    const front = gatePt(main);
    const ux = Math.cos(facing);
    const uz = Math.sin(facing);
    const plazaNear = [site.x + ux * 4.4, site.z + uz * 4.4];
    const street = [front, plazaNear];
    if (back != null && angDelta(back, main) > 0.7) {
      street.push([site.x - ux * 4.4, site.z - uz * 4.4], gatePt(back));
    }
    lines.push(street);
    plazas.push({ x: site.x, z: site.z });
    meets.set(`${site.x},${site.z}`, front);
    for (const g of gates) {
      if (g === main || g === back) continue;
      const spur = gatePt(g);
      const join = [
        front[0] * 0.42 + plazaNear[0] * 0.58,
        front[1] * 0.42 + plazaNear[1] * 0.58,
      ];
      lines.push([spur, join]);
    }
  }
  for (const road of map.roadPaths || []) {
    const pts = road.pts || [];
    if (pts.length < 6 || !road.site) continue;
    const [sx, sz] = road.site;
    const outer = [];
    for (const p of pts) {
      const x = p[0] + 0.5;
      const z = p[1] + 0.5;
      if (Math.hypot(x - sx, z - sz) < 20) continue;
      if (!outer.length || Math.hypot(x - outer[outer.length - 1][0], z - outer[outer.length - 1][1]) > 3) {
        outer.push([x, z]);
      }
    }
    if (outer.length < 3) continue;
    const meet = meets.get(`${sx},${sz}`);
    if (meet) outer.push(meet);
    lines.push(outer);
  }
  for (const b of map.bridges || []) {
    lines.push([[b.x0, b.z0], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], [b.x1, b.z1]]);
  }
  return { lines, plazas };
}

// A dirt courtyard in front of the keep. It is a patch of the same road colour,
// broken into ground-following quads, not a ring or a build pad.
function plazaMesh(map, x, z, color) {
  const s = 6.4;
  const n = 3;
  const pos = [];
  const col = [];
  const c = color.clone();
  const yAt = (px, pz) => map.groundY(px, pz) + 0.04;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x0 = x - s / 2 + (ix / n) * s;
      const x1 = x - s / 2 + ((ix + 1) / n) * s;
      const z0 = z - s / 2 + (iz / n) * s;
      const z1 = z - s / 2 + ((iz + 1) / n) * s;
      for (const [vx, vz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) {
        pos.push(vx, yAt(vx, vz), vz);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = toyMat({
    vertexColors: true, flatShading: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.noOutline = true;
  return mesh;
}

export function buildRoadGroup(map) {
  const g = new THREE.Group();
  g.name = 'roads';
  const STYLES = {
    european: { edge: 0x4e3422, bed: 0x8a5a34, center: 0xe0c48a, rut: 0x5c3a24 },
    asian: { edge: 0x6e6a62, bed: 0xc9c3b2, center: 0xf7f3ea, rut: 0x9a958a },
    south_american: { edge: 0x5c2410, bed: 0xb04a24, center: 0xe08048, rut: 0x7a3012 },
    middle_eastern: { edge: 0x7a5a34, bed: 0xd4b07a, center: 0xf3e2bc, rut: 0xa8844e },
  };
  const style = STYLES[activeCulture()] || STYLES.european;
  const grass = new THREE.Color(map.theme?.palette?.grass ?? 0x2f7d66);
  const grassLum = grass.r * 0.3 + grass.g * 0.59 + grass.b * 0.11;
  const center = new THREE.Color(style.bed).lerp(new THREE.Color(style.center), 0.55);
  const edge = center.clone().multiplyScalar(grassLum > 0.5 ? 0.62 : 0.78);
  if (grassLum > 0.5) center.multiplyScalar(0.82);
  const grassC = grass.clone();
  const wear = center.clone().multiplyScalar(0.86);
  const fade = edge.clone().lerp(grassC, 0.62);
  const rows = [
    { t: -1, c: grassC },
    { t: -0.78, c: fade },
    { t: -0.46, c: edge },
    { t: -0.16, c: center },
    { t: 0.16, c: wear },
    { t: 0.46, c: edge },
    { t: 0.78, c: fade.clone() },
    { t: 1, c: grassC.clone() },
  ];
  const stones = [];
  const tufts = [];
  const splines = roadSplines(map);
  for (const plaza of splines.plazas) {
    const mesh = plazaMesh(map, plaza.x, plaza.z, center);
    if (mesh) g.add(mesh);
  }
  for (const ctrl of splines.lines) {
    if (ctrl.length < 2) continue;
    let line = catmullRom(ctrl, 10).filter((p) =>
      Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > -4 && p[1] > -4 && p[0] < map.size + 4 && p[1] < map.size + 4);
    if (line.length < 4) continue;
    let arc = 0;
    line = line.map((p, i) => {
      if (i) arc += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
      const prev = line[Math.max(0, i - 1)];
      const next = line[Math.min(line.length - 1, i + 1)];
      let dx = next[0] - prev[0];
      let dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      const wob = Math.sin(arc * 0.42) * 0.28;
      return [p[0] + (-dz / len) * wob, p[1] + (dx / len) * wob];
    });
    const mesh = colorRibbon(
      map, line,
      (i) => {
        const p = line[Math.min(i, line.length - 1)];
        let width = 0.62;
        for (const plaza of splines.plazas) {
          const d = Math.hypot(p[0] - plaza.x, p[1] - plaza.z);
          if (d < 9) width = Math.max(width, 0.62 + (1 - d / 9) * 1.7);
        }
        return width;
      },
      rows,
      (vx, vz) => map.groundY(vx, vz) + 0.045,
    );
    if (mesh) g.add(mesh);
    let walk = 0;
    let nextStone = 3.2;
    let nextTuft = 1.8;
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1];
      const q = line[i];
      let dx = q[0] - p[0];
      let dz = q[1] - p[1];
      const L = Math.hypot(dx, dz) || 1;
      walk += L;
      const nx = -dz / L;
      const nz = dx / L;
      if (walk >= nextStone) {
        nextStone += 4.5;
        for (const side of [-1, 1]) {
          const ox = q[0] + nx * side * 0.55;
          const oz = q[1] + nz * side * 0.55;
          stones.push({ x: ox, y: map.groundY(ox, oz), z: oz, h: 0.12, ry: walk });
        }
      }
      if (walk >= nextTuft) {
        nextTuft += 2.2;
        const side = nextTuft % 2 < 1 ? 1 : -1;
        const ox = q[0] + nx * side * 0.62;
        const oz = q[1] + nz * side * 0.62;
        tufts.push({ x: ox, y: map.groundY(ox, oz), z: oz, h: 0.28, ry: walk });
      }
    }
  }
  const rock = propRecord('rock_smallA');
  const grassP = propRecord('grass');
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  if (rock) placeProp(g, rock, stones, (role) => (role === 'foliage' ? grassHex : edge), { cast: false });
  if (grassP) placeProp(g, grassP, tufts, () => grassHex, { cast: false });
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
  const pieces = [];
  for (const chain of chains) {
    // A coastline that doubles back makes the spline loop into a kink. Split
    // there and draw each stretch on its own.
    let cur = [chain[0]];
    for (let i = 1; i < chain.length - 1; i++) {
      cur.push(chain[i]);
      const a = chain[i - 1];
      const b = chain[i];
      const c = chain[i + 1];
      const abx = b[0] - a[0];
      const abz = b[1] - a[1];
      const bcx = c[0] - b[0];
      const bcz = c[1] - b[1];
      const la = Math.hypot(abx, abz) || 1;
      const lb = Math.hypot(bcx, bcz) || 1;
      if ((abx * bcx + abz * bcz) / (la * lb) < -0.15) {
        if (cur.length >= 4) pieces.push(cur);
        cur = [chain[i]];
      }
    }
    cur.push(chain[chain.length - 1]);
    if (cur.length >= 4) pieces.push(cur);
  }
  for (const chain of pieces) {
    const closed = chain.length > 8
      && chain[0][0] === chain[chain.length - 1][0]
      && chain[0][1] === chain[chain.length - 1][1];
    const step = 4;
    const ctrl = [];
    for (let i = 0; i < chain.length; i += step) ctrl.push(chain[i]);
    const tail = chain[chain.length - 1];
    if (ctrl.length && (ctrl[ctrl.length - 1][0] !== tail[0] || ctrl[ctrl.length - 1][1] !== tail[1])) ctrl.push(tail);
    if (ctrl.length < 4) continue;
    let smooth = catmullRom(ctrl, 8);
    if (closed && smooth.length > 2) smooth = smooth.concat([smooth[0]]);
    const mesh = colorRibbon(map, smooth, () => 1.15, rows, yAt);
    if (mesh) g.add(mesh);
  }
  return g;
}

export const waterClock = { value: 0 };

export function buildWaterMesh(map) {
  const N = map.size;
  const SUB = 2;
  const G = N * SUB;
  const V = G + 1;
  const shore = new Float32Array(V * V);
  const land = (x, z) => map.inBounds(x, z) && map.tiles[map.idx(x, z)] !== TILE.WATER;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = i / SUB;
      const z = j / SUB;
      let acc = 0;
      let w = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const wt = 1 / (1 + dx * dx + dz * dz);
          acc += land((x + dx) | 0, (z + dz) | 0) ? wt : 0;
          w += wt;
        }
      }
      shore[j * V + i] = w ? acc / w : 0;
    }
  }
  const pos = new Float32Array(V * V * 3);
  const col = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const o = (j * V + i) * 3;
      pos[o] = i / SUB;
      pos[o + 1] = 0;
      pos[o + 2] = j / SUB;
      const s = shore[j * V + i];
      col[o] = s;
      col[o + 1] = s;
      col[o + 2] = s;
    }
  }
  const idx = new Uint32Array(G * G * 6);
  let k = 0;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const a = j * V + i;
      idx[k++] = a;
      idx[k++] = a + V;
      idx[k++] = a + 1;
      idx[k++] = a + 1;
      idx[k++] = a + V;
      idx[k++] = a + V + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const pal = map.theme?.palette || {};
  const lava = !!(map.isLava && map.isLava());
  const shallow = new THREE.Color(lava ? 0xffb15a : (pal.water ?? 0x3fa9e0)).lerp(new THREE.Color(0xd8fff4), lava ? 0.15 : 0.45);
  const deep = new THREE.Color(lava ? 0xc43a12 : (pal.water ?? 0x1d6ea8));
  if (!lava) deep.multiplyScalar(0.55);
  const sky = new THREE.Color(pal.sky ?? 0xc7ebe0);
  const foam = new THREE.Color(lava ? (pal.foam ?? 0xffd27a) : 0xf4fbff);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: waterClock,
      uShallow: { value: shallow },
      uDeep: { value: deep },
      uSky: { value: sky },
      uFoam: { value: foam },
      uAmp: { value: lava ? 0.012 : 0.03 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uAmp;
      attribute vec3 color;
      varying float vShore;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vShore = color.r;
        vec3 p = position;
        float w1 = sin(p.x * 0.33 + uTime * 0.75);
        float w2 = sin(p.z * 0.21 - uTime * 0.55);
        p.y += (w1 * 0.65 + w2 * 0.45) * uAmp * (1.0 - vShore);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vN = normalize(vec3(-cos(p.x * 0.33 + uTime * 0.75) * uAmp, 1.0, -cos(p.z * 0.21 - uTime * 0.55) * uAmp));
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uFoam;
      uniform float uTime;
      varying float vShore;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        float deep = smoothstep(0.05, 0.72, 1.0 - vShore);
        vec3 col = mix(uShallow, uDeep, deep);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(normalize(vN), viewDir), 0.0, 1.0), 3.0);
        col = mix(col, uSky, fres * 0.38);
        float band = smoothstep(0.28, 0.55, vShore) * (1.0 - smoothstep(0.55, 0.82, vShore));
        float move = 0.5 + 0.5 * sin(vWorld.x * 1.6 + vWorld.z * 1.15 - uTime * 1.3);
        col = mix(col, uFoam, band * (0.35 + 0.65 * move));
        gl_FragColor = vec4(col, 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.2;
  mesh.name = 'water';
  mesh.userData.noOutline = true;
  mesh.renderOrder = 2;
  return mesh;
}

const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// One heightmapped mesh. The play floor keeps the terrace heights the units
// stand on. Hills and the rounded shore are presentation only.
export function buildSmoothTerrain(map) {
  const N = map.size;
  const SUB = 2;
  const G = N * SUB;
  const V = G + 1;
  const blur = (classify) => {
    const src = new Float32Array(N * N);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) src[z * N + x] = classify(x, z);
    }
    const dst = new Float32Array(N * N);
    const R = 2;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        let acc = 0;
        let w = 0;
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const tx = x + dx;
            const tz = z + dz;
            if (!map.inBounds(tx, tz)) continue;
            const wt = 1 / (1 + dx * dx + dz * dz);
            acc += src[tz * N + tx] * wt;
            w += wt;
          }
        }
        dst[z * N + x] = w ? acc / w : 0;
      }
    }
    return dst;
  };
  const sample = (grid, x, z) => {
    const fx = Math.max(0, Math.min(N - 1.001, x - 0.5));
    const fz = Math.max(0, Math.min(N - 1.001, z - 0.5));
    const x0 = fx | 0;
    const z0 = fz | 0;
    const tx = fx - x0;
    const tz = fz - z0;
    const i = z0 * N + x0;
    return grid[i] * (1 - tx) * (1 - tz) + grid[i + 1] * tx * (1 - tz)
      + grid[i + N] * (1 - tx) * tz + grid[i + N + 1] * tx * tz;
  };
  const isW = (x, z) => (map.inBounds(x, z) && map.tiles[map.idx(x, z)] === TILE.WATER ? 1 : 0);
  const water = blur(isW);
  const rockM = blur((x, z) => (map.inBounds(x, z) && map.tiles[map.idx(x, z)] === TILE.MOUNTAIN ? 1 : 0));
  const sandM = blur((x, z) => {
    if (!map.inBounds(x, z)) return 0;
    const t = map.tiles[map.idx(x, z)];
    return t === TILE.SAND || t === TILE.WATER ? 1 : 0;
  });
  const dryM = blur((x, z) => (map.inBounds(x, z) && map.tiles[map.idx(x, z)] === TILE.FOREST ? 1 : 0));
  const noise = makeNoise(makeRNG((((map.seed | 0) * 13 + 7) >>> 0) || 1));
  const sites = map.sites || [];
  const pads = sites.map((s) => ({
    x: s.x, z: s.z,
    r: s.rim ? rimMaxRadius(s.rim) + 6 : 28,
  }));
  const inCity = (x, z) => pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r);
  const nearest = (x, z) => {
    let best = 1e9;
    for (const s of sites) best = Math.min(best, Math.hypot(x - s.x, z - s.z));
    return best;
  };
  const heights = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = i / SUB;
      const z = j / SUB;
      const w = sample(water, x, z);
      let hill = 0;
      if (w < 0.22) {
        const dist = nearest(x, z);
        let mask = smoothstep(30, 62, dist);
        const tx = x | 0;
        const tz = z | 0;
        if (map.inBounds(tx, tz)) {
          const id = map.idx(tx, tz);
          const tile = map.tiles[id];
          if (tile === TILE.PATH || tile === TILE.WATER || (map.swRoad && map.swRoad[id])) mask = 0;
        }
        const n = noise(x * 0.018, z * 0.018, 3) - 0.48;
        hill = Math.max(-0.28, Math.min(1.45, n * 3.1)) * mask;
      }
      const land = map.groundY(x, z) + hill;
      // The city pad, including its rampart, stays at the terrace height.
      // Only the open coast sinks into the water, and it does so on a curve.
      const shore = inCity(x, z) ? smoothstep(0.78, 0.95, w) * 0.2 : smoothstep(0.16, 0.55, w);
      heights[j * V + i] = land * (1 - shore) + (-0.4) * shore;
    }
  }
  const rounded = new Float32Array(heights.length);
  const BR = 5;
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const id = j * V + i;
      if (heights[id] < -0.12) { rounded[id] = heights[id]; continue; }
      let acc = 0;
      let wt = 0;
      for (let dz = -BR; dz <= BR; dz++) {
        for (let dx = -BR; dx <= BR; dx++) {
          const ii = Math.max(0, Math.min(G, i + dx));
          const jj = Math.max(0, Math.min(G, j + dz));
          const h = heights[jj * V + ii];
          if (h < -0.2) continue;
          const wgt = 1 / (1 + dx * dx + dz * dz);
          acc += h * wgt;
          wt += wgt;
        }
      }
      rounded[id] = wt ? acc / wt : heights[id];
    }
  }
  heights.set(rounded);
  map._visualH = { data: heights, sub: SUB, n: G };
  const meadow = new THREE.Color(map.theme?.palette?.grass ?? 0x2f7d66);
  const dry = meadow.clone().lerp(new THREE.Color(map.theme?.palette?.sand ?? 0xcbb892), 0.42);
  const dirt = new THREE.Color(map.theme?.palette?.path ?? 0xb07a4f).lerp(new THREE.Color(map.theme?.palette?.sand ?? 0xcbb892), 0.25);
  const rock = new THREE.Color(map.theme?.palette?.mountain ?? 0xe3dcc2);
  const sand = new THREE.Color(map.isLava && map.isLava() ? 0x4a2a18 : (map.theme?.palette?.sand ?? 0xcbb892));
  const cols = new Float32Array(V * V * 3);
  const tmp = new THREE.Color();
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = i / SUB;
      const z = j / SUB;
      const h = heights[j * V + i];
      const i1 = Math.min(G, i + 1);
      const j1 = Math.min(G, j + 1);
      const slope = Math.max(
        Math.abs(h - heights[j * V + i1]),
        Math.abs(h - heights[j1 * V + i]),
      ) * SUB;
      const w = sample(water, x, z);
      const speckle = noise(x * 0.07, z * 0.07, 2);
      tmp.copy(meadow);
      tmp.lerp(dry, Math.min(1, sample(dryM, x, z) + speckle * 0.35));
      tmp.lerp(sand, Math.min(1, sample(sandM, x, z) * 0.85 + smoothstep(0.12, 0.4, w)));
      tmp.lerp(dirt, sample(water, x, z) > 0.5 ? 0 : speckle * 0.08);
      tmp.lerp(rock, Math.max(sample(rockM, x, z), smoothstep(0.45, 1.25, slope)));
      if (h < -0.05) tmp.lerp(sand, 0.5);
      const o = (j * V + i) * 3;
      cols[o] = tmp.r;
      cols[o + 1] = tmp.g;
      cols[o + 2] = tmp.b;
    }
  }
  const pos = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const o = (j * V + i) * 3;
      pos[o] = i / SUB;
      pos[o + 1] = heights[j * V + i];
      pos[o + 2] = j / SUB;
    }
  }
  const idx = new Uint32Array(G * G * 6);
  let k = 0;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const a = j * V + i;
      idx[k++] = a;
      idx[k++] = a + V;
      idx[k++] = a + 1;
      idx[k++] = a + 1;
      idx[k++] = a + V;
      idx[k++] = a + V + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i);
    const ny = nrm.getY(i) * 0.72 + 0.28;
    const nz = nrm.getZ(i);
    const L = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / L, ny / L, nz / L);
  }
  nrm.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, toyMat({ vertexColors: true, flatShading: false }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildGroundDetail(map) {
  const g = new THREE.Group();
  g.name = 'ground-detail';
  const grassP = propRecord('grass');
  const flower = propRecord('flower_yellowA');
  const pebble = propRecord('rock_smallA');
  if (!grassP && !flower && !pebble) return g;
  const rng = makeRNG((((map.seed | 0) * 19 + 5) >>> 0) || 1);
  const N = map.size;
  const tufts = [];
  const blooms = [];
  const pebs = [];
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  const rockHex = map.theme?.palette?.mountain ?? 0xcbb892;
  for (let z = 2; z < N - 2; z += 2) {
    for (let x = 2; x < N - 2; x += 2) {
      const id = map.idx(x, z);
      const t = map.tiles[id];
      if (t === TILE.WATER || t === TILE.MOUNTAIN || t === TILE.PATH) continue;
      if (map.swRoad && map.swRoad[id]) continue;
      if (rng() > 0.2) continue;
      const px = x + rng();
      const pz = z + rng();
      const y = map.groundY(px, pz);
      if (y < 0.04) continue;
      if (tufts.length < 1100 && rng() < 0.72) tufts.push({ x: px, y, z: pz, h: 0.26 + rng() * 0.14, ry: rng() * 6 });
      else if (blooms.length < 260) blooms.push({ x: px, y, z: pz, h: 0.4, ry: rng() * 6 });
      if (pebs.length < 380 && rng() < 0.16) {
        pebs.push({ x: px + (rng() - 0.5), y, z: pz + (rng() - 0.5), h: 0.1 + rng() * 0.06, ry: rng() * 6 });
      }
    }
  }
  if (grassP) placeProp(g, grassP, tufts, () => grassHex, { cast: false });
  if (flower) placeProp(g, flower, blooms, (role) => (role === 'accent' ? 0xf2c14e : grassHex), { cast: false });
  if (pebble) placeProp(g, pebble, pebs, (role) => (role === 'foliage' ? grassHex : rockHex), { cast: false });
  return g;
}
