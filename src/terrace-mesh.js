// Terraced-landform rendering helpers (presentation only).
//
// tileCorners: per-tile corner heights. On the terraced landform a tile only
// blends with neighbours on its own level, so a terrace step stays a sheer
// face instead of a one-tile smear of slope. Off the landform the shared
// corners stand, except where a corner touches a ledge tile.
import * as THREE from 'three';
import { TILE, TILE_INFO } from './config.js';

const SAME_LEVEL = 0.8;
const TILE_MOUNTAIN = TILE.MOUNTAIN;

export function tileCorners(map, cornerH, cw) {
  if (!map.ledgeW) return null;
  const N = map.size;
  const out = new Float32Array(N * N * 4);
  const th = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) th[i] = map.heightAt(i % N, (i / N) | 0);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x, hT = th[i];
      // Rock on the landform is a flat-topped block: its faces stay sheer and
      // nothing slants into a shard. Ground blends only with ground.
      const rock = map.tiles[i] === TILE_MOUNTAIN && map.ledgeW[i] >= 0.999;
      if (rock) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = hT; continue; }
      for (let c = 0; c < 4; c++) {
        const qx = x + (c & 1), qz = z + (c >> 1);
        // Only tiles fully on the landform split from their neighbours; the
        // fade-out ring and the country beyond share corners (no seams).
        if (map.ledgeW[i] < 0.999) { out[i * 4 + c] = cornerH[qz * cw + qx]; continue; }
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const tx = qx + dx, tz = qz + dz;
            if (!map.inBounds(tx, tz)) continue;
            const hh = th[tz * N + tx];
            if (Math.abs(hh - hT) > SAME_LEVEL) continue;
            if (map.tiles[tz * N + tx] === TILE_MOUNTAIN && map.ledgeW[tz * N + tx] >= 0.999) continue;
            sum += hh; n++;
          }
        }
        out[i * 4 + c] = n ? sum / n : hT;
      }
    }
  }
  chamferSteps(map, th, out);
  return out;
}

// Chamfered steps (presentation only). The landform is drawn on the tile
// grid, so a rim that runs on the diagonal comes out as a staircase of
// one-tile notches. A flat rock block with lower ground on two adjacent
// sides (and on the diagonal between them) has that outer corner cut off:
// the tile splits along its diagonal, the cut half drops to the ground
// below and a sheer face runs along the cut. Successive notches line up,
// so the stair becomes one straight cliff. Rock is never walkable, so the
// 2D sim is untouched. out.cut[i] = cut corner (0..3, bit0 = +x, bit1 = +z)
// or -1; out.cutH[i*3..] = ground heights at the cut corner, then at its
// x-adjacent and z-adjacent corners.
function chamferSteps(map, th, out) {
  const N = map.size;
  const cut = new Int8Array(N * N).fill(-1);
  const cutH = new Float32Array(N * N * 3);
  const full = (x, z) => map.inBounds(x, z) && map.ledgeW[z * N + x] >= 0.999;
  const lower = (x, z, h) => full(x, z) && th[z * N + x] < h - SAME_LEVEL;
  const level = (x, z, h) => !map.inBounds(x, z) || th[z * N + x] >= h - SAME_LEVEL;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (TILE_INFO[map.tiles[i]].walk || map.ledgeW[i] < 0.999) continue;
      const h = th[i];
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1, sz = c & 2 ? 1 : -1;
        if (!lower(x + sx, z, h) || !lower(x, z + sz, h) || !lower(x + sx, z + sz, h)) continue;
        if (!level(x - sx, z, h) || !level(x, z - sz, h)) continue;
        const cx = c & 1, cz = c >> 1;
        const A = (z * N + x + sx) * 4, B = ((z + sz) * N + x) * 4;
        cut[i] = c;
        // Corner (cx, cz) of this tile is corner (1-cx, cz) of A; corner
        // (1-cx, cz) of this tile is corner (1-cx, 1-cz) of B; corner
        // (cx, 1-cz) of this tile is corner (1-cx, 1-cz) of A.
        cutH[i * 3] = out[A + (1 - cx) + 2 * cz];
        cutH[i * 3 + 1] = out[B + (1 - cx) + 2 * (1 - cz)];
        cutH[i * 3 + 2] = out[A + (1 - cx) + 2 * (1 - cz)];
        break;
      }
    }
  }
  out.cut = cut;
  out.cutH = cutH;
}

