import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { SIM_DT, TILE } from '../src/config.js';

function fakeMap() {
  const size = 48;
  return {
    size,
    seed: 81818,
    sites: [],
    nestSpots: [],
    nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

function makeGame(heroKeys, snap = null) {
  return new Game(fakeMap(), snap?.diff || 'normal', snap?.heroKeys || heroKeys, snap, snap?.level || 1, snap?.mode || 'campaign');
}

function prepareAndCast(game) {
  game.zombies = [];
  for (let p = 0; p < game.heroes.length; p++) {
    const hero = game.heroes[p];
    hero.level = 10;
    hero.upgrades.ult = 3;
    hero.upgrades.passive1 = 3;
    game._refreshHeroDerived(hero);
    hero.abilCd = 0;
    game.exec({ t: 'cast', p });
  }
}

function comparable(snapshot) {
  return {
    rng: snapshot.rng,
    time: snapshot.time,
    brews: snapshot.brews,
    units: snapshot.units,
    heroes: snapshot.heroes,
  };
}

function advance(game, ticks) {
  for (let i = 0; i < ticks; i++) game.update(SIM_DT);
}

for (const key of ['turtle', 'john', 'tiger', 'aaron']) {
  const uninterrupted = makeGame(key);
  prepareAndCast(uninterrupted);
  const restored = makeGame(key, uninterrupted.snapshot());

  assert.deepEqual(
    comparable(restored.snapshot()),
    comparable(uninterrupted.snapshot()),
    `${key} cast state changed during snapshot restore`,
  );

  advance(uninterrupted, 180);
  advance(restored, 180);
  assert.deepEqual(
    comparable(restored.snapshot()),
    comparable(uninterrupted.snapshot()),
    `${key} simulation diverged after snapshot restore`,
  );
}

const party = ['turtle', 'john', 'tiger', 'aaron'];
const coOp = makeGame(party);
prepareAndCast(coOp);
const restoredCoOp = makeGame(party, coOp.snapshot());
advance(coOp, 180);
advance(restoredCoOp, 180);
assert.deepEqual(
  comparable(restoredCoOp.snapshot()),
  comparable(coOp.snapshot()),
  'four-hero co-op simulation diverged after snapshot restore',
);

console.log('hero ability restore check passed');
