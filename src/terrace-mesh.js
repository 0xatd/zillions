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
      if (rock) {
        // A switchback kerb steps a fraction of a tile at a time. Blend those
        // rock tops together so the wall slopes; a real terrace (neighbours
        // either level with it or a full cliff below) stays a flat block.
        let stepped = false;
        for (let c = 0; c < 4; c++) {
          const qx = x + (c & 1), qz = z + (c >> 1);
          let sum = hT, n = 1;
          for (let dz = -1; dz <= 0; dz++) {
            for (let dx = -1; dx <= 0; dx++) {
              const tx = qx + dx, tz = qz + dz;
              if ((tx === x && tz === z) || !map.inBounds(tx, tz)) continue;
              if (map.tiles[tz * N + tx] !== TILE_MOUNTAIN || map.ledgeW[tz * N + tx] < 0.999) continue;
              const d = Math.abs(th[tz * N + tx] - hT);
              if (d < 0.05 || d > 0.55) continue;
              sum += th[tz * N + tx]; n++; stepped = true;
            }
          }
          out[i * 4 + c] = sum / n;
        }
        if (!stepped) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = out[i * 4 + 3] = hT;
        continue;
      }
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
// Walkable terrace tiles get a half-depth cut: the notch corner is trimmed
// back to the edge midpoints (out.cutS[i] = 0.5, rock = 1), so a staircase
// rim beside a walkable shelf reads as a run of bevels instead of square
// teeth. Figures keep sampling the tile's own top there (see tileGroundY),
// so nobody sinks; the trimmed corner is under a quarter of a figure's
// footprint from the edge it already overhangs.
//
// A 2:1 diagonal (two tiles along the tread, one on the riser) does not
// collapse under that corner cut: the outer tile miters and the inner tile
// stays a square step. Where the 2-then-1 pattern repeats, both tiles are
// clipped to the straight line through the inner corners (out.clipOn). The
// same rule catches a rock lip that sits only a hand's breadth above a
// walkable shelf — the L4 gate crest — so those square teeth miter too.
const WALK_CUT = 0.5;
const LIP = 0.16;
const CORNER_XZ = [[0, 0], [1, 0], [0, 1], [1, 1]];
function chamferSteps(map, th, out) {
  const N = map.size;
  const cut = new Int8Array(N * N).fill(-1);
  const cutS = new Float32Array(N * N);
  const cutH = new Float32Array(N * N * 3);
  const clip = new Float32Array(N * N * 4);
  const clipOn = new Uint8Array(N * N);
  const clipSign = new Float32Array(N * N);
  const lowY = new Float32Array(N * N);
  const full = (x, z) => map.inBounds(x, z) && map.ledgeW[z * N + x] >= 0.999;
  const shelf = (x, z) => {
    const t = map.tiles[z * N + x];
    return !!TILE_INFO[t].walk || t === TILE.FOREST;
  };
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (map.ledgeW[i] < 0.999 || clipOn[i]) continue;
      const walk = !!TILE_INFO[map.tiles[i]].walk;
      const rock = map.tiles[i] === TILE_MOUNTAIN;
      const h = th[i];
      // A rock crest a short step above walkable (or wooded) shelf ground
      // still reads as a square tooth. Big terrace drops count everywhere.
      const lower = (tx, tz) => {
        if (!full(tx, tz)) return false;
        const d = h - th[tz * N + tx];
        if (d > SAME_LEVEL) return true;
        return rock && d > LIP && shelf(tx, tz);
      };
      const level = (tx, tz) => !map.inBounds(tx, tz) || th[tz * N + tx] >= h - SAME_LEVEL;
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1, sz = c & 2 ? 1 : -1;
        if (!lower(x + sx, z) || !lower(x, z + sz) || !lower(x + sx, z + sz)) continue;
        if (!level(x - sx, z) || !level(x, z - sz)) continue;
        const axis = !walk && rock ? slope21(x, z, sx, sz) : null;
        if (axis) {
          const tx = axis === 'x' ? x - sx : x, tz = axis === 'z' ? z - sz : z;
          if (!clipOn[tz * N + tx]) { clipPair(x, z, sx, sz, axis); break; }
        }
        const cx = c & 1, cz = c >> 1;
        const A = (z * N + x + sx) * 4, B = ((z + sz) * N + x) * 4;
        cut[i] = c;
        cutS[i] = walk ? WALK_CUT : 1;
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
  // A 2:1 tread: the tail sits one step back along the long axis, and the
  // same corner repeats a step further on. A rectangular corner has the tail
  // but not the repeat, and keeps its single miter.
  function slope21(x, z, sx, sz) {
    const h = th[z * N + x];
    const low = (tx, tz) => {
      if (!full(tx, tz)) return false;
      const d = h - th[tz * N + tx];
      if (d > SAME_LEVEL) return true;
      return d > LIP && shelf(tx, tz);
    };
    const rockSame = (tx, tz) => full(tx, tz) && map.tiles[tz * N + tx] === TILE_MOUNTAIN && Math.abs(th[tz * N + tx] - h) <= 0.2;
    const headLike = (hx, hz) => rockSame(hx, hz) && low(hx + sx, hz) && low(hx, hz + sz) && low(hx + sx, hz + sz);
    const axisOk = (axis) => {
      const tx = axis === 'x' ? x - sx : x, tz = axis === 'z' ? z - sz : z;
      if (!rockSame(tx, tz)) return false;
      if (axis === 'x' ? !low(tx, tz + sz) : !low(tx + sx, tz)) return false;
      if (axis === 'x') return headLike(x - 2 * sx, z + sz) || headLike(x + 2 * sx, z - sz);
      return headLike(x + sx, z - 2 * sz) || headLike(x - sx, z + 2 * sz);
    };
    if (axisOk('x')) return 'x';
    if (axisOk('z')) return 'z';
    return null;
  }
  function clipPair(x, z, sx, sz, axis) {
    const h = th[z * N + x];
    const uv = (u, v) => [sx > 0 ? u : 1 - u, sz > 0 ? v : 1 - v];
    const put = (tx, tz, u0, v0, u1, v1) => {
      const i = tz * N + tx;
      if (clipOn[i] || !map.inBounds(tx, tz)) return;
      const a = uv(u0, v0), b = uv(u1, v1);
      clip[i * 4] = a[0]; clip[i * 4 + 1] = a[1]; clip[i * 4 + 2] = b[0]; clip[i * 4 + 3] = b[1];
      clipOn[i] = 1;
      const rx = sx > 0 ? 1 : 0, rz = sz > 0 ? 1 : 0;
      clipSign[i] = Math.sign((b[0] - a[0]) * (rz - a[1]) - (b[1] - a[1]) * (rx - a[0])) || 1;
      let low = Infinity;
      for (let cz = 0; cz <= 1; cz++) {
        for (let cx = 0; cx <= 1; cx++) {
          const cross = (b[0] - a[0]) * (cz - a[1]) - (b[1] - a[1]) * (cx - a[0]);
          if (cross * clipSign[i] <= 1e-4) continue;
          const y = lipHeight(tx, tz, tx + cx, tz + cz, h);
          if (y < h - 0.04) low = Math.min(low, y);
        }
      }
      lowY[i] = Number.isFinite(low) ? low : h;
      cut[i] = (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0);
      cutS[i] = 1;
    };
    const tx = axis === 'x' ? x - sx : x, tz = axis === 'z' ? z - sz : z;
    if (axis === 'x') { put(x, z, 1, 0, 0, 0.5); put(tx, tz, 1, 0.5, 0, 1); }
    else { put(x, z, 0, 1, 0.5, 0); put(tx, tz, 0.5, 1, 1, 0); }
  }
  // Height of the terrace just below this rock, at grid corner (qx, qz).
  // The nearest step wins, so a lip bevel meets the shelf and a real face
  // meets the valley.
  function lipHeight(selfX, selfZ, qx, qz, h) {
    let best = h, bestD = Infinity;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const tx = qx + dx, tz = qz + dz;
        if ((tx === selfX && tz === selfZ) || !full(tx, tz)) continue;
        const d = h - th[tz * N + tx];
        if (d <= 0.04) continue;
        if (d <= SAME_LEVEL && !(d > LIP && shelf(tx, tz))) continue;
        if (d < bestD) {
          bestD = d;
          best = out[(tz * N + tx) * 4 + (qx - tx) + 2 * (qz - tz)];
        }
      }
    }
    return best;
  }
  paveRoadNotches();
  out.cut = cut;
  out.cutS = cutS;
  out.cutH = cutH;
  out.clip = clip;
  out.clipOn = clipOn;
  out.clipSign = clipSign;
  out.lowY = lowY;

  // Grass (or path) tiles the switchback raster left inside the road: pull
  // their rendered top onto the surrounding road so the bed has no pits or
  // pillars. The sim tile stays what it was. A real drop is left alone.
  function paveRoadNotches() {
    if (!map.swRoad) return;
    const roadFill = new Uint8Array(N * N);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const i = z * N + x;
        if (!full(x, z) || map.swRoad[i] || cut[i] >= 0 || clipOn[i]) continue;
        if (!TILE_INFO[map.tiles[i]].walk) continue;
        const roads = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => map.swRoad[(z + dz) * N + x + dx]);
        if (roads.length < 3) continue;
        let sum = 0;
        for (const [dx, dz] of roads) sum += th[(z + dz) * N + x + dx];
        const avg = sum / roads.length;
        if (Math.abs(th[i] - avg) > 0.5) continue;
        for (let c = 0; c < 4; c++) {
          const qx = x + (c & 1), qz = z + (c >> 1);
          let rs = 0, rn = 0;
          for (let dz = -1; dz <= 0; dz++) {
            for (let dx = -1; dx <= 0; dx++) {
              const tx = qx + dx, tz = qz + dz;
              if (!map.inBounds(tx, tz) || !map.swRoad[tz * N + tx]) continue;
              rs += th[tz * N + tx]; rn++;
            }
          }
          out[i * 4 + c] = rn ? rs / rn : avg;
        }
        roadFill[i] = 1;
      }
    }
    out.roadFill = roadFill;
  }
}

