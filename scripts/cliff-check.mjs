// Presentation-only cliff rims: a 2:1 diagonal becomes one straight face,
// a rock lip beside a walkable shelf miters instead of leaving a square
// tooth, and a switchback notch is paved onto the road. Walkable ground
// the figures stand on keeps its own top, and no sim tile changes.
import assert from 'node:assert/strict';
import { TILE, TILE_INFO, levelById } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';
import { generatePlots } from '../src/plots.js';
import { tileCorners, tileGroundY, tileTris } from '../src/terrace-mesh.js';

const MOUNTAIN = TILE.MOUNTAIN;
const GRASS = TILE.GRASS;

function makeMap(N, paint) {
  const tiles = new Uint8Array(N * N).fill(GRASS);
  const h = new Float32Array(N * N).fill(0.05);
  const ledgeW = new Float32Array(N * N).fill(1);
  const swRoad = new Uint8Array(N * N);
  paint({ tiles, h, swRoad, N, M: MOUNTAIN, G: GRASS });
  return {
    size: N, tiles, ledgeW, swRoad,
    inBounds(x, z) { return x >= 0 && z >= 0 && x < N && z < N; },
    heightAt(x, z) { return this.inBounds(x, z) ? h[z * N + x] : 0; },
  };
}

function cornersOf(map) {
  const N = map.size, cw = N + 1;
  const cornerH = new Float32Array(cw * cw);
  return tileCorners(map, cornerH, cw);
}

function lineDeviation(points) {
  let ax = 0, az = 0;
  for (const p of points) { ax += p[0]; az += p[1]; }
  ax /= points.length; az /= points.length;
  let vx = 0, vz = 0;
  for (const p of points) { vx += p[0] - ax; vz += p[1] - az; }
  // Principal direction from the first-to-last span is enough for a straight rim.
  const dx = points[points.length - 1][0] - points[0][0];
  const dz = points[points.length - 1][1] - points[0][1];
  const L = Math.hypot(dx, dz) || 1;
  let max = 0;
  for (const p of points) {
    const d = Math.abs((p[0] - points[0][0]) * dz - (p[1] - points[0][1]) * dx) / L;
    if (d > max) max = d;
  }
  return max;
}

function chordPoints(map, tileCH) {
  const N = map.size, pts = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!tileCH.clipOn[i]) continue;
      const o = i * 4;
      pts.push([x + tileCH.clip[o], z + tileCH.clip[o + 1]]);
      pts.push([x + tileCH.clip[o + 2], z + tileCH.clip[o + 3]]);
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pts;
}

// --- 2:1 rock rim, both long-axis orientations and both signs ------------
function ramp21(N, longAxis, sx, sz) {
  return makeMap(N, ({ tiles, h, M }) => {
    const high = (x, z) => {
      // Boundary runs two tiles along `longAxis` for each step along the other.
      if (longAxis === 'x') {
        const col = sx > 0 ? x : (N - 1 - x);
        const row = sz > 0 ? z : (N - 1 - z);
        return col + 2 * row < N - 4;
      }
      const col = sx > 0 ? x : (N - 1 - x);
      const row = sz > 0 ? z : (N - 1 - z);
      return row + 2 * col < N - 4;
    };
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (!high(x, z)) continue;
        tiles[z * N + x] = M;
        h[z * N + x] = 2.32;
      }
    }
  });
}

for (const longAxis of ['x', 'z']) {
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const map = ramp21(28, longAxis, sx, sz);
      const tileCH = cornersOf(map);
      const pts = chordPoints(map, tileCH);
      assert.ok(pts.length >= 8, `2:1 ${longAxis} sx${sx} sz${sz} produced ${pts.length} chord points`);
      const dev = lineDeviation(pts);
      assert.ok(dev < 0.08, `2:1 ${longAxis} sx${sx} sz${sz} rim wanders ${dev.toFixed(3)}`);
      // The plateau interior stays high; the cut side drops to the valley.
      let highOk = 0, lowOk = 0;
      const N = map.size;
      for (let z = 3; z < N - 3; z++) {
        for (let x = 3; x < N - 3; x++) {
          const i = z * N + x;
          if (!tileCH.clipOn[i]) continue;
          const tris = tileTris(map, tileCH, x, z);
          assert.ok(tris.length >= 2, `clipped tile ${x},${z} has a top and a dropped cap`);
          for (const tri of tris) {
            for (const [px, pz, py] of tri) {
              if (py > 2) highOk++;
              if (py < 0.2) lowOk++;
            }
          }
          // A figure never stands on rock, but a sample on the kept cap must
          // not fall into the valley, and a sample on the dropped cap must.
          const gy = tileGroundY(map, tileCH, x + 0.5, z + 0.5);
          assert.ok(gy > 2 || gy < 0.3, `sample on ${x},${z} is neither cap (${gy})`);
        }
      }
      assert.ok(highOk > 0 && lowOk > 0, `2:1 ${longAxis} sx${sx} sz${sz} did not drop a cap`);
    }
  }
}

// --- a rectangular block miters its four corners and does not 2:1 them ---
{
  const map = makeMap(24, ({ tiles, h, M }) => {
    for (let z = 6; z <= 14; z++) for (let x = 6; x <= 16; x++) {
      tiles[z * 24 + x] = M; h[z * 24 + x] = 2.32;
    }
  });
  const tileCH = cornersOf(map);
  let clips = 0, miters = 0;
  for (let i = 0; i < 24 * 24; i++) {
    if (tileCH.clipOn[i]) clips++;
    else if (tileCH.cut[i] >= 0) miters++;
  }
  assert.equal(clips, 0, 'a right-angle rim is not a 2:1 diagonal');
  assert.equal(miters, 4, 'each corner of a block gets one miter');
}

