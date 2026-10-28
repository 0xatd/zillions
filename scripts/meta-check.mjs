// Meta check: the procedural campaign levels past Earth, and the local
// (guest/offline) meta-progression ladder, built headless.
//
//   1. Does the simulation accept a procedural level of every kind? A level
//      generated past the authored campaign must build, muster, and score.
//   2. Can the meta ladder be broken? The tree must have no orphaned or
//      circular prerequisites, and no sequence of awards and purchases —
//      including hostile ones — may drive a balance negative or hand out a
//      node nobody paid for.
//
// The local meta ledger is guest/offline progress only; signed-in Alloy is
// granted by the server (see api/match-result.js and scripts/match-result-check.mjs).
import assert from 'node:assert/strict';
import {
  META_NODES, META_NODES_BY_ID, META_BRANCHES, META_EARN_RATE, emptyMeta,
  normalizeMeta, applyAward, applySpend, bonusesFor, metaTreeView, nodeState,
  loadMeta, awardRun, spend, metaBonuses, setMetaBackend, memoryBackend, resetMeta,
  threatTierFor,
} from '../src/meta.js';
import { LEVELS, LABYRINTH_LEVELS, levelById, galaxyWorldKind, isGalaxyLevel } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';
import { Game, runScore } from '../src/game.js';

const REPORT = process.argv.includes('--report');

// Procedural campaign levels continue past the authored ones. Take the first
// few of each kind and play them for real.
const frontier = [];
for (let id = LEVELS.length + 1; id < LEVELS.length + 40 && frontier.length < 12; id++) {
  if (!isGalaxyLevel(id)) continue;
  const level = levelById(id);
  frontier.push({ id: `level-${id}`, name: level.name, levelId: id, kind: galaxyWorldKind(id), mult: level.mult });
}
const worldMissionMode = () => 'campaign';
assert.ok(frontier.length >= 3, 'procedural levels must exist past the authored campaign');

// Threat tiers stay pinned to the multiplier ladder.
assert.equal(threatTierFor(1), 0, 'an Earth-grade multiplier is tier 0');
assert.equal(threatTierFor(2), 0, 'the tier boundary is inclusive');
assert.equal(threatTierFor(2.5), 1, 'just past the boundary is tier 1');
assert.equal(threatTierFor(50), 9, 'tiers cap at 9');
assert.equal(threatTierFor(NaN), 0, 'a broken multiplier reads as tier 0');