// Height along tile i's edge from corner c (u = 0) to corner e (u = 1),
// honouring a chamfer. On a cut tile the part of each edge next to the cut
// corner (u within cutS of it) belongs to the dropped half; `side` (+1/-1)
// picks which side of that split a sample at exactly the split point takes.
function chordSide(tileCH, i, lx, lz) {
  const o = i * 4;
  const ax = tileCH.clip[o], az = tileCH.clip[o + 1], bx = tileCH.clip[o + 2], bz = tileCH.clip[o + 3];
  return ((bx - ax) * (lz - az) - (bz - az) * (lx - ax)) * tileCH.clipSign[i];
}

function edgePoint(c, e, u) {
  const [cx, cz] = CORNER_XZ[c], [ex, ez] = CORNER_XZ[e];
  return [cx + (ex - cx) * u, cz + (ez - cz) * u];
}

function edgeAt(tileCH, i, c, e, u, side = 0) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const up = lerp(tileCH[i * 4 + c], tileCH[i * 4 + e], u);
  if (tileCH.clipOn && tileCH.clipOn[i]) {
    const [lx, lz] = edgePoint(c, e, u);
    const s = chordSide(tileCH, i, lx, lz);
    if (s > 1e-4) return tileCH.lowY[i];
    if (s < -1e-4) return up;
    return side < 0 ? tileCH.lowY[i] : up;
  }
  const k = tileCH.cut ? tileCH.cut[i] : -1;
  if (k < 0 || (c !== k && e !== k)) return up;
  const S = tileCH.cutS[i] || 1;
  // distance from the cut corner along the edge, and the low ground there
  const d = c === k ? u : 1 - u;
  const other = c === k ? e : c;
  const H = tileCH.cutH, j = i * 3;
  const far = (other ^ k) === 1 ? H[j + 1] : H[j + 2];
  const inCut = side === 0 ? d <= S : (c === k ? (side < 0 ? d <= S : d < S) : (side > 0 ? d <= S : d < S));
  if (!inCut) return up;
  return lerp(H[j], far, d);
}