// Height of tile i's corner c as seen along one of its edges (e = the other
// corner of that edge). On a chamfered tile the two edges that meet at the
// cut corner belong to the dropped half.
function edgeH(tileCH, i, c, e) {
  const k = tileCH.cut ? tileCH.cut[i] : -1;
  if (k < 0 || (c !== k && e !== k)) return tileCH[i * 4 + c];
  if (c === k) return tileCH.cutH[i * 3];
  // c is adjacent to the cut corner: x-adjacent differs in bit 0.
  return (c ^ k) === 1 ? tileCH.cutH[i * 3 + 1] : tileCH.cutH[i * 3 + 2];
}

// The two triangles of tile (x, z) as [x, z, y] vertex triples, honouring
// a chamfer. Shared by the terrain mesh and tileGroundY.
export function tileTris(map, tileCH, x, z) {
  const N = map.size, i = z * N + x, b = i * 4;
  const k = tileCH.cut ? tileCH.cut[i] : -1;
  const P = (ox, oz, y) => [x + ox, z + oz, y];
  if (k < 0) {
    return [
      [P(0, 0, tileCH[b]), P(0, 1, tileCH[b + 2]), P(1, 0, tileCH[b + 1])],
      [P(1, 0, tileCH[b + 1]), P(0, 1, tileCH[b + 2]), P(1, 1, tileCH[b + 3])],
    ];
  }
  const cx = k & 1, cz = k >> 1;
  const c0 = P(cx, cz, tileCH.cutH[i * 3]);
  const cX = P(1 - cx, cz, tileCH.cutH[i * 3 + 1]);
  const cZ = P(cx, 1 - cz, tileCH.cutH[i * 3 + 2]);
  const at = (ox, oz) => P(ox, oz, tileCH[b + ox + 2 * oz]);
  const top = [at(1 - cx, 1 - cz), at(1 - cx, cz), at(cx, 1 - cz)];
  const low = [c0, cX, cZ];
  // Wind both counter-clockwise seen from above (+y normal).
  const up = (t) => {
    const [a, b2, c] = t;
    const ny = (b2[1] - a[1]) * (c[0] - a[0]) - (b2[0] - a[0]) * (c[1] - a[1]);
    return ny >= 0 ? t : [a, c, b2];
  };
  return [up(top), up(low)];
}