// --- rock lip a hand above a walkable shelf: the square tooth is cut ------
{
  const N = 28;
  const map = makeMap(N, ({ tiles, h, M }) => {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        h[z * N + x] = 2.1;
        if (x + 2 * z < N - 4) { tiles[z * N + x] = M; h[z * N + x] = 2.32; }
      }
    }
  });
  const tileCH = cornersOf(map);
  const pts = chordPoints(map, tileCH);
  assert.ok(pts.length >= 8, 'a shelf lip on a 2:1 run is clipped');
  assert.ok(lineDeviation(pts) < 0.08, 'the shelf lip lines up');
  // Dropped caps sit on the shelf, not in a hole under it.
  let shelfCaps = 0;
  for (let i = 0; i < N * N; i++) {
    if (!tileCH.clipOn[i]) continue;
    assert.ok(tileCH.lowY[i] > 1.9 && tileCH.lowY[i] < 2.2, `lip cap height ${tileCH.lowY[i]}`);
    shelfCaps++;
  }
  assert.ok(shelfCaps > 0);
}

// --- walkable corner: figures stay on the tile top, mesh still bevels -----
{
  const map = makeMap(16, ({ tiles, h, G }) => {
    for (let z = 4; z <= 10; z++) for (let x = 4; x <= 10; x++) {
      tiles[z * 16 + x] = G; h[z * 16 + x] = 2.1;
    }
    // South-east corner of the shelf drops to the valley on two sides.
    h[10 * 16 + 11] = 0.05; h[11 * 16 + 10] = 0.05; h[11 * 16 + 11] = 0.05;
    tiles[10 * 16 + 11] = G; tiles[11 * 16 + 10] = G; tiles[11 * 16 + 11] = G;
  });
  const tileCH = cornersOf(map);
  const i = 10 * 16 + 10;
  assert.ok(tileCH.cut[i] >= 0 && tileCH.cutS[i] < 0.999, 'walkable notch is a half cut');
  assert.equal(tileCH.clipOn[i], 0, 'a walkable tile is not carved into a 2:1 cliff');
  // Centre, and the corner the mesh trims: both stay on the shelf.
  assert.ok(Math.abs(tileGroundY(map, tileCH, 10.5, 10.5) - 2.1) < 0.05);
  assert.ok(tileGroundY(map, tileCH, 10.95, 10.95) > 1.9, 'a figure on the trimmed corner does not sink');
}

// --- switchback notch: a grass tile wrapped by the road is paved flat -----
{
  const map = makeMap(12, ({ tiles, h, swRoad, G }) => {
    for (let z = 3; z <= 7; z++) for (let x = 3; x <= 7; x++) {
      tiles[z * 12 + x] = G; h[z * 12 + x] = 1.4; swRoad[z * 12 + x] = 1;
    }
    const hole = 5 * 12 + 5;
    swRoad[hole] = 0;
    h[hole] = 1.7;
  });
  const tileCH = cornersOf(map);
  const i = 5 * 12 + 5;
  assert.equal(tileCH.roadFill[i], 1, 'a road-wrapped notch is paved');
  for (let c = 0; c < 4; c++) {
    assert.ok(Math.abs(tileCH[i * 4 + c] - 1.4) < 0.05, `notch corner ${tileCH[i * 4 + c]}`);
  }
  assert.equal(map.tiles[i], GRASS, 'paving a notch does not retile it');
  assert.ok(Math.abs(tileGroundY(map, tileCH, 5.5, 5.5) - 1.4) < 0.08);
}

// --- real L4: sim tiles untouched, shelf tooth cut, figures on their top --
{
  const level = levelById(4);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const site = map.sites[0];
  generatePlots(map, site, { levelId: 4, siteIdx: 0 });
  const afterFound = Buffer.from(map.tiles);
  const N = map.size, cw = N + 1;
  const cornerH = new Float32Array(cw * cw);
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) cornerH[z * cw + x] = map.cornerHeight(x, z);
  const tileCH = tileCorners(map, cornerH, cw);
  assert.ok(Buffer.from(map.tiles).equals(afterFound), 'cliff polish must not retile the founded map');
  let clips = 0;
  for (let i = 0; i < N * N; i++) if (tileCH.clipOn[i]) clips++;
  assert.ok(clips > 20, `L4 rim produced only ${clips} straight-cut tiles`);
  // Every walkable sample sits on the tile's own rendered top (no sink, no float).
  let checked = 0;
  for (let z = 2; z < N - 2 && checked < 400; z += 3) {
    for (let x = 2; x < N - 2 && checked < 400; x += 3) {
      if (!TILE_INFO[map.tiles[z * N + x]].walk) continue;
      if (!map.ledgeW || map.ledgeW[z * N + x] < 0.999) continue;
      const i = (z * N + x) * 4;
      for (const [fx, fz] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.2], [0.2, 0.85]]) {
        const gy = tileGroundY(map, tileCH, x + fx, z + fz);
        const top = (tileCH[i] * (1 - fx) + tileCH[i + 1] * fx) * (1 - fz)
          + (tileCH[i + 2] * (1 - fx) + tileCH[i + 3] * fx) * fz;
        assert.ok(Math.abs(gy - top) < 1e-4, `walkable ${x},${z} floats or sinks (${gy} vs ${top})`);
      }
      checked++;
    }
  }
  assert.ok(checked > 50, 'expected walkable terrace samples');
}

console.log('cliff-check ok');
