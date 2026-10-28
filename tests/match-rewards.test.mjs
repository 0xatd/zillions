import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY, THREAT, levelById, threatClockMult } from '../src/config.js';
import { MATCH_REPORT_VERSION, maxThreatLevel, validateMatchReport, verifyLootKey } from '../src/match-rewards.js';
import { scatteredLootKeys } from '../src/loot-table.js';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { isRolledKey } from '../src/items.js';

const report = (over = {}) => ({
  version: MATCH_REPORT_VERSION, mode: 'campaign', levelId: 1, difficulty: 'normal', won: false,
  durationSeconds: 600, threatLevel: 1, kills: 200, coins: 100, nests: 0, nodes: 0, built: 10, lost: 0,
  bestHeld: 2, heroDeaths: 0, bossKillT: null, hqTier: 1, standingBuildings: 10, pack: [], hero: 'scott', ...over,
});

// Threat as Game._updateSiege() and friends accumulate it, worst case.
function simulatedThreat({ seconds, liveNests, diff = 'normal', captures = 0, razes = 0 }) {
  let threat = 0;
  for (let t = 0; t < seconds; t++) {
    threat = Math.min(THREAT.max, threat + (THREAT.perSecond + THREAT.perNest * Math.min(3, liveNests)) * 1 * threatClockMult(DIFFICULTY[diff].mult));
  }
  threat = Math.min(THREAT.max, threat + captures * THREAT.perCapture + razes * THREAT.perNestRazed);
  return Math.max(1, Math.floor(threat) + 1);
}

test('Threat bound covers per-hive pressure: a normal 600 s run with three hives reaches Threat 7', () => {
  assert.equal(levelById(1).nests, 3);
  const reached = simulatedThreat({ seconds: 600, liveNests: 3 });
  assert.equal(reached, 7, 'three live hives push a 600 s normal run to Threat 7');
  const checked = validateMatchReport(report({ threatLevel: 7 }));
  assert.equal(checked.ok, true, `Threat 7 at 600 s must be plausible (got ${checked.error} ${checked.detail || ''})`);
});

test('Threat bound covers difficulty, captures and razed hives', () => {
  const cases = [
    { diff: 'brutal', seconds: 600, captures: 0, razes: 0 },
    { diff: 'normal', seconds: 600, captures: 12, razes: 3 },
    { diff: 'brutal', seconds: 1200, captures: 20, razes: 3 },
    { diff: 'casual', seconds: 300, captures: 4, razes: 1 },
  ];
  for (const c of cases) {
    const reached = simulatedThreat({ ...c, liveNests: 3 });
    const bound = maxThreatLevel({ durationSeconds: c.seconds, levelId: 1, difficulty: c.diff, nodes: c.captures, nests: c.razes });
    assert.ok(bound >= reached, `${JSON.stringify(c)}: bound ${bound} < reachable ${reached}`);
    const checked = validateMatchReport(report({ difficulty: c.diff, durationSeconds: c.seconds, nodes: c.captures, nests: c.razes, threatLevel: reached }));
    assert.equal(checked.ok, true, `${JSON.stringify(c)} rejected: ${checked.error} ${checked.detail || ''}`);
  }
  // Still a bound: an impossible Threat is refused.
  assert.equal(validateMatchReport(report({ threatLevel: 12 })).detail, 'threatLevel');
  assert.equal(validateMatchReport(report({ threatLevel: 50, durationSeconds: 14000 })).detail, 'threatLevel');
});

test('rolled loot must be the complete key the match scattered (forged rarity refused)', () => {
  const table = scatteredLootKeys({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 });
  const real = 'scatter_mk1:v745jd:1:1';
  assert.ok(table.has(real), 'seed 4242 on level 1 scatters scatter_mk1:v745jd:1:1');
  assert.equal(verifyLootKey(real, { levelId: 1, lootTable: table }), true);
  for (const forged of ['scatter_mk1:v745jd:1:3', 'scatter_mk1:v745jd:1:2', 'buckler:v745jd:1:1']) {
    assert.equal(verifyLootKey(forged, { levelId: 1, lootTable: table }), false, `${forged} must not verify`);
    assert.equal(validateMatchReport(report({ pack: [forged] }), { lootTable: table }).error, 'unverifiable_loot');
  }
  assert.equal(validateMatchReport(report({ pack: [real] }), { lootTable: table }).ok, true);
  assert.equal(validateMatchReport(report({ pack: [real] })).error, 'unverifiable_loot', 'no table, no rolled loot');
});

test('the scatter does not depend on the party or culture (so one table serves co-op)', () => {
  const level = levelById(1);
  const keys = (heroes, culture) => {
    const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    const game = new Game(map, 'normal', heroes, null, 1, 'campaign', { rngSeed: 4242, culture });
    return [...new Set(game.loot.map((l) => l.key).filter(isRolledKey))].sort();
  };
  const table = [...scatteredLootKeys({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242 })].sort();
  assert.deepEqual(keys(['scott', 'alexander', 'danny', 'turtle']), table);
  assert.deepEqual(keys('aaron', 'asian'), table);
});