// Split points (fractions from c to e) of tile i's edge c->e.
function edgeSplits(tileCH, i, c, e) {
  if (tileCH.clipOn && tileCH.clipOn[i]) {
    const o = i * 4;
    const us = [];
    for (let p = 0; p < 2; p++) {
      const px = tileCH.clip[o + p * 2], pz = tileCH.clip[o + p * 2 + 1];
      const [cx, cz] = CORNER_XZ[c], [ex, ez] = CORNER_XZ[e];
      let u = null;
      if (Math.abs(cz - ez) < 1e-6 && Math.abs(pz - cz) < 1e-4) u = (px - cx) / (ex - cx || 1);
      else if (Math.abs(cx - ex) < 1e-6 && Math.abs(px - cx) < 1e-4) u = (pz - cz) / (ez - cz || 1);
      if (u !== null && u > 1e-3 && u < 1 - 1e-3) us.push(u);
    }
    return us;
  }
  const k = tileCH.cut ? tileCH.cut[i] : -1;
  if (k < 0 || (c !== k && e !== k)) return [];
  const S = tileCH.cutS[i] || 1;
  if (S >= 0.999) return [];
  return [c === k ? S : 1 - S];
}

// The two triangles of tile (x, z) as [x, z, y] vertex triples, honouring
// a chamfer. Shared by the terrain mesh and tileGroundY.
function chordTris(tileCH, i, x, z) {
  const o = i * 4;
  const ax = tileCH.clip[o], az = tileCH.clip[o + 1], bx = tileCH.clip[o + 2], bz = tileCH.clip[o + 3];
  const sign = tileCH.clipSign[i];
  const side = (px, pz) => ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) * sign;
  const high = [], low = [];
  const add = (poly, p) => {
    const last = poly[poly.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-4 && Math.abs(last[1] - p[1]) < 1e-4) return;
    poly.push(p);
  };
  const onSeg = (x0, z0, x1, z1, px, pz) => {
    if (Math.hypot(px - x0, pz - z0) < 1e-4 || Math.hypot(px - x1, pz - z1) < 1e-4) return false;
    if (Math.abs(x0 - x1) < 1e-6) {
      return Math.abs(px - x0) < 1e-4 && (pz - z0) * (pz - z1) < 0;
    }
    return Math.abs(pz - z0) < 1e-4 && (px - x0) * (px - x1) < 0;
  };
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4];
    const s0 = side(x0, z0);
    if (s0 > 1e-4) add(low, [x0, z0]);
    else if (s0 < -1e-4) add(high, [x0, z0]);
    else { add(high, [x0, z0]); add(low, [x0, z0]); }
    const hits = [[ax, az], [bx, bz]].filter(([px, pz]) => onSeg(x0, z0, x1, z1, px, pz));
    hits.sort((p, q) => Math.hypot(p[0] - x0, p[1] - z0) - Math.hypot(q[0] - x0, q[1] - z0));
    for (const p of hits) { add(high, p); add(low, p); }
  }
  const lerpH = (lx, lz) => {
    const b = i * 4;
    return (tileCH[b] * (1 - lx) + tileCH[b + 1] * lx) * (1 - lz)
      + (tileCH[b + 2] * (1 - lx) + tileCH[b + 3] * lx) * lz;
  };
  const up = (t) => {
    const [a, b2, c] = t;
    const ny = (b2[1] - a[1]) * (c[0] - a[0]) - (b2[0] - a[0]) * (c[1] - a[1]);
    return ny >= 0 ? t : [a, c, b2];
  };
  const tris = [];
  for (const [poly, lowPoly] of [[high, false], [low, true]]) {
    if (poly.length < 3) continue;
    const pts = poly.map(([lx, lz]) => [x + lx, z + lz, lowPoly ? tileCH.lowY[i] : lerpH(lx, lz)]);
    for (let k = 1; k + 1 < pts.length; k++) tris.push(up([pts[0], pts[k], pts[k + 1]]));
  }
  return tris;
}

