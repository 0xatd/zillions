import assert from 'node:assert/strict';
import { DIFFICULTY, LEVELS, NEST_HP_LEVEL_SHARE } from '../src/config.js';
import { persistRunTelemetry, runTelemetry, RUN_TELEMETRY_STORAGE_KEY } from '../src/run-telemetry.js';

const hero = { key: 'engineer', hero: true, level: 3, activeSet: 0,
  equipment: { chest: 'field_plate', weapon: 'rifle' }, upgrades: { aura: 1 } };
const game = {
  won: false, defeatCause: 'keep_destroyed', mode: 'campaign', levelId: 2,
  level: LEVELS[1], diffKey: 'casual', time: 751.234, gold: 18,
  heroes: [hero], units: [hero, { key: 'ranger' }, { key: 'ranger' }, { key: 'militia', dead: true }],
  nests: [{}, {}, {}],
  stats: { coins: 301, spent: 283, repaired: 12, built: 8, lost: 3,
    lostByKind: { tower: 2, hq: 1 }, damageTaken: { walker: 90, hive_blight: 12 },
    armyPeak: { ranger: 14, militia: 8 }, nests: 2, nodes: 5, bestHeld: 3, bossKillT: null },
};

const record = runTelemetry(game);
assert.equal(record.schema, 'zillions.run.v1');
assert.equal(record.failureCause, 'keep_destroyed');
assert.deepEqual(record.resources, { earned: 301, spent: 283, repaired: 12, remaining: 18 });
assert.deepEqual(record.army.final, { ranger: 2 });
assert.deepEqual(record.objectives,
  { nestsRazed: 2, nestsTotal: 3, nodesTaken: 5, bestNodesHeld: 3, bossKilled: false });
assert.deepEqual(record.heroes[0].equipment, { chest: 'field_plate', weapon: 'rifle' });

const memory = new Map();
const storage = { getItem: (key) => memory.get(key) || null,
  setItem: (key, value) => memory.set(key, value) };
assert.equal(persistRunTelemetry(game, storage).saved, true);
assert.equal(JSON.parse(memory.get(RUN_TELEMETRY_STORAGE_KEY)).length, 1);
const originalWarn = console.warn;
let warned = false;
console.warn = () => { warned = true; };
assert.equal(persistRunTelemetry(game, { getItem() { throw new Error('blocked'); } }).saved, false,
  'blocked telemetry storage must fail open');
console.warn = originalWarn;
assert.equal(warned, true, 'a telemetry storage failure must remain observable');

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