// Strata skirt: a sheer rock face wherever two neighbouring tiles disagree on
// the height of their shared edge, banded light/dark every 0.3 units so a
// cliff reads as layered rock from the game camera, with a dark foot.
export function cliffSkirt(map, tileCH, rockHex, grassHex, shadowHex) {
  if (!tileCH) return null;
  const N = map.size;
  const pos = [], col = [];
  // Rock tone: the map's own stone pushed into a deep, saturated mid-tone so
  // a face reads as rock against both a snowfield and a violet moor (a pale
  // stone tone washed the faces out to card). Hue comes from the palette;
  // near-grey stone borrows the palette's shadow hue so it stays cool slate.
  const base = new THREE.Color(rockHex);
  const S = THREE.SRGBColorSpace;
  const hsl = {}; base.getHSL(hsl, S);
  if (hsl.s < 0.12 && shadowHex !== undefined) {
    const sh = {}; new THREE.Color(shadowHex).getHSL(sh, S);
    hsl.h = sh.h * 0.4 + 0.6 * 0.6; hsl.s = Math.max(hsl.s, 0.2);
  }
  base.setHSL(hsl.h, Math.min(0.42, Math.max(0.22, hsl.s * 1.25)), Math.min(0.42, Math.max(0.3, hsl.l * 0.55)), S);
  const bands = [1.2, 0.96, 1.1, 0.86, 1.04, 0.92].map((m) => base.clone().multiplyScalar(m));
  const foot = base.clone().multiplyScalar(0.7);
  const turf = new THREE.Color(grassHex || 0x5a8a3c).multiplyScalar(0.86);
  const TURF = 0.14;
  const STEP = 0.3;
  // Unlit, with the light baked per face direction: a vertical face under a
  // high sun is otherwise a black slot from the game camera.
  let lit = 1;
  const face = (ax, az, bx, bz, a0, a1, b0, b1) => {
    const lo0 = Math.min(a0, b0), hi0 = Math.max(a0, b0);
    const lo1 = Math.min(a1, b1), hi1 = Math.max(a1, b1);
    if (hi0 - lo0 < 0.04 && hi1 - lo1 < 0.04) return;
    const y0 = Math.min(lo0, lo1), y1 = Math.max(hi0, hi1);
    const emit = (ya, yb, c) => {
      const e0a = Math.min(Math.max(ya, lo0), hi0), e0b = Math.min(Math.max(yb, lo0), hi0);
      const e1a = Math.min(Math.max(ya, lo1), hi1), e1b = Math.min(Math.max(yb, lo1), hi1);
      if (e0b - e0a < 1e-4 && e1b - e1a < 1e-4) return;
      const quad = [[ax, e0a, az], [bx, e1a, bz], [bx, e1b, bz], [ax, e0a, az], [bx, e1b, bz], [ax, e0b, az]];
      for (const v of quad) { pos.push(v[0], v[1], v[2]); col.push(c.r * lit, c.g * lit, c.b * lit); }
    };
    // A tall face wears a turf lip at the top; the rock below is banded.
    const top = y1 - y0 > 0.4 ? y1 - TURF : y1;
    if (top < y1) emit(top, y1, turf);
    for (let k = Math.floor(y0 / STEP); k * STEP < top; k++) {
      const ya = k * STEP, yb = Math.min(top, ya + STEP);
      emit(ya, yb, ya < y0 + 0.1 ? foot : bands[((k % 6) + 6) % 6]);
    }
  };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const t = z * N + x;
      const full = map.ledgeW[t] >= 0.999;
      if (x + 1 < N && full && map.ledgeW[t + 1] >= 0.999) {
        lit = 0.8;
        face(x + 1, z, x + 1, z + 1, edgeH(tileCH, t, 1, 3), edgeH(tileCH, t, 3, 1), edgeH(tileCH, t + 1, 0, 2), edgeH(tileCH, t + 1, 2, 0));
      }
      if (z + 1 < N && full && map.ledgeW[t + N] >= 0.999) {
        lit = 0.94;
        face(x, z + 1, x + 1, z + 1, edgeH(tileCH, t, 2, 3), edgeH(tileCH, t, 3, 2), edgeH(tileCH, t + N, 0, 1), edgeH(tileCH, t + N, 1, 0));
      }
      // The chamfer face along the cut diagonal.
      const k = tileCH.cut ? tileCH.cut[t] : -1;
      if (k >= 0) {
        const cx = k & 1, cz = k >> 1;
        lit = 0.87;
        face(x + 1 - cx, z + cz, x + cx, z + 1 - cz, tileCH[t * 4 + (1 - cx) + 2 * cz], tileCH[t * 4 + cx + 2 * (1 - cz)], tileCH.cutH[t * 3 + 1], tileCH.cutH[t * 3 + 2]);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  // Faces cast the drop shadow onto the terrace below; they do not receive
  // (a sheer face self-shadows to black under the steep sun).
  mesh.receiveShadow = false;
  mesh.castShadow = true;
  mesh.name = 'cliff-strata';
  return mesh;
}

// Smooth ground height from per-tile corners (bilinear inside the tile).
export function tileGroundY(map, tileCH, x, z) {
  const N = map.size;
  const tx = Math.min(N - 1, Math.max(0, Math.floor(x))), tz = Math.min(N - 1, Math.max(0, Math.floor(z)));
  const fx = Math.min(1, Math.max(0, x - tx)), fz = Math.min(1, Math.max(0, z - tz));
  const i = (tz * N + tx) * 4;
  const k = tileCH.cut ? tileCH.cut[tz * N + tx] : -1;
  if (k >= 0) {
    // Chamfered rock: the cut half is the ground below, the rest the block.
    const cx = k & 1, cz = k >> 1;
    const ux = cx ? fx : 1 - fx, uz = cz ? fz : 1 - fz;
    if (ux + uz > 1) {
      const H = tileCH.cutH, j = (tz * N + tx) * 3;
      return (H[j] + H[j + 1] + H[j + 2]) / 3;
    }
  }
  return (tileCH[i] * (1 - fx) + tileCH[i + 1] * fx) * (1 - fz) + (tileCH[i + 2] * (1 - fx) + tileCH[i + 3] * fx) * fz;
}