export function tileTris(map, tileCH, x, z) {
  const N = map.size, i = z * N + x, b = i * 4;
  if (tileCH.clipOn && tileCH.clipOn[i]) return chordTris(tileCH, i, x, z);
  const k = tileCH.cut ? tileCH.cut[i] : -1;
  const P = (ox, oz, y) => [x + ox, z + oz, y];
  if (k < 0) {
    return [
      [P(0, 0, tileCH[b]), P(0, 1, tileCH[b + 2]), P(1, 0, tileCH[b + 1])],
      [P(1, 0, tileCH[b + 1]), P(0, 1, tileCH[b + 2]), P(1, 1, tileCH[b + 3])],
    ];
  }
  const cx = k & 1, cz = k >> 1;
  const S = tileCH.cutS[i] || 1;
  const H = tileCH.cutH, j = i * 3;
  const at = (ox, oz) => P(ox, oz, tileCH[b + ox + 2 * oz]);
  const lerp = (a, b2, t) => a + (b2 - a) * t;
  // Wind every triangle counter-clockwise seen from above (+y normal).
  const up = (t) => {
    const [a, b2, c] = t;
    const ny = (b2[1] - a[1]) * (c[0] - a[0]) - (b2[0] - a[0]) * (c[1] - a[1]);
    return ny >= 0 ? t : [a, c, b2];
  };
  const c0 = P(cx, cz, H[j]);
  if (S >= 0.999) {
    const cX = P(1 - cx, cz, H[j + 1]);
    const cZ = P(cx, 1 - cz, H[j + 2]);
    const top = [at(1 - cx, 1 - cz), at(1 - cx, cz), at(cx, 1 - cz)];
    return [up(top), up([c0, cX, cZ])];
  }
  // Half cut: an upper pentagon and a low corner triangle.
  const ux = cx + (1 - 2 * cx) * S, uz = cz + (1 - 2 * cz) * S;
  const hC = tileCH[b + cx + 2 * cz];
  const MXu = [x + ux, z + cz, lerp(hC, tileCH[b + (1 - cx) + 2 * cz], S)];
  const MZu = [x + cx, z + uz, lerp(hC, tileCH[b + cx + 2 * (1 - cz)], S)];
  const MXl = [x + ux, z + cz, lerp(H[j], H[j + 1], S)];
  const MZl = [x + cx, z + uz, lerp(H[j], H[j + 2], S)];
  const O = at(1 - cx, 1 - cz), CX = at(1 - cx, cz), CZ = at(cx, 1 - cz);
  return [up([O, CX, MXu]), up([O, MXu, MZu]), up([O, MZu, CZ]), up([c0, MXl, MZl])];
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
  // One shared edge, A -> B: tile t runs corner c1 -> c2 along it, its
  // neighbour nb runs d1 -> d2. A half chamfer splits an edge, so the face is
  // emitted per piece between split points.
  const edge = (ax, az, bx, bz, t, c1, c2, nb, d1, d2) => {
    const us = [0, ...edgeSplits(tileCH, t, c1, c2), ...edgeSplits(tileCH, nb, d1, d2), 1].sort((a, b) => a - b);
    for (let q = 0; q + 1 < us.length; q++) {
      const u0 = us[q], u1 = us[q + 1];
      if (u1 - u0 < 1e-4) continue;
      face(ax + (bx - ax) * u0, az + (bz - az) * u0, ax + (bx - ax) * u1, az + (bz - az) * u1,
        edgeAt(tileCH, t, c1, c2, u0, 1), edgeAt(tileCH, t, c1, c2, u1, -1),
        edgeAt(tileCH, nb, d1, d2, u0, 1), edgeAt(tileCH, nb, d1, d2, u1, -1));
    }
  };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const t = z * N + x;
      const full = map.ledgeW[t] >= 0.999;
      if (x + 1 < N && full && map.ledgeW[t + 1] >= 0.999) {
        lit = 0.8;
        edge(x + 1, z, x + 1, z + 1, t, 1, 3, t + 1, 0, 2);
      }
      if (z + 1 < N && full && map.ledgeW[t + N] >= 0.999) {
        lit = 0.94;
        edge(x, z + 1, x + 1, z + 1, t, 2, 3, t + N, 0, 1);
      }
      // The chamfer face along the cut: a 2:1 chord, or the corner diagonal.
      if (tileCH.clipOn && tileCH.clipOn[t]) {
        const o = t * 4, b = t * 4;
        const ax = tileCH.clip[o], az = tileCH.clip[o + 1], bx = tileCH.clip[o + 2], bz = tileCH.clip[o + 3];
        const hi = (lx, lz) => (tileCH[b] * (1 - lx) + tileCH[b + 1] * lx) * (1 - lz)
          + (tileCH[b + 2] * (1 - lx) + tileCH[b + 3] * lx) * lz;
        lit = 0.87;
        face(x + ax, z + az, x + bx, z + bz, hi(ax, az), hi(bx, bz), tileCH.lowY[t], tileCH.lowY[t]);
      }
      const k = tileCH.clipOn && tileCH.clipOn[t] ? -1 : (tileCH.cut ? tileCH.cut[t] : -1);
      if (k >= 0) {
        const cx = k & 1, cz = k >> 1;
        const S = tileCH.cutS[t] || 1;
        const H = tileCH.cutH, j = t * 3, b = t * 4;
        const hC = tileCH[b + cx + 2 * cz];
        const hX = tileCH[b + (1 - cx) + 2 * cz], hZ = tileCH[b + cx + 2 * (1 - cz)];
        const ux = cx + (1 - 2 * cx) * S, uz = cz + (1 - 2 * cz) * S;
        lit = 0.87;
        face(x + ux, z + cz, x + cx, z + uz,
          hC + (hX - hC) * S, hC + (hZ - hC) * S,
          H[j] + (H[j + 1] - H[j]) * S, H[j] + (H[j + 2] - H[j]) * S);
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
  const ti = tz * N + tx;
  if (tileCH.clipOn && tileCH.clipOn[ti] && (tileCH.cutS[ti] || 1) >= 0.999 && chordSide(tileCH, ti, fx, fz) > 1e-4) {
    return tileCH.lowY[ti];
  }
  const k = tileCH.cut ? tileCH.cut[ti] : -1;
  if (k >= 0 && !tileCH.clipOn?.[ti] && (tileCH.cutS[ti] || 1) >= 0.999) {
    // Chamfered rock: the cut half is the ground below, the rest the block.
    // (A walkable half cut keeps the tile's own top: figures never sink.)
    const cx = k & 1, cz = k >> 1;
    const ux = cx ? fx : 1 - fx, uz = cz ? fz : 1 - fz;
    if (ux + uz > 1) {
      const H = tileCH.cutH, j = (tz * N + tx) * 3;
      return (H[j] + H[j + 1] + H[j + 2]) / 3;
    }
  }
  return (tileCH[i] * (1 - fx) + tileCH[i + 1] * fx) * (1 - fz) + (tileCH[i + 2] * (1 - fx) + tileCH[i + 3] * fx) * fz;
}
