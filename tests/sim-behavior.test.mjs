import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, combatBuckets, nearbyBuckets } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import { makeRNG } from '../src/utils.js';

const newGame = (seed, snap = null) => {
  const level = levelById(1);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  return new Game(map, 'normal', 'alexander', snap, 1, 'campaign', { rngSeed: seed });
};
const run = (game, steps) => { for (let i = 0; i < steps && !game.over; i++) game.update(SIM_DT); return game; };

test('pooled combat buckets answer every query exactly like fresh ones', () => {
  const rng = makeRNG(11);
  const actors = Array.from({ length: 800 }, (_, id) => ({ id, x: rng() * 200 - 40, z: rng() * 200 - 40, dead: rng() < 0.1 }));
  const pool = new Map();
  for (let tick = 0; tick < 20; tick++) {
    for (const a of actors) { a.x += rng() * 6 - 3; a.z += rng() * 6 - 3; if (rng() < 0.02) a.dead = !a.dead; }
    const fresh = combatBuckets(actors);
    const pooled = combatBuckets(actors, pool);
    assert.equal(pooled, pool, 'the pool is reused, not replaced');
    for (let probe = 0; probe < 25; probe++) {
      const x = rng() * 200 - 40, z = rng() * 200 - 40, r = 2 + rng() * 20;
      assert.deepEqual(nearbyBuckets(pooled, actors, x, z, r).map((a) => a.id), nearbyBuckets(fresh, actors, x, z, r).map((a) => a.id));
    }
  }
});

test('the match seed drives the simulation, and snapshots keep it', () => {
  const a = run(newGame(77), 900);
  const b = run(newGame(77), 900);
  const c = run(newGame(78), 900);
  assert.equal(stateHash(a), stateHash(b), 'same seed, same match');
  assert.notEqual(JSON.stringify(a.snapshot()), JSON.stringify(c.snapshot()), 'another seed, another match');
  const half = run(newGame(77), 450);
  const snap = JSON.parse(JSON.stringify(half.snapshot()));
  assert.equal(snap.rngSeed, 77);
  assert.equal(snap.steps, 450);
  const resumed = run(newGame(1, snap), 450);
  assert.equal(resumed.rngSeed, 77, 'a restore keeps the match seed');
  assert.equal(resumed.steps, a.steps);
  assert.equal(stateHash(resumed), stateHash(a), 'a restored match continues identically');
});

test('guests read only well-formed shared match fields, never a ticket', async () => {
  const { sharedMatchFields, parseSharedMatch, matchReplayPayload } = await import('../src/match-session.js');
  const shared = sharedMatchFields({ ticket: 'secret', seed: 5, roomId: '11111111-1111-1111-1111-111111111111', joinToken: 'jt' });
  assert.deepEqual(shared, { seed: 5, roomId: '11111111-1111-1111-1111-111111111111', joinToken: 'jt' });
  assert.deepEqual(parseSharedMatch({ seed: '5', roomId: 'not-a-room', joinToken: 7 }), { seed: null, roomId: null, joinToken: null, upgrades: [] });
  assert.deepEqual(sharedMatchFields({ seed: 5, roomId: shared.roomId, joinToken: 'jt', upgrades: ['supply_cache', 'nope', 'supply_cache'] }).upgrades, ['supply_cache']);
  assert.equal(matchReplayPayload({ inputLog: null }, { heroes: [] }, 0), null);
  assert.deepEqual(matchReplayPayload({ inputLog: [[0, { t: 'found' }]], steps: 9 }, { heroes: ['a'] }, 0).frames, 9);
});
