import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, TILE, ZOMBIES, levelById } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import { processDailySubmit } from '../api/daily.js';
import {
  DAILY_HEROES, DAILY_MODIFIERS, DAILY_WAVE_COUNT, acceptableDay, buildDailyReplay, dailyChallenge,
  dailyKey, dailyScore, dailySeed, replayDaily, validateDailyReplay, verifyDailySubmission,
} from '../src/daily.js';

const DAY = '2026-11-25';
const NOW = new Date('2026-11-25T15:00:00Z');
const USER = '11111111-1111-1111-1111-111111111111';

function shortChallenge(day = DAY) {
  const challenge = dailyChallenge(day);
  return {
    ...challenge,
    timeCap: 1.5,
    waves: [{ at: 0.4, count: 3, kind: 'walker' }],
  };
}

function play(challenge) {
  const level = levelById(challenge.levelId);
  const map = new TerrainField(challenge.mapSeed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', challenge.hero, null, challenge.levelId, 'daily', {
    rngSeed: challenge.seed, culture: challenge.culture, daily: challenge,
  });
  game.inputLog = [];
  game.exec({ t: 'found', s: 0, p: 0 });
  let moves = 0;
  while (!game.over && game.steps < 200) {
    if (game.steps === 6) game.exec({ t: 'hdir', p: 0, x: 1, z: 0, s: false });
    if (game.steps === 12) game.exec({ t: 'stance', s: 'defend', p: 0 });
    if (moves < 2 && game.steps === 18) {
      game.exec({ t: 'hdir', p: 0, x: 0, z: 1, s: false });
      moves++;
    }
    game.update(SIM_DT);
  }
  return game;
}