// 1. The simulation accepts a procedural level
// ---------------------------------------------------------------------------
// One level per kind, played for real: found a city, run the clock, and check
// the hives muster.
const simSamples = ['standard', 'holdout', 'derelict'].map((kind) => frontier.find((w) => w.kind === kind));
const scores = [];
for (const world of simSamples) {
  const level = levelById(world.levelId);
  const label = `${world.name} (${world.kind})`;
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'alexander', null, world.levelId, worldMissionMode(world));
  game.foundCity(0, 0);
  assert.equal(game.level.id, world.levelId, `${label}: the sim looked up a different level`);
  assert.equal(game.level.mult, world.mult, `${label}: the sim disagrees about difficulty`);
  assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph`);
  assert.ok(game.nests.every((n) => n.alive), `${label} shipped an unreachable hive`);
  assert.ok(game.activeNodes().length >= 6, `${label} has too few reachable nodes`);
  for (let i = 0; i < 20 * 30; i++) game.update(1 / 30);
  assert.ok(game.zombies.length > 0, `${label}: the hives never mustered`);

  // Scoring is read-only: taking a score must not perturb the simulation.
  const before = game.snapshot();
  const score = runScore(game);
  assert.deepEqual(game.snapshot(), before, `${label}: scoring a run changed the simulation`);
  assert.ok(score.score >= 0, `${label}: a run scored negative`);
  assert.equal(score.levelId, world.levelId, `${label}: the score names the wrong world`);
  assert.equal(score.worldKind, world.kind, `${label}: the score forgot what kind of world it was`);
  assert.equal(score.mult, world.mult, `${label}: the score forgot how hard the world was`);
  scores.push({ world, score });
}

// A catastrophic loss still scores, and still scores at zero or better.
{
  const ruin = runScore({
    stats: { kills: 0, coins: 0, nests: 0, nodes: 0, built: 0, lost: 500, bestHeld: 0, heroDeaths: 9, bossKillT: null },
    won: false, mode: 'campaign', levelId: frontier[0].levelId, level: levelById(frontier[0].levelId), threatLevel: 1,
  });
  assert.equal(ruin.score, 0, 'a total defeat must floor at zero, never go negative');
  const empty = runScore({});
  assert.equal(empty.score, 0, 'scoring nothing must not throw or go negative');
}

// ---------------------------------------------------------------------------
// 2. The meta tree is well formed
// ---------------------------------------------------------------------------
assert.equal(META_NODES.length, 12, 'the meta tree ships twelve nodes');
assert.equal(Object.keys(META_BRANCHES).length, 3, 'the meta tree ships three branches');
{
  const seen = new Set();
  for (const node of META_NODES) {
    assert.ok(!seen.has(node.id), `duplicate meta node id ${node.id}`);
    seen.add(node.id);
    assert.ok(META_BRANCHES[node.branch], `${node.id} belongs to no branch`);
    assert.ok(node.name && node.desc, `${node.id} has no player-facing copy`);
    assert.ok(Number.isInteger(node.cost) && node.cost > 0, `${node.id} must cost a positive whole number`);
    assert.ok(Array.isArray(node.requires), `${node.id} has no prerequisite list`);
    // Effects are DATA. A payload that carried behaviour could change the sim.
    const groups = Object.entries(node.effect || {});
    assert.ok(groups.length > 0, `${node.id} does nothing`);
    for (const [group, payload] of groups) {
      assert.ok(['economy', 'hero', 'unlock'].includes(group), `${node.id} uses unknown effect group "${group}"`);
      for (const [key, value] of Object.entries(payload)) {
        assert.equal(typeof value, 'number', `${node.id}.${group}.${key} is not a number — effects must be data`);
        assert.ok(Number.isFinite(value) && value > 0, `${node.id}.${group}.${key} must be a positive number`);
      }
    }
  }
  for (const branch of Object.keys(META_BRANCHES)) {
    const nodes = META_NODES.filter((n) => n.branch === branch);
    assert.equal(nodes.length, 4, `branch ${branch} must hold four nodes`);
    assert.ok(nodes.some((n) => n.requires.length === 0), `branch ${branch} has no entry node`);
  }
  // No orphaned prerequisites, and no cycles: every node must be reachable by
  // buying its way up from an entry node.
  for (const node of META_NODES) {
    for (const req of node.requires) {
      assert.ok(META_NODES_BY_ID.has(req), `${node.id} requires "${req}", which is not a node`);
      assert.equal(META_NODES_BY_ID.get(req).branch, node.branch, `${node.id} reaches across branches for "${req}"`);
      assert.ok(META_NODES_BY_ID.get(req).cost < node.cost, `${node.id} costs no more than its own prerequisite`);
    }
  }
  const resolved = new Set();
  for (let pass = 0; pass < META_NODES.length + 1 && resolved.size < META_NODES.length; pass++) {
    for (const node of META_NODES) {
      if (resolved.has(node.id)) continue;
      if (node.requires.every((r) => resolved.has(r))) resolved.add(node.id);
    }
  }
  assert.equal(resolved.size, META_NODES.length, 'the meta tree has a prerequisite cycle — some nodes can never be bought');
}

// ---------------------------------------------------------------------------
// 3. Award and spend math cannot go negative
// ---------------------------------------------------------------------------
setMetaBackend(memoryBackend(null));
{
  const fresh = loadMeta({ force: true });
  assert.equal(fresh.currency, 0, 'a new profile starts with nothing');
  assert.deepEqual(fresh.nodes, {}, 'a new profile owns no nodes');
  assert.deepEqual(bonusesFor(fresh).economy, { startGold: 0, income: 0 }, 'a new profile has no bonuses');

  // Hostile score results: nothing here may mint or destroy currency.
  const hostile = [
    { score: -100000, won: true, levelId: 6 },
    { score: NaN, won: true, levelId: 6 },
    { score: Infinity, won: true, levelId: 6 },
    { score: '900000000000', won: true, levelId: 6 },
    {}, null, undefined,
  ];
  for (const bad of hostile) {
    const before = loadMeta().currency;
    const result = awardRun(bad || {});
    assert.ok(result.earned >= 0, `an award paid out ${result.earned}`);
    assert.ok(loadMeta().currency >= before, 'an award must never reduce the balance');
    assert.ok(Number.isFinite(loadMeta().currency), 'the balance must stay a real number');
  }
  resetMeta();
}

{
  // A real run pays out, and the payout follows the published rate.
  const sample = scores[0].score;
  const award = awardRun({ ...sample, score: 5000, won: true, cleared: true });
  assert.equal(award.earned, Math.round(5000 * META_EARN_RATE), 'the payout must follow the published rate');
  assert.equal(loadMeta().currency, award.earned, 'the payout must land in the balance');
  assert.equal(loadMeta().lifetime.runs, 1, 'a run must be counted');
  assert.equal(loadMeta().records.worldsCleared, 1, 'a cleared world must be recorded');
  assert.ok(loadMeta().records.highestThreat >= 2.2, 'the highest threat cleared must be recorded');
  assert.equal(loadMeta().records.highestTier, threatTierFor(sample.mult), 'the threat band cleared must be recorded');

  // Clearing the same world twice does not double-count it.
  awardRun({ ...sample, score: 5000, won: true, cleared: true });
  assert.equal(loadMeta().records.worldsCleared, 1, 'a re-run must not re-count a world');
  assert.equal(loadMeta().lifetime.runs, 2, 'a re-run is still a run');

  // A labyrinth trial is never a world.
  awardRun({ score: 1000, won: true, levelId: LABYRINTH_LEVELS[0].id, worldKind: 'labyrinth', mult: 1 });
  assert.equal(loadMeta().records.worldsCleared, 1, 'a labyrinth trial must never count as a world cleared');
  resetMeta();
}

{
  // Spending: refusals are total. Nothing is deducted, nothing is granted.
  awardRun({ score: 10000, won: true, levelId: 6, mult: 2.22 });
  const funded = loadMeta().currency;
  assert.ok(funded >= 200, 'the test needs a funded profile');

  for (const [nodeId, reason] of [['not_a_node', 'unknown'], ['supply_depot', 'locked'], ['warband_focus', 'locked']]) {
    const before = loadMeta().currency;
    const result = spend(nodeId);
    assert.equal(result.ok, false, `${nodeId} should not have been purchasable`);
    assert.equal(result.reason, reason, `${nodeId} was refused for the wrong reason`);
    assert.equal(loadMeta().currency, before, `a refused purchase of ${nodeId} still charged the player`);
    assert.ok(!loadMeta().nodes[nodeId], `a refused purchase of ${nodeId} still granted the node`);
  }

  const bought = spend('supply_cache');
  assert.equal(bought.ok, true, 'an affordable, unlocked node must be purchasable');
  assert.equal(loadMeta().currency, funded - META_NODES_BY_ID.get('supply_cache').cost, 'a purchase must charge exactly its cost');
  assert.equal(loadMeta().lifetime.spent, META_NODES_BY_ID.get('supply_cache').cost, 'spending must be recorded');
  assert.equal(spend('supply_cache').reason, 'owned', 'a node cannot be bought twice');
  assert.equal(metaBonuses().economy.startGold, 25, 'an owned node must pay its effect');
  assert.equal(nodeState(loadMeta(), 'supply_cache'), 'owned', 'an owned node must read as owned');
  assert.equal(nodeState(loadMeta(), 'warband_focus'), 'locked', 'a gated node must read as locked');

  // Drain the balance and try to overspend: refused, and never negative.
  let guard = 0;
  while (loadMeta().currency > 0 && guard++ < 200) {
    const affordable = META_NODES.find((n) => nodeState(loadMeta(), n.id) === 'available');
    if (!affordable) break;
    spend(affordable.id);
  }
  const broke = loadMeta();
  assert.ok(broke.currency >= 0, `overspending drove the balance to ${broke.currency}`);
  for (const node of META_NODES) {
    if (broke.nodes[node.id]) continue;
    const result = spend(node.id);
    assert.equal(result.ok, false, `${node.id} was bought with an empty balance`);
    assert.ok(['poor', 'locked', 'owned'].includes(result.reason), `${node.id} refused for an odd reason`);
  }
  assert.ok(loadMeta().currency >= 0, 'a failed spending spree must leave a non-negative balance');
  assert.equal(loadMeta().lifetime.spent + loadMeta().currency, loadMeta().lifetime.earned,
    'earned must always equal spent plus held — currency is neither minted nor lost');
  resetMeta();
}

{
  // The whole tree is reachable, and the payload adds up to exactly the sum of
  // what was bought.
  let meta = emptyMeta();
  meta.currency = META_NODES.reduce((sum, n) => sum + n.cost, 0);
  for (let pass = 0; pass < META_NODES.length; pass++) {
    for (const node of META_NODES) {
      const result = applySpend(meta, node.id);
      if (result.ok) meta = result.meta;
    }
  }
  assert.equal(Object.keys(meta.nodes).length, META_NODES.length, 'the full tree must be purchasable');
  assert.equal(meta.currency, 0, 'buying every node must spend exactly the tree total');
  const full = bonusesFor(meta);
  assert.equal(full.economy.startGold, 100, 'the supply branch must total +100 starting gold');
  assert.ok(Math.abs(full.economy.income - 0.14) < 1e-9, 'the supply branch must total +14% income');
  assert.equal(full.hero.hp, 40, 'the warband branch must total +40 hero HP');
  assert.ok(Math.abs(full.hero.dmg - 0.1) < 1e-9, 'the warband branch must total +10% hero damage');
  assert.equal(full.unlock.saveSlots, 1, 'the command branch must grant a save slot');
  assert.equal(full.unlock.galaxyDepth, 3, 'the command branch must total three systems of chart depth');
  assert.equal(full.nodes.length, META_NODES.length, 'the payload must name every owned node');

  // A hand-edited profile cannot smuggle in a node it never earned the way to.
  const forged = normalizeMeta({ currency: -50, nodes: { warband_focus: 1, command_harness: 1, ghost_node: 1 } });
  assert.equal(forged.currency, 0, 'a negative balance normalises to zero');
  assert.deepEqual(forged.nodes, {}, 'nodes with missing prerequisites must be dropped, not honoured');
  assert.deepEqual(bonusesFor(forged), bonusesFor(emptyMeta()), 'a forged profile must pay out nothing');

  const view = metaTreeView(meta);
  assert.equal(view.branches.length, 3, 'the tree view must show every branch');
  assert.equal(view.branches.reduce((n, b) => n + b.nodes.length, 0), META_NODES.length, 'the tree view must show every node');
  assert.ok(view.branches.every((b) => b.nodes.every((n) => n.owned)), 'a fully bought tree must read as owned');
}

// Storage round-trips through the backend, which is the seam a server takes.
{
  const backend = memoryBackend(null);
  setMetaBackend(backend);
  awardRun({ score: 30000, won: true, levelId: 7, mult: 2.44 }, { now: 1234 });
  spend('warband_vigor');
  const persisted = backend.read();
  assert.ok(persisted && persisted.nodes.warband_vigor, 'purchases must reach the backend');
  assert.equal(persisted.v, 1, 'persisted state must carry its version');
  setMetaBackend(memoryBackend(persisted));
  assert.equal(loadMeta({ force: true }).nodes.warband_vigor, 1, 'a reloaded profile must keep what it bought');
  assert.equal(metaBonuses().hero.hp, 40, 'a reloaded profile must keep its bonuses');
}
setMetaBackend(memoryBackend(null));
loadMeta({ force: true });

if (REPORT) {
  console.log('\nprocedural levels:');
  for (const w of frontier) console.log(`  ${w.levelId} ${w.name} [${w.kind}] x${w.mult.toFixed(2)}`);
  console.log('\nmeta tree:');
  for (const branch of metaTreeView(emptyMeta()).branches) {
    console.log(`  ${branch.name}: ${branch.nodes.map((n) => `${n.name} (${n.cost})`).join(' → ')}`);
  }
}

console.log(`meta check passed: ${simSamples.length} procedural level kinds simulated, `
  + `${META_NODES.length} meta nodes across ${Object.keys(META_BRANCHES).length} branches, award/spend math held`);
