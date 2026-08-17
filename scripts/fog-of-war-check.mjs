import assert from 'node:assert/strict';
import {
  fogVisionSources,
  HERO_VISION_RADIUS,
  MAX_VISION_SOURCES,
  TROOP_VISION_RADIUS,
} from '../src/fog-of-war.js';

const sources = fogVisionSources({ units: [
  { id: 1, hero: false, x: 20, z: 21 },
  { id: 2, hero: true, x: 10, z: 11 },
  { id: 3, hero: false, x: 30, z: 31, dead: true },
  { id: 4, hero: true, x: 12, z: 13 },
] });
assert.deepEqual(sources, [
  { x: 10, z: 11, radius: HERO_VISION_RADIUS },
  { x: 12, z: 13, radius: HERO_VISION_RADIUS },
  { x: 20, z: 21, radius: TROOP_VISION_RADIUS },
], 'fog must prioritize living heroes, include living troops, and omit the dead');

const army = { units: Array.from({ length: MAX_VISION_SOURCES + 20 }, (_, i) => ({ x: i, z: i, hero: false })) };
assert.equal(fogVisionSources(army).length, MAX_VISION_SOURCES, 'fog source count must remain GPU-bounded');
assert.deepEqual(fogVisionSources(null), [], 'fog must tolerate menu/no-game state');
assert.ok(HERO_VISION_RADIUS > TROOP_VISION_RADIUS, 'heroes must scout farther than regular troops');
console.log('Fog-of-war checks passed.');