function fakeMap() {
  const size = 48;
  const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
  return {
    size,
    seed: 7,
    sites: [{ x: size / 2, z: size / 2 }],
    nestSpots: [[8, 24], [40, 24], [24, 8]],
    nodeSpots: [
      { x: 16, z: 24, kind: 'crossroads', name: 'West Road' },
      { x: 32, z: 24, kind: 'clearing', name: 'East Field' },
    ],
    tiles,
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

test('the daily seed is a pure function of the UTC day', () => {
  assert.equal(dailyKey(NOW), DAY);
  assert.equal(dailyKey(new Date('2026-11-25T00:30:00+02:00')), '2026-11-24');
  assert.equal(dailySeed(DAY), dailySeed(DAY));
  assert.notEqual(dailySeed(DAY), dailySeed('2026-11-26'));
  assert.equal(acceptableDay(DAY, NOW), true);
  assert.equal(acceptableDay('2026-11-24', NOW), true);
  assert.equal(acceptableDay('2026-11-23', NOW), false);
  const first = dailyChallenge(DAY);
  const again = dailyChallenge(DAY);
  assert.deepEqual(again, first);
  assert.equal(first.waves.length, DAILY_WAVE_COUNT);
  assert.equal(first.modifiers.length, 2);
  assert.equal(first.mapSeed, first.seed);
  assert.ok(DAILY_HEROES.includes(first.hero));
  assert.ok(first.modifiers.every((id) => DAILY_MODIFIERS.some((mod) => mod.id === id)));
  assert.equal(first.modifiers.includes('fat_purse') && first.modifiers.includes('thin_purse'), false);
  for (let i = 0; i < 40; i++) {
    const day = dailyKey(new Date(Date.UTC(2026, 0, 1 + i)));
    const mods = dailyChallenge(day).modifiers;
    assert.equal(mods.includes('fat_purse') && mods.includes('thin_purse'), false, mods.join(','));
  }
  assert.notDeepEqual(dailyChallenge('2026-11-26').waves, first.waves);
});

test('score bands rank waves, then Keep health, then time', () => {
  const loss = dailyScore({ waves: 3, cityHp: 0, cityMaxHp: 1000, seconds: 400, won: false });
  const moreWaves = dailyScore({ waves: 4, cityHp: 0, cityMaxHp: 1000, seconds: 20, won: false });
  const winLow = dailyScore({ waves: 3, cityHp: 1, cityMaxHp: 1000, seconds: 500, won: true });
  const winHigh = dailyScore({ waves: 3, cityHp: 900, cityMaxHp: 1000, seconds: 500, won: true });
  const fast = dailyScore({ waves: 3, cityHp: 500, cityMaxHp: 1000, seconds: 30, won: true });
  const slow = dailyScore({ waves: 3, cityHp: 500, cityMaxHp: 1000, seconds: 400, won: true });
  assert.ok(moreWaves > winHigh, 'another wave outranks a healthy Keep');
  assert.ok(winHigh > winLow, 'more Keep health ranks higher on the same wave');
  assert.ok(winLow > loss, 'a clear outranks a loss on the same wave');
  assert.ok(fast > slow, 'a faster clear ranks higher at the same health');
  assert.ok(fast - slow < 100, 'time cannot cross a health step');
});

test('daily modifiers change only a daily run', () => {
  const spec = {
    ...dailyChallenge(DAY),
    modifiers: ['brittle_keep', 'fat_purse', 'thick_hide'],
    waves: [],
    timeCap: 30,
  };
  const modified = new Game(fakeMap(), 'normal', 'scott', null, 1, 'daily', { rngSeed: 1, daily: spec });
  const plain = new Game(fakeMap(), 'normal', 'scott', null, 1, 'daily', {
    rngSeed: 1, daily: { ...spec, modifiers: [] },
  });
  assert.ok(modified.gold > plain.gold, 'fat purse adds starting gold');
  modified.exec({ t: 'found', s: 0, p: 0 });
  plain.exec({ t: 'found', s: 0, p: 0 });
  assert.ok(modified.hq.maxHp < plain.hq.maxHp, 'brittle keep lowers Keep health');
  modified._spawnZombie('walker', 12, 12, true, true);
  plain._spawnZombie('walker', 12, 12, true, true);
  assert.ok(modified.zombies.at(-1).maxHp > plain.zombies.at(-1).maxHp);
  assert.equal(modified.zombies.at(-1).maxHp, Math.round(ZOMBIES.walker.hp * 1.25));
  const campaign = new Game(fakeMap(), 'normal', 'scott', null, 1, 'campaign');
  const before = stateHash(campaign);
  campaign.dailyWave = 4;
  campaign.dailyCleared = 2;
  assert.equal(stateHash(campaign), before, 'campaign hashes ignore daily fields');
});

test('replaying a daily log is deterministic and a forged hash is refused', () => {
  const challenge = shortChallenge();
  const game = play(challenge);
  assert.equal(game.over, true);
  assert.ok(game.dailyResult);
  const replay = buildDailyReplay(game, challenge);
  const first = replayDaily({ challenge, replay });
  const second = replayDaily({ challenge, replay: JSON.parse(JSON.stringify(replay)) });
  assert.equal(first.status, 'verified');
  assert.deepEqual(second, first);
  assert.equal(first.score, dailyScore(game.dailyResult));
  assert.equal(first.hash, stateHash(game));
  const forged = replayDaily({ challenge, replay: { ...replay, hash: (replay.hash + 1) | 0 } });
  assert.equal(forged.status, 'mismatch');
  assert.deepEqual(forged.mismatch, ['hash']);

  const level = levelById(challenge.levelId);
  const mid = new Game(
    new TerrainField(challenge.mapSeed, level.theme, { size: level.size, nests: level.nests }),
    'normal', challenge.hero, null, challenge.levelId, 'daily',
    { rngSeed: challenge.seed, culture: challenge.culture, daily: challenge },
  );
  mid.exec({ t: 'found', s: 0, p: 0 });
  while (!mid.over && mid.steps < 20) mid.update(SIM_DT);
  const snap = mid.snapshot();
  while (!mid.over && mid.steps < 200) mid.update(SIM_DT);
  const restored = new Game(
    new TerrainField(snap.seed, level.theme, { size: level.size, nests: level.nests }),
    'normal', snap.heroKeys, snap, challenge.levelId, 'daily',
  );
  while (!restored.over && restored.steps < 200) restored.update(SIM_DT);
  assert.equal(restored.over, true);
  assert.equal(stateHash(restored), stateHash(mid));
  assert.deepEqual(restored.dailyResult, mid.dailyResult);
});

test('the server challenge rejects a different hero or a closed day before storing', async () => {
  const challenge = dailyChallenge(DAY);
  const hero = DAILY_HEROES.find((key) => key !== challenge.hero);
  const store = {
    displayName: async () => 'ada',
    submit: async () => { throw new Error('stored'); },
  };
  await assert.rejects(
    () => processDailySubmit({
      userId: USER,
      now: NOW,
      store,
      body: {
        replay: {
          v: 1, day: DAY, seed: challenge.seed, frames: 8, hero, culture: challenge.culture,
          levelId: challenge.levelId, hash: 1, log: [[0, { t: 'found', s: 0, p: 0 }]],
        },
      },
    }),
    (error) => error.message === 'daily_unverified' && error.mismatch.includes('hero'),
  );
  await assert.rejects(
    () => processDailySubmit({
      userId: USER,
      now: NOW,
      store,
      body: {
        replay: {
          v: 1, day: '2020-01-01', seed: 1, frames: 4, hero: 'scott', culture: 'european',
          levelId: 1, hash: 1, log: [],
        },
      },
    }),
    /daily_closed/,
  );
  const bad = validateDailyReplay({ v: 1, day: DAY, seed: challenge.seed, frames: 4, hero: 'scott', culture: 'european', levelId: 1, hash: 1, log: [[3, { t: 'x' }], [1, { t: 'y' }]] });
  assert.equal(bad.detail, 'log_order');
  const wrongSeed = verifyDailySubmission({
    replay: {
      v: 1, day: DAY, seed: (challenge.seed + 1) >>> 0, frames: 4, hero: challenge.hero,
      culture: challenge.culture, levelId: challenge.levelId, hash: 1, log: [],
    },
  });
  assert.equal(wrongSeed.status, 'mismatch');
  assert.ok(wrongSeed.mismatch.includes('seed'));
});
