import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { SIM_DT, levelById } from '../src/config.js';
import { stateHash } from '../src/lockstep-hash.js';
import {
  CURRENCY_RATE_CAP, META_NODES, SUPPLY_CAP, currencyRateBonus, nodeChangesMatch,
  normalizeUpgradeIds, supplyBonus, treeForAccount,
} from '../src/meta.js';
import { MATCH_LIMITS, matchAlloy } from '../src/match-rewards.js';
import { REPLAY_VERSION, replayMatch, validateReplayPayload } from '../src/match-replay.js';
import { buildMatchReport } from '../src/match-report.js';
import { reviewForReport } from '../api/match-result.js';
import { processMatchStart } from '../api/match-start.js';
import { verifyTicket } from '../api/_lib/match-ticket.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123';
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-28T12:00:00Z');

function campaign(upgrades, snap = null) {
  const level = levelById(1);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  return new Game(map, 'normal', 'alexander', snap, 1, 'campaign', { rngSeed: 4242, upgrades });
}

test('upgrade ids normalise, and only Supply Line and Salvage Ledger change a match', () => {
  assert.deepEqual(normalizeUpgradeIds(['supply_tithe', 'nope', 'supply_cache', 'supply_cache', 3]), ['supply_cache', 'supply_tithe']);
  assert.deepEqual(supplyBonus(['supply_cache', 'supply_cache', 'warband_vigor', 'ghost']), { startGold: 25, income: 0 });
  assert.equal(SUPPLY_CAP.startGold, 100);
  assert.ok(Math.abs(SUPPLY_CAP.income - 0.14) < 1e-9);
  assert.equal(currencyRateBonus(['command_ledger', 'command_ledger', 'supply_cache']), 0.1);
  assert.equal(currencyRateBonus(['command_slot', 'command_harness']), 0);
  assert.ok(CURRENCY_RATE_CAP <= 0.1 + 1e-9);
  assert.equal(nodeChangesMatch(META_NODES.find((node) => node.id === 'supply_cache')), true);
  assert.equal(nodeChangesMatch(META_NODES.find((node) => node.id === 'command_ledger')), true);
  assert.equal(nodeChangesMatch(META_NODES.find((node) => node.id === 'warband_vigor')), false);
  assert.equal(nodeChangesMatch(META_NODES.find((node) => node.id === 'command_scanner')), false);
  assert.ok(SUPPLY_CAP.startGold < MATCH_LIMITS.coinSlack, 'the whole Supply Line fits inside the coin slack');
});

test('the tree view reports owned, affordable, locked and short states', () => {
  const view = treeForAccount({ owned: ['supply_cache'], balance: 200 });
  const nodes = Object.fromEntries(view.branches.flatMap((branch) => branch.nodes.map((node) => [node.id, node.state])));
  assert.equal(nodes.supply_cache, 'owned');
  assert.equal(nodes.supply_depot, 'unaffordable');
  assert.equal(nodes.supply_convoy, 'locked');
  assert.equal(nodes.warband_vigor, 'available');
  assert.equal(nodes.warband_edge, 'locked');
  assert.equal(view.currency, 200);
});

test('Supply Line adds gold and income once, survives a snapshot, and skips the Labyrinth', () => {
  const plain = campaign();
  const boosted = campaign(['supply_cache', 'supply_tithe', 'not_a_node']);
  assert.equal(boosted.gold, plain.gold + 25);
  assert.ok(Math.abs(boosted.economy.income - plain.economy.income * 1.06) < 1e-9);
  assert.deepEqual(boosted.loot.map((item) => item.key), plain.loot.map((item) => item.key));
  assert.equal(stateHash(boosted), stateHash(campaign(['supply_tithe', 'supply_cache'])));
  assert.notEqual(stateHash(boosted), stateHash(plain));
  assert.equal('supply' in plain.snapshot(), false);

  const snap = boosted.snapshot();
  assert.equal(snap.supply.startGold, 25);
  const restored = campaign(null, snap);
  assert.equal(restored.gold, boosted.gold);
  assert.equal(restored.economy.supplyGold, 25);
  assert.ok(Math.abs(restored.economy.income - boosted.economy.income) < 1e-9);
  assert.equal(stateHash(restored), stateHash(boosted));

  snap.supply = { startGold: 9000, income: 4 };
  const clamped = campaign(null, snap);
  assert.equal(clamped.economy.supplyGold, SUPPLY_CAP.startGold);
  assert.ok(clamped.economy.supplyIncome <= SUPPLY_CAP.income + 1e-12);

  const level = levelById(9001);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const trial = new Game(map, 'normal', 'alexander', null, 9001, 'labyrinth', { rngSeed: 7, upgrades: META_NODES.map((node) => node.id) });
  const bare = new Game(new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests }), 'normal', 'alexander', null, 9001, 'labyrinth', { rngSeed: 7 });
  assert.equal(trial.gold, bare.gold);
  assert.equal(trial.economy.supplyGold, undefined);
  assert.equal(stateHash(trial), stateHash(bare));
});

