// Overworld check: the menu planet is a real place, so it gets the same
// rigour as a battlefield — built headless in Node, asserted deterministic,
// connected and honest. Runs from `npm run check`.
import assert from 'node:assert/strict';
import {
  OverworldField, Overworld, overworldReachable, overworldLayout,
  gateState, OVERWORLD_SEED, OVERWORLD_GHOSTS,
} from '../src/overworld.js';
import { LEVELS, LABYRINTH_LEVELS } from '../src/config.js';

// 1. Deterministic: the same seed stitches the same planet, byte for byte.
const a = new OverworldField();
const b = new OverworldField(OVERWORLD_SEED);
assert.deepEqual([...a.tiles], [...b.tiles], 'overworld tiles must be seed-stable');
assert.deepEqual([...a.elev].map((v) => Math.round(v * 1e6)), [...b.elev].map((v) => Math.round(v * 1e6)),
  'overworld relief must be seed-stable');
assert.equal(a.size, 128, 'the overworld is a small planet, not a battlefield');
assert.ok(a.overworldLayout && a.overworldLayout.spawn, 'layout is attached to the field');

// A different seed is a different planet (sanity that we truly consume rng).
const c = new OverworldField(OVERWORLD_SEED + 1);
assert.notDeepEqual([...a.tiles], [...c.tiles], 'overworld must consume its rng');

// 2. Gates: all five fronts plus the labyrinth mouth, in march order.
const layout = overworldLayout(a.size);
assert.equal(layout.gates.length, LEVELS.length, 'one gate per campaign front');
assert.deepEqual(layout.gates.map((g) => g.levelId), LEVELS.map((l) => l.id), 'gates map to level ids in order');
assert.ok(layout.cave.cave && layout.cave.trials.length === LABYRINTH_LEVELS.length, 'the cave leads to the trials');

// 3. Reachable: every gate stands on walkable ground connected to the spawn
// (map-check's flood idea, applied to the road planet).
const reach = overworldReachable(a);
const N = a.size;
assert.ok(reach.size > N, 'the walkable overworld must be more than a corridor');
for (const g of [...layout.gates, layout.cave]) {
  assert.ok(a.isWalkable(g.x, g.z), `${g.name} gate tile must be walkable`);
  assert.ok(reach.has(g.z * N + g.x), `${g.name} must be reachable from spawn on foot`);
}

// Each region keeps real walkable ground of its own, not just the road.
for (let r = 0; r < LEVELS.length; r++) {
  let walk = 0;
  for (let i = 0; i < a.tiles.length; i++) if (a.region[i] === r) {
    const t = a.tiles[i];
    if (t === 0 || t === 4 || t === 5 || t === 6 || t === 7) walk++; // grass/sand/gold/stone/path
  }
  assert.ok(walk > 300, `region ${LEVELS[r].name} must have real walkable ground (${walk} tiles)`);
}

// 4. Lock state: the campaign ladder, honestly reported at the gates.
assert.deepEqual(gateState(layout.gates[0], 0), { locked: false, cleared: false }, 'front 1 is always open');
assert.deepEqual(gateState(layout.gates[1], 0), { locked: true, cleared: false }, 'front 2 locked on a fresh profile');
assert.deepEqual(gateState(layout.gates[1], 1), { locked: false, cleared: false }, 'winning front 1 opens front 2');
assert.deepEqual(gateState(layout.gates[0], 1), { locked: false, cleared: true }, 'cleared fronts read cleared');
assert.deepEqual(gateState(layout.gates[4], 4), { locked: false, cleared: false }, 'the last front opens last');
assert.deepEqual(gateState(layout.cave, 0), { locked: false, cleared: false }, 'the labyrinth is its own door');

// 5. Walk-in triggers: stepping into a gate ring fires the right level id,
// movement collides with impassable tiles, and ghosts expire.
const ow = new Overworld(a, { campaign: 0 });
let sawLevel1 = false, sawLocked = false;
ow.hero.x = layout.gates[0].x + 0.5; ow.hero.z = layout.gates[0].z + 0.5;
for (const ev of ow.update(0.016)) {
  if (ev.t === 'gate' && ev.gate.levelId === 1 && !ev.state.locked) sawLevel1 = true;
}
ow.hero.x = layout.gates[1].x + 0.5; ow.hero.z = layout.gates[1].z + 0.5;
for (const ev of ow.update(0.016)) {
  if (ev.t === 'gate' && ev.gate.levelId === 2 && ev.state.locked) sawLocked = true;
}
assert.ok(sawLevel1, 'greenfall gate triggers level 1');
assert.ok(sawLocked, 'rotmire gate reports locked on a fresh profile');

// No trigger outside the ring, and no double-trigger inside the cooldown.
assert.equal(ow.update(0.016).length, 0, 'gate respects its cooldown');

// WASD walk with collision: point the hero at the nearest impassable tile
// and it must stop against it, not pass through.
const ow2 = new Overworld(a, {});
const before = { ...ow2.hero };
ow2.setDir(0, -1);
for (let i = 0; i < 400; i++) ow2.update(1 / 60);
assert.ok(ow2.hero.z < before.z, 'the hero walks');
assert.ok(Number.isFinite(ow2.hero.x) && Number.isFinite(ow2.hero.z), 'the hero stays on the planet');
assert.ok(ow2.map.isWalkable(Math.floor(ow2.hero.x), Math.floor(ow2.hero.z)), 'the hero ends on walkable ground');

// Ghost bookkeeping: upsert then expire.
ow.ghostUpsert('p1', { x: 10, z: 10, hero: 'scott', name: 'Scott' }, 0);
assert.equal(ow.ghosts.size, 1, 'ghost upserted');
ow.time = 30;
ow.ghostSweep(6);
assert.equal(ow.ghosts.size, 0, 'stale ghosts are swept');
assert.equal(OVERWORLD_GHOSTS, true, 'ghost flag is on (presence only, never netcode)');

console.log('overworld-check: planet stitched, deterministic, all gates reachable ✓');
