import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { buildMatchReport } from '../src/match-report.js';
import {
  REPLAY_VERSION, diffReports, isFlagged, replayMatch, reviewReasons, validateReplayPayload, rebuildOwnCamp,
} from '../src/match-replay.js';
import { makeRNG } from '../src/utils.js';

// Play a match the way the browser does: commands land between frames, and a
// frame runs a variable number of sim steps.
function playRecordedMatch({ levelId = 1, seed = 4242, steps = 2400, heroes = 'alexander', script = 7 } = {}) {
  const level = levelById(levelId);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', heroes, null, levelId, 'campaign', { rngSeed: seed });
  game.inputLog = [];
  const rng = makeRNG(script);
  game.exec({ t: 'found', s: 0, p: 0 });
  while (game.steps < steps && !game.over) {
    if (rng() < 0.3) {
      const dirs = [-1, 0, 1];
      game.exec({ t: 'hdir', p: 0, x: dirs[Math.floor(rng() * 3)], z: dirs[Math.floor(rng() * 3)], s: rng() < 0.2 });
    }
    if (rng() < 0.05) game.exec({ t: 'stance', s: ['defend', 'guard', 'attack'][Math.floor(rng() * 3)], p: 0 });
    if (rng() < 0.1) game.exec({ t: 'pay', p: 0, on: rng() < 0.5 });
    const frame = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < frame && !game.over; i++) game.update(SIM_DT);
  }
  return {
    game,
    replay: { v: REPLAY_VERSION, frames: game.steps, heroIndex: 0, heroes, log: game.inputLog },
    report: buildMatchReport(game),
  };
}

test('a recorded match replays to the identical report', () => {
  const { replay, report } = playRecordedMatch();
  const checked = validateReplayPayload(JSON.parse(JSON.stringify(replay)));
  assert.equal(checked.ok, true);
  const result = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242, replay: checked.replay });
  assert.equal(result.status, 'complete');
  assert.deepEqual(diffReports(report, result.report), []);
  assert.deepEqual(result.report, report);
});

test('a second match in the same process replays identically (entity ids reset)', () => {
  playRecordedMatch({ script: 1 });
  const { replay, report } = playRecordedMatch({ script: 2 });
  const result = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242, replay });
  assert.deepEqual(diffReports(report, result.report), []);
});

test('a forged outcome is detected', () => {
  const { replay, report } = playRecordedMatch();
  const forged = { ...report, kills: report.kills + 400, won: true };
  const result = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242, replay });
  const diff = diffReports(forged, result.report);
  assert.ok(diff.includes('kills'));
  assert.equal(diff.includes('won'), !report.won);
});

test('the wrong match seed changes the replay', () => {
  const { replay, report } = playRecordedMatch({ steps: 3600 });
  const result = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 1, replay });
  assert.equal(result.status, 'complete');
  assert.notDeepEqual(result.report, report);
});

test('a replay that runs past its deadline times out instead of judging', () => {
  const { replay } = playRecordedMatch({ steps: 1200 });
  let t = 0;
  const result = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242, replay, now: () => (t += 1000), deadline: 2500 });
  assert.equal(result.status, 'timeout');
});

test('replay payload validation refuses malformed logs', () => {
  const base = { v: REPLAY_VERSION, frames: 10, heroIndex: 0, heroes: 'alexander', log: [] };
  assert.equal(validateReplayPayload(base).ok, true);
  assert.equal(validateReplayPayload({ ...base, v: 99 }).error, 'unsupported_replay_version');
  assert.equal(validateReplayPayload({ ...base, frames: 0 }).ok, false);
  assert.equal(validateReplayPayload({ ...base, heroes: 'not_a_hero' }).ok, false);
  assert.equal(validateReplayPayload({ ...base, log: [[5, { t: 'x' }], [4, { t: 'y' }]] }).detail, 'log_order');
  assert.equal(validateReplayPayload({ ...base, log: [[11, { t: 'x' }]] }).detail, 'log_order');
  assert.equal(validateReplayPayload({ ...base, log: [[1, 'pay']] }).detail, 'log_command');
  assert.equal(validateReplayPayload({ ...base, heroIndex: 2 }).ok, false);
});

test('the reporter camp is rebuilt from server-owned level and items', () => {
  const camp = rebuildOwnCamp(
    { lattice: Array.from({ length: 200 }, (_, i) => `n${i}`), upgrades: { aura: 99 }, classKey: 'vanguard' },
    { level: 3, xp: 10, items: [], equipment: {}, socketMods: {}, relics: [] },
  );
  assert.equal(camp.level, 3);
  assert.ok(camp.lattice.length <= 32, 'lattice is capped by the points a level-3 character can have');
  assert.deepEqual(camp.items, []);
});

test('review policy keeps logs of leaderboard candidates and flags suspicious runs', () => {
  const report = {
    mode: 'campaign', levelId: 2, won: true, durationSeconds: 600, threatLevel: 3, kills: 100, coins: 100,
    nests: 1, nodes: 1, built: 10, lost: 0, bossKillT: null, pack: [],
  };
  assert.ok(reviewReasons(report, { bestScore: null }).includes('personal_best'));
  assert.ok(reviewReasons(report, { bestScore: 1e9, campaignCleared: 1 }).includes('first_clear'));
  assert.deepEqual(reviewReasons(report, { bestScore: 1e9, campaignCleared: 5 }), [], 'no random spot checks');
  assert.deepEqual(reviewReasons({ ...report, pack: ['x'] }, { bestScore: 1e9, campaignCleared: 5 }), [], 'loot is proven by the loot table, not a replay');
  const kills = reviewReasons({ ...report, kills: 9000 }, { bestScore: 1e9, campaignCleared: 5 });
  assert.ok(kills.includes('suspicious_kills') && isFlagged(kills));
  const speed = reviewReasons(report, { bestScore: 1e9, campaignCleared: 5, serverElapsedSeconds: 100 });
  assert.ok(speed.includes('suspicious_speed') && isFlagged(speed));
  assert.equal(isFlagged(['personal_best', 'first_clear']), false, 'a best alone is not suspicious');
});
