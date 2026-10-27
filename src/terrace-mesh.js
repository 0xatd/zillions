// Terraced-landform rendering helpers (presentation only).
//
// tileCorners: per-tile corner heights. On the terraced landform a tile only
// blends with neighbours on its own level, so a terrace step stays a sheer
// face instead of a one-tile smear of slope. Off the landform the shared
// corners stand, except where a corner touches a ledge tile.
import * as THREE from 'three';
import { TILE } from './config.js';

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
  return out;
}

// Strata skirt: a sheer rock face wherever two neighbouring tiles disagree on
// the height of their shared edge, banded light/dark every 0.3 units so a
// cliff reads as layered rock from the game camera, with a dark foot.
export function cliffSkirt(map, tileCH, rockHex, grassHex) {
  if (!tileCH) return null;
  const N = map.size;
  const pos = [], col = [];
  // Warm the map's rock toward sandstone so a face reads as cliff, not as a
  // shadow, from the near top-down camera.
  const base = new THREE.Color(rockHex).lerp(new THREE.Color(0xc9b48e), 0.45);
  const bands = [1.12, 0.94, 1.05, 0.86, 1.0, 0.9].map((m) => base.clone().multiplyScalar(m));
  const foot = base.clone().multiplyScalar(0.62);
  const turf = new THREE.Color(grassHex || 0x5a8a3c).multiplyScalar(0.78);
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
      const i = (z * N + x) * 4;
      const full = map.ledgeW[z * N + x] >= 0.999;
      if (x + 1 < N && full && map.ledgeW[z * N + x + 1] >= 0.999) {
        const j = (z * N + x + 1) * 4;
        lit = 0.78;
        face(x + 1, z, x + 1, z + 1, tileCH[i + 1], tileCH[i + 3], tileCH[j], tileCH[j + 2]);
      }
      if (z + 1 < N && full && map.ledgeW[(z + 1) * N + x] >= 0.999) {
        const j = ((z + 1) * N + x) * 4;
        lit = 0.92;
        face(x, z + 1, x + 1, z + 1, tileCH[i + 2], tileCH[i + 3], tileCH[j], tileCH[j + 1]);
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
  return (tileCH[i] * (1 - fx) + tileCH[i + 1] * fx) * (1 - fz) + (tileCH[i + 2] * (1 - fx) + tileCH[i + 3] * fx) * fz;
}
