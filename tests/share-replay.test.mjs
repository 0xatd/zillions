import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import { dailyChallenge } from '../src/daily.js';
import {
  SIM_VERSION, SHARE_LIMITS, boardReplayId, buildShareReplay, decideReplayPublish,
  openReplay, playReplayTo, replayProblem, replayShare, shareReplayFromDaily, validateShareReplay,
} from '../src/share-replay.js';
import { processReplayPublish, processReplayRead } from '../api/replay.js';
import { replayPageHtml, replayPageModel } from '../api/replay-page.js';

function play({ heroes = [{ k: 'scott', camp: { level: 2, xp: 0, items: [], upgrades: { aura: 1 }, relics: [] } }], mode = 'campaign', levelId = 1, difficulty = 'normal', culture = 'european', seed = 123456, frames = 36, daily = null } = {}) {
  const level = levelById(levelId);
  const mapSeed = daily ? daily.mapSeed : level.seed;
  const map = new TerrainField(mapSeed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, difficulty, heroes, null, levelId, mode, {
    rngSeed: seed, culture, ...(daily ? { daily } : {}),
  });
  game.inputLog = [];
  game.exec({ t: 'found', s: 0, p: 0 });
  while (game.steps < frames && !game.over) {
    if (game.steps === 4) game.exec({ t: 'hdir', p: 0, x: 1, z: 0, s: false });
    if (game.steps === 8) game.exec({ t: 'hdir', p: 1, x: 0, z: -1, s: true });
    if (game.steps === 12) game.exec({ t: 'stance', s: 'defend', p: 0 });
    if (game.steps === 16) game.exec({ t: 'focus', p: 0, id: null });
    game.update(SIM_DT);
  }
  return game;
}

test('a recorded replay reproduces the final lockstep hash, including a seek', () => {
  const game = play({ heroes: ['scott', 'alexander'] });
  const replay = buildShareReplay(game, { leaders: ['scott', 'alexander'], difficulty: 'normal' });
  assert.ok(replay);
  assert.equal(replay.sim, SIM_VERSION);
  assert.equal(replay.leaders.length, 2);
  const verified = replayShare(replay, { snapEvery: 10, snapCap: 8 });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.hash, stateHash(game));
  assert.equal(verified.steps, game.steps);

  const session = openReplay(replay);
  playReplayTo(session, 20, { snapEvery: 10, snapCap: 8 });
  assert.ok(session.snaps.some((entry) => entry.step > 0 && entry.snap));
  const midHash = stateHash(session.game);
  playReplayTo(session, 8, { snapEvery: 10, snapCap: 8 });
  assert.ok(session.step <= 8);
  playReplayTo(session, 20, { snapEvery: 10, snapCap: 8 });
  assert.equal(stateHash(session.game), midHash);
  playReplayTo(session, replay.frames, { snapEvery: 10, snapCap: 8 });
  assert.equal(stateHash(session.game), stateHash(game));
});

test('a daily recording uses the day and reproduces the hash', () => {
  const challenge = dailyChallenge('2026-11-25');
  const game = play({
    heroes: challenge.hero,
    mode: 'daily',
    levelId: challenge.levelId,
    culture: challenge.culture,
    seed: challenge.seed,
    daily: challenge,
    frames: 24,
  });
  const replay = buildShareReplay(game);
  assert.equal(replay.day, challenge.day);
  assert.equal(replay.leaders[0], challenge.hero);
  const verified = replayShare(replay);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.hash, stateHash(game));
  const fromDaily = shareReplayFromDaily({
    v: 1, day: challenge.day, seed: challenge.seed >>> 0, frames: game.steps, hero: challenge.hero,
    culture: challenge.culture, levelId: challenge.levelId, hash: stateHash(game), log: game.inputLog,
  }, { won: game.won });
  assert.equal(replayShare(fromDaily).status, 'verified');
});

