import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../src/config.js';
import { Game } from '../src/game.js';
import { stateHash } from '../src/lockstep-hash.js';
import { guestCommand } from '../src/multiplayer-command.js';
import { runLockstepPeers } from '../src/share-lockstep.js';

const size = 48;
function fakeMap() {
  return {
    size, seed: 31337, sites: [], nestSpots: [], nodeSpots: [],
    tiles: new Uint8Array(size * size).fill(TILE.GRASS),
    idx: (x, z) => z * size + x,
    inBounds: () => true, isBuildable: () => true, isWalkable: () => true,
  };
}

function pair() {
  const heroes = ['scott', 'alexander'];
  return [
    new Game(fakeMap(), 'normal', heroes, null, 1, 'campaign', { rngSeed: 42 }),
    new Game(fakeMap(), 'normal', heroes, null, 1, 'campaign', { rngSeed: 42 }),
  ];
}

function windows(w) {
  if (w === 2) {
    return [
      { t: 'hdir', p: 0, x: 1, z: 0, s: false },
      guestCommand({ t: 'hdir', x: -1, z: 0, s: false }, 1, 2),
    ];
  }
  if (w === 8) return [guestCommand({ t: 'stance', s: 'attack' }, 1, 2)];
  return [];
}

test('two peers running one shared window stream stay on the same hash', () => {
  const games = pair();
  assert.equal(games[0].heroes.length, 2);
  assert.equal(stateHash(games[0]), stateHash(games[1]));
  const run = runLockstepPeers(games, { ticks: 90, commandsForWindow: windows });
  assert.equal(run.agree, true);
  assert.ok(run.hashes.length >= 2);
  for (const sample of run.hashes) assert.equal(sample[0], sample[1]);
  assert.notEqual(games[0].heroes[0].x, games[0].heroes[1].x);
  assert.equal(games[0].heroes[0].x, games[1].heroes[0].x);
  assert.equal(games[0].heroes[1].x, games[1].heroes[1].x);
  assert.equal(games[0].stance, games[1].stance);
});

test('a peer that drops the second hero command diverges', () => {
  // The helper applies one bundle to every peer. Split the window by hand so
  // peer B never sees hero 2's move, which is the desync a bad join would cause.
  const [left, right] = pair();
  for (let frame = 0; frame < 40; frame++) {
    if (frame % 2 === 0) {
      const bundle = windows(frame / 2);
      for (const command of bundle) left.exec(command);
      for (const command of bundle.filter((command) => command.p !== 1)) right.exec(command);
    }
    left.update(1 / 30);
    right.update(1 / 30);
  }
  assert.notEqual(stateHash(left), stateHash(right));
  assert.notEqual(left.heroes[1].x, right.heroes[1].x);
});