test('a replay carries the Supply Line, and an old log does not', () => {
  const level = levelById(1);
  const play = (upgrades) => {
    const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    const game = new Game(map, 'normal', 'alexander', null, 1, 'campaign', { rngSeed: 4242, upgrades });
    game.inputLog = [];
    game.exec({ t: 'found', s: 0, p: 0 });
    while (game.steps < 90 && !game.over) game.update(SIM_DT);
    return { game, report: buildMatchReport(game) };
  };
  const { game, report } = play(['supply_cache']);
  const replay = { v: REPLAY_VERSION, frames: game.steps, heroIndex: 0, heroes: 'alexander', log: game.inputLog, upgrades: ['supply_cache', 'bogus'] };
  const checked = validateReplayPayload(replay);
  assert.deepEqual(checked.replay.upgrades, ['supply_cache']);
  const again = replayMatch({ levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242, replay: checked.replay });
  assert.equal(again.status, 'complete');
  assert.deepEqual(again.report, report);
  const bare = replayMatch({
    levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242,
    replay: { v: REPLAY_VERSION, frames: 1, heroIndex: 0, heroes: 'alexander', log: [] },
  });
  const withGold = replayMatch({
    levelId: 1, mode: 'campaign', difficulty: 'normal', seed: 4242,
    replay: { v: REPLAY_VERSION, frames: 1, heroIndex: 0, heroes: 'alexander', log: [], upgrades: ['supply_cache'] },
  });
  assert.equal(withGold.gold, bare.gold + 25);
});

test('Salvage Ledger raises Alloy from the ticket, and a solo log keeps the ticket list', () => {
  const report = {
    version: 1, mode: 'campaign', levelId: 1, difficulty: 'normal', won: true,
    durationSeconds: 600, threatLevel: 2, kills: 2000, coins: 400, nests: 1, nodes: 4, built: 20, lost: 0,
    bestHeld: 1, heroDeaths: 0, bossKillT: null, hqTier: 1, standingBuildings: 6, pack: [], hero: 'scott',
  };
  const plain = matchAlloy(report);
  const boosted = matchAlloy(report, currencyRateBonus(['command_ledger']));
  assert.ok(boosted > plain);
  assert.ok(boosted <= MATCH_LIMITS.maxAlloyPerMatch);
  assert.equal(matchAlloy(report, 9), matchAlloy(report, CURRENCY_RATE_CAP));

  const body = {
    replay: {
      v: REPLAY_VERSION, frames: 30, heroIndex: 0, heroes: 'alexander', log: [],
      upgrades: ['supply_convoy', 'not_a_node'],
    },
  };
  const context = { previousReports: [], stats: {}, items: [] };
  const solo = reviewForReport({
    report, ticket: { ups: ['supply_cache', 'command_ledger'] }, body, context, serverElapsedSeconds: 900,
  });
  assert.deepEqual(solo.log.upgrades, ['command_ledger', 'supply_cache']);
  const coop = reviewForReport({
    report,
    ticket: { rid: '22222222-2222-4222-8222-222222222222', ups: ['supply_cache'] },
    body: { replay: { ...body.replay, heroes: ['alexander', 'scott'], upgrades: ['supply_depot'] } },
    context, serverElapsedSeconds: 900,
  });
  assert.deepEqual(coop.log.upgrades, ['supply_depot']);
});

test('match-start signs the server upgrade list and drops unknown ids', async () => {
  const issued = new Date(NOW).toISOString();
  const store = {
    async issueTicket(args) {
      assert.equal(args.p_actor, USER);
      return {
        id: '44444444-4444-4444-8444-444444444444', seed: args.p_seed,
        issued_at: issued, expires_at: new Date(NOW + 3600e3).toISOString(),
        upgrades: ['warband_vigor', 'supply_cache', 'supply_cache', 'free_money'],
      };
    },
  };
  const started = await processMatchStart({
    userId: USER, body: { characterId: 'mmo_a', levelId: 1, mode: 'campaign', difficulty: 'normal' },
    store, secret: SECRET, now: NOW,
  });
  assert.deepEqual(started.upgrades, ['supply_cache', 'warband_vigor']);
  const verified = verifyTicket(started.ticket, SECRET, { userId: USER, now: NOW });
  assert.deepEqual(verified.payload.ups, ['supply_cache', 'warband_vigor']);
});
