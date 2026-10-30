// Forest masses, chunky rocks, worn roads and shore foam. Presentation only:
// nothing here writes a tile or reads the simulation random source.
import * as THREE from 'three';
import { TILE } from './config.js';
import { toyMat } from './toy-style.js';
import { makeRNG } from './utils.js';
import {
  makePineGeometry, makeLollipopGeometry, makeBushGeometry, makeTrunkGeometry, makeBoulderGeometry,
} from './toy-props.js';

const CHUNK = 32;

function chunked(group, geometry, items, { vertexColors = true, color = 0xffffff, cast = true, flat = false } = {}) {
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
      : { color, flatShading: flat });
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
      if (vertexColors && it.color !== undefined) {
        c.set(it.color);
        mesh.setColorAt(i, c);
      }
    });
    if (vertexColors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
  chunked(g, makePineGeometry(), pines);
  chunked(g, makeLollipopGeometry(), lollis);
  chunked(g, makeBushGeometry(), bushes, { cast: true });
  chunked(g, makeTrunkGeometry(), trunks, { vertexColors: false, color: 0x6a4a32, cast: true });
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
  for (let v = 0; v < 4; v++) chunked(g, makeBoulderGeometry(v), lists[v]);
  return g;
}

function ribbon(map, pts, widthAt, lift, color) {
  if (pts.length < 2) return null;
  const pos = [];
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz;
    const nz = dx;
    const w = widthAt(i) / 2;
    const wob = Math.sin(i * 0.85 + pts[0][0] * 0.3) * 0.18;
    const x = pts[i][0] + nx * wob;
    const z = pts[i][1] + nz * wob;
    left.push([x + nx * w, z + nz * w]);
    right.push([x - nx * w, z - nz * w]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const quad = [left[i], right[i], right[i + 1], left[i + 1]];
    const y = (vx, vz) => map.groundY(vx, vz) + lift;
    const tri = [0, 1, 2, 0, 2, 3];
    for (const k of tri) {
      const [vx, vz] = quad[k];
      pos.push(vx, y(vx, vz), vz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const upN = geo.attributes.normal;
  for (let i = 0; i < upN.count; i++) upN.setXYZ(i, 0, 1, 0);
  const mat = toyMat({
    color, side: THREE.DoubleSide, flatShading: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
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
  const pathHex = map.theme?.palette?.path ?? 0xb07a4f;
  const grassHex = map.theme?.palette?.grass ?? 0x2f7d66;
  const edge = new THREE.Color(pathHex).lerp(new THREE.Color(grassHex), 0.42).getHex();
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!isP(x, z) || seen[map.idx(x, z)]) continue;
      const pts = [];
      const start = neighbours(x, z).find(([dx, dz]) => seen[map.idx(x + dx, z + dz)]);
      if (start) pts.push([x + start[0] + 0.5, z + start[1] + 0.5]);
      let cx = x;
      let cz = z;
      let px = -999;
      let pz = -999;
      while (map.inBounds(cx, cz) && isP(cx, cz) && !seen[map.idx(cx, cz)]) {
        seen[map.idx(cx, cz)] = 1;
        pts.push([cx + 0.5, cz + 0.5]);
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
      if (pts.length < 2) continue;
      const widthAt = (i) => 1.35 + 0.45 * (0.5 + 0.5 * Math.sin(i * 0.7 + pts[0][0]));
      const lip = ribbon(map, pts, (i) => widthAt(i) * 1.38, 0.02, edge);
      const bed = ribbon(map, pts, widthAt, 0.045, pathHex);
      if (lip) g.add(lip);
      if (bed) g.add(bed);
    }
  }
  return g;
}

export function buildFoamGroup(map) {
  const g = new THREE.Group();
  g.name = 'foam';
  const N = map.size;
  const pos = [];
  const y = map.isLava && map.isLava() ? -0.02 : 0.03;
  const land = (x, z) => map.inBounds(x, z) && map.tiles[map.idx(x, z)] !== TILE.WATER;
  const edge = (x0, z0, x1, z1) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * 0.16;
    const nz = dx / L * 0.16;
    const quad = [
      [x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(quad[k][0], y, quad[k][1]);
  };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (map.tiles[map.idx(x, z)] !== TILE.WATER) continue;
      if (land(x + 1, z)) edge(x + 1, z, x + 1, z + 1);
      if (land(x, z + 1)) edge(x, z + 1, x + 1, z + 1);
    }
  }
  if (!pos.length) return g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: map.theme?.palette?.foam ?? 0xffffff,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noOutline = true;
  mesh.receiveShadow = false;
  g.add(mesh);
  return g;
}