test('a simulation version mismatch is refused before the log is played', () => {
  const game = play({ frames: 8 });
  const replay = buildShareReplay(game);
  const stale = { ...replay, sim: SIM_VERSION + 7 };
  const checked = validateShareReplay(stale);
  assert.equal(checked.ok, false);
  assert.equal(checked.error, 'sim_version_mismatch');
  assert.equal(checked.detail.expected, SIM_VERSION);
  const played = replayShare(stale);
  assert.equal(played.status, 'version');
  assert.equal(played.session, undefined);
  assert.match(replayProblem(played), /not played/);
  const future = validateShareReplay({ ...replay, v: SHARE_LIMITS.maxLog });
  assert.equal(future.error, 'unsupported_replay_version');
  const forged = replayShare({ ...replay, hash: (replay.hash + 1) | 0 });
  assert.equal(forged.status, 'mismatch');
});

test('the share route stores a guest replay once and refuses a stale simulation', async () => {
  const game = play({ frames: 6 });
  const replay = buildShareReplay(game);
  const rows = [];
  const store = {
    async publish({ digest, replay: body, board }) {
      assert.equal(board, false);
      const found = rows.find((row) => row.digest === digest);
      if (found) return { id: found.id, duplicate: true };
      const decision = decideReplayPublish({ bytes: 10, recentUser: 0, recentIp: rows.length >= 12 ? 12 : 0 });
      if (!decision.ok) {
        const error = new Error(decision.error);
        error.status = decision.status;
        throw error;
      }
      const id = 'ABCDEFGH';
      rows.push({ id, digest, body });
      return { id, duplicate: false };
    },
    async read(id) {
      return rows.find((row) => row.id === id)?.body || null;
    },
  };
  const saved = await processReplayPublish({ userId: null, ipHash: 'a'.repeat(64), body: { replay, board: true }, store });
  assert.equal(saved.path, '/r/ABCDEFGH');
  const again = await processReplayPublish({ userId: null, ipHash: 'a'.repeat(64), body: { replay }, store });
  assert.equal(again.duplicate, true);
  assert.equal(again.id, saved.id);
  const loaded = await processReplayRead({ id: saved.id, store });
  assert.equal(loaded.ok, true);
  assert.equal(replayShare(loaded.replay).status, 'verified');
  rows[0].body = { ...rows[0].body, sim: SIM_VERSION + 3 };
  const stale = await processReplayRead({ id: saved.id, store });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'sim_version_mismatch');
  const page = replayPageModel({
    id: 'ABCDEFGH',
    origin: 'https://zillions.taborlin.co',
    row: { hero: 'scott', won: false, mode: 'campaign', seed: replay.seed },
  });
  assert.equal(page.status, 200);
  assert.match(page.title, /Scott/);
  assert.equal(page.url, 'https://zillions.taborlin.co/r/ABCDEFGH');
  assert.match(replayPageHtml(page), /<base href="\/">/);
  assert.equal(replayPageModel({ id: 'nope', origin: 'https://zillions.taborlin.co', row: null }).status, 404);
});

test('publish limits reject an oversized body and a full hour, and keep a duplicate', () => {
  assert.deepEqual(decideReplayPublish({ bytes: 10, recentUser: 0, recentIp: 0 }), { ok: true, duplicate: false });
  assert.equal(decideReplayPublish({ bytes: SHARE_LIMITS.maxBytes + 1, recentUser: 0, recentIp: 0 }).error, 'replay_too_large');
  assert.equal(decideReplayPublish({ bytes: 10, recentUser: SHARE_LIMITS.maxPerHour, recentIp: 0 }).status, 429);
  assert.equal(decideReplayPublish({ bytes: 10, recentUser: 0, recentIp: SHARE_LIMITS.maxPerHour }).error, 'rate_limited');
  assert.equal(decideReplayPublish({ bytes: SHARE_LIMITS.maxBytes + 1, recentUser: 0, recentIp: 0, existingId: 'ABCDEFGH' }).id, 'ABCDEFGH');
  assert.equal(boardReplayId(new Map([['u', 'ABCDEFGH']]), 'u'), 'ABCDEFGH');
  assert.equal(boardReplayId(new Map([['u', 'nope']]), 'u'), null);
});
