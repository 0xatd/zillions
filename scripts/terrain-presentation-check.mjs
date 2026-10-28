// Presentation grades must not move a walkable tile. Two builds of a campaign
// map agree, the keep sits a terrace above the open floor, and a culture
// change lifts height without rewriting the tile grid.
import { LEVELS } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';
import { setActiveCulture } from '../src/cultures.js';
import { SITE_FLOOR } from '../src/site-grade.js';

const PALETTE = {
  1: { grass: 0x2f7d66, water: 0x3fa9e0, shadow: 0x1d3a5a, path: 0xb07a4f, canopy: 0x9ad35a },
  2: { grass: 0x6f8f4e, water: 0x3f9c8c, shadow: 0x22383e, path: 0x8a7048, canopy: 0xb8c95e },
  3: { grass: 0xf2a533, water: 0xff5a1f, shadow: 0x182e3a, path: 0xb8682f, canopy: 0xc9783a },
  4: { grass: 0xd4eaef, water: 0x5aa8d8, shadow: 0x373553, path: 0x93a7bf, canopy: 0x9fd6ea },
  5: { grass: 0x6c5292, water: 0xa77cf0, shadow: 0x1a1438, path: 0xa889b4, canopy: 0xe07aae },
};

function tilesEqual(a, b) {
  if (a.tiles.length !== b.tiles.length) return false;
  for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) return false;
  return true;
}

function farGrass(map) {
  const heights = [];
  const N = map.size;
  for (let n = 0; n < 80; n++) {
    const x = 4 + ((n * 17) % (N - 8));
    const z = 4 + ((n * 29) % (N - 8));
    if (map.tiles[map.idx(x, z)] !== 0) continue;
    if ((map.sites || []).some((s) => Math.hypot(x - s.x, z - s.z) < 40)) continue;
    heights.push(map.heightAt(x, z));
  }
  heights.sort((a, b) => a - b);
  return heights.length ? heights[heights.length >> 1] : SITE_FLOOR;
}

setActiveCulture('european');
for (const level of LEVELS) {
  const want = PALETTE[level.id];
  for (const key of Object.keys(want)) {
    if (level.theme.palette[key] !== want[key]) {
      throw new Error(`${level.name} palette.${key} is ${level.theme.palette[key].toString(16)}, expected ${want[key].toString(16)}`);
    }
  }
  const opts = { size: level.size, nests: level.nests };
  const first = new TerrainField(level.seed, level.theme, opts);
  const second = new TerrainField(level.seed, level.theme, opts);
  if (!tilesEqual(first, second)) throw new Error(`${level.name} tile grid is not deterministic`);
  const site = first.sites[0];
  const top = first.heightAt(Math.round(site.x), Math.round(site.z));
  const floor = farGrass(first);
  if (top < floor + 0.8) {
    throw new Error(`${level.name} keep height ${top.toFixed(2)} is not a terrace above the floor ${floor.toFixed(2)}`);
  }
  for (let i = 0; i < 12; i++) {
    const x = 3 + ((i * 13) % (first.size - 6));
    const z = 5 + ((i * 19) % (first.size - 6));
    if (Math.abs(first.heightAt(x, z) - second.heightAt(x, z)) > 1e-6) {
      throw new Error(`${level.name} height drifted between builds`);
    }
  }
  setActiveCulture('south_american');
  const terraced = new TerrainField(level.seed, level.theme, opts);
  if (!tilesEqual(first, terraced)) throw new Error(`${level.name} culture grade rewrote tiles`);
  setActiveCulture('european');
  console.log(`${level.name}: keep ${top.toFixed(2)} floor ${floor.toFixed(2)} tiles unchanged`);
}

console.log('terrain presentation check passed');
