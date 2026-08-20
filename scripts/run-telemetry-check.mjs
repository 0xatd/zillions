import assert from 'node:assert/strict';
import { DIFFICULTY, LEVELS, NEST_HP_LEVEL_SHARE, TILE } from '../src/config.js';
import { Game } from '../src/game.js';
import { persistRunTelemetry, runTelemetry, RUN_TELEMETRY_STORAGE_KEY } from '../src/run-telemetry.js';

const hero = { key: 'engineer', hero: true, level: 3, activeSet: 0,
  equipment: { chest: 'field_plate', weapon: 'rifle' }, upgrades: { aura: 1 } };
const game = {
  won: false, defeatCause: 'keep_destroyed', mode: 'campaign', levelId: 2,
  level: LEVELS[1], diffKey: 'casual', time: 751.234, gold: 18,
  heroes: [hero], units: [hero, { key: 'ranger' }, { key: 'ranger' }, { key: 'militia', dead: true }],
  nests: [{}, {}, {}],
  stats: { coins: 301, spent: 283, repaired: 12, built: 8, lost: 3,
    builtByKind: { tower: 3, camp_ranger: 2 }, lostByKind: { tower: 2, hq: 1 },
    damageTaken: { walker: 90, hive_blight: 12 },
    armyPeak: { ranger: 14, militia: 8 }, nests: 2, nodes: 5, bestHeld: 3, bossKillT: null },
};

const record = runTelemetry(game);
assert.equal(record.schema, 'zillions.run.v1');
assert.equal(record.failureCause, 'keep_destroyed');
assert.deepEqual(record.resources, { earned: 301, spent: 283, repaired: 12, remaining: 18 });
assert.deepEqual(record.army.final, { ranger: 2 });
assert.deepEqual(record.structures, {
  built: 8, builtByKind: { camp_ranger: 2, tower: 3 },
  lost: 3, lostByKind: { hq: 1, tower: 2 },
});
assert.deepEqual(record.objectives,
  { nestsRazed: 2, nestsTotal: 3, nodesTaken: 5, bestNodesHeld: 3, bossKilled: false });
assert.deepEqual(record.heroes[0].equipment, { chest: 'field_plate', weapon: 'rifle' });

const memory = new Map();
const storage = { getItem: (key) => memory.get(key) || null,
  setItem: (key, value) => memory.set(key, value) };
assert.equal(persistRunTelemetry(game, storage, Date.UTC(2026, 7, 20, 1, 2, 3)).saved, true);
const persisted = JSON.parse(memory.get(RUN_TELEMETRY_STORAGE_KEY));
assert.equal(persisted.length, 1);
assert.equal(persisted[0].capturedAt, '2026-08-20T01:02:03.000Z');
assert.equal(Object.hasOwn(record, 'capturedAt'), false,
  'pure telemetry records must remain independent of wall-clock time');
const originalWarn = console.warn;
let warned = false;
console.warn = () => { warned = true; };
assert.equal(persistRunTelemetry(game, { getItem() { throw new Error('blocked'); } }).saved, false,
  'blocked telemetry storage must fail open');
console.warn = originalWarn;
assert.equal(warned, true, 'a telemetry storage failure must remain observable');

const size = 80;
const map = {
  size, seed: 4242, sites: [{ x: size / 2, z: size / 2 }],
  tiles: new Uint8Array(size * size).fill(TILE.GRASS),
  nestSpots: [[8, 8], [70, 70], [8, 70]],
  nodeSpots: [
    { x: 20, z: 20, kind: 'ore' }, { x: 60, z: 20, kind: 'ford' },
    { x: 20, z: 60, kind: 'quarry' }, { x: 60, z: 60, kind: 'clearing' },
  ],
  isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
};
const sim = new Game(map, 'casual', 'alexander', null, 1, 'campaign');
sim.foundCity(0, 0);
assert.equal(sim.stats.built, 0, 'free city setup must not count as a construction purchase');
const house = sim.plots.find((plot) => plot.kind === 'house');
assert.ok(house, 'test city needs a house plot');
sim._construct(house);
sim._construct(house);
assert.equal(sim.stats.built, 2, 'a build and its upgrade are two completed purchases');
assert.deepEqual(sim.stats.builtByKind, { house: 2 });
const restored = new Game(map, 'casual', 'alexander', sim.snapshot(), 1, 'campaign');
assert.deepEqual(restored.stats.builtByKind, { house: 2 },
  'construction purchase kinds must survive snapshot restore');

// This deterministic envelope checks the independent campaign levers that
// stack at a level boundary. Real run records remain the completion evidence.
const burden = (level, difficulty) => ({
  recurring: level.mult * level.economy.pressure * difficulty.mult,
  nest: (1 - NEST_HP_LEVEL_SHARE + NEST_HP_LEVEL_SHARE * level.mult)
    * Math.max(0.6, difficulty.mult),
  boss: level.boss.hp * difficulty.mult,
});
const greenfall = burden(LEVELS[0], DIFFICULTY.casual);
const rotmire = burden(LEVELS[1], DIFFICULTY.casual);
const ratio = (next, prior) => next / prior;
assert.ok(ratio(rotmire.recurring, greenfall.recurring) >= 1.1
  && ratio(rotmire.recurring, greenfall.recurring) <= 1.22);
assert.ok(ratio(rotmire.nest, greenfall.nest) >= 1.05
  && ratio(rotmire.nest, greenfall.nest) <= 1.15);
assert.ok(ratio(rotmire.boss, greenfall.boss) >= 1.1
  && ratio(rotmire.boss, greenfall.boss) <= 1.22);
for (const level of LEVELS.slice(0, 2)) {
  const casual = burden(level, DIFFICULTY.casual);
  const normal = burden(level, DIFFICULTY.normal);
  const brutal = burden(level, DIFFICULTY.brutal);
  for (const key of Object.keys(casual)) {
    assert.ok(casual[key] < normal[key] && normal[key] < brutal[key],
      `${level.name} must preserve Casual < Normal < Brutal for ${key}`);
  }
}

console.log('run telemetry and first-hour balance envelope check passed');
