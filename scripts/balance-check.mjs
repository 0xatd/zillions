import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generatePlots } from '../src/plots.js';
import {
  LEVELS, PAY_RADIUS, PLOT_KINDS, SIEGE, START_GOLD, THREAT, TILE, UNITS,
  hiveInterval, hiveSquad,
} from '../src/config.js';

function fakeMap(level) {
  const size = level.size || 160;
  const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
  const centers = [
    [size / 2 + 21, size / 2 - 13],
    [size / 2 - 19, size / 2 + 14],
    [size / 2 + 8, size / 2 + 24],
    [size / 2 - 27, size / 2 - 4],
  ];
  for (const [cx, cz] of centers) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dz * dz > 6) continue;
        const x = Math.round(cx + dx);
        const z = Math.round(cz + dz);
        tiles[z * size + x] = TILE.GOLDORE;
      }
    }
  }
  // Nests and lane nodes ring the city so the siege systems have real targets.
  const ring = (count, radius, from) => Array.from({ length: count }, (_, i) => {
    const ang = (i / count) * Math.PI * 2 + from;
    return [
      Math.round(size / 2 + Math.cos(ang) * radius),
      Math.round(size / 2 + Math.sin(ang) * radius),
    ];
  });
  return {
    size,
    seed: level.seed,
    sites: [{ x: size / 2, z: size / 2 }],
    tiles,
    nestSpots: ring(level.nests || 3, size * 0.36, 0.3),
    nodeSpots: ring(8, size * 0.24, 0.1).map(([x, z], i) => ({ x, z, name: `Node ${i + 1}` })),
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

function tierCost(kind, tier = 0) {
  return PLOT_KINDS[kind].tiers[tier].cost;
}

const openingCost =
  tierCost('tower') +
  tierCost('camp_ranger') +
  tierCost('farm') +
  tierCost('house');

// Income is a continuous trickle now, so payback is measured in seconds of
// siege rather than in dawns. A level runs many minutes; anything that takes
// longer than three minutes to pay for itself is a trap.
const MAX_PAYBACK_SECONDS = 180;
const paybacks = [
  ['farm t2', tierCost('farm', 1), PLOT_KINDS.farm.tiers[1].income - PLOT_KINDS.farm.tiers[0].income],
  ['house t2', tierCost('house', 1), PLOT_KINDS.house.tiers[1].income - PLOT_KINDS.house.tiers[0].income],
  ['mill t2', tierCost('mill', 1), PLOT_KINDS.mill.tiers[1].income - PLOT_KINDS.mill.tiers[0].income],
  ['mine t2', tierCost('mine', 1), PLOT_KINDS.mine.tiers[1].income - PLOT_KINDS.mine.tiers[0].income],
];

function assertUpgradeReachFromAllSides(level) {
  const map = fakeMap(level);
  const game = new Game(map, 'normal', 'alexander', null, level.id || 1, 'campaign');
  game.foundCity(0, 0);
  const plot = game.plots.find((p) => p.kind === 'house');
  assert.ok(plot, `${level.name} did not generate a house plot`);
  game._construct(plot, true);

  for (const other of game.plots) {
    if (other === plot) continue;
    other.tier = PLOT_KINDS[other.kind].tiers.length;
  }

  const h = game.heroes[0];
  const offset = Math.min(1.0, PAY_RADIUS * 0.6);
  const probes = [
    ['north/top', plot.cx, plot.z - offset],
    ['south/bottom', plot.cx, plot.z + plot.size + offset],
    ['west/left', plot.x - offset, plot.cz],
    ['east/right', plot.x + plot.size + offset, plot.cz],
    ['northwest corner', plot.x - offset, plot.z - offset],
    ['northeast corner', plot.x + plot.size + offset, plot.z - offset],
  ];

  for (const [side, x, z] of probes) {
    h.x = x;
    h.z = z;
    const target = game.buildTargetFor(h);
    assert.equal(target?.plot?.id, plot.id, `${level.name} upgrade target failed from ${side}`);
  }
}

// The siege must actually run: hives muster, camps muster, nodes flip, and
// repairing a damaged structure has to cost gold and restore health.
function assertSiegeLoop(level) {
  const map = fakeMap(level);
  const game = new Game(map, 'normal', 'alexander', null, level.id || 1, 'campaign');
  game.foundCity(0, 0);
  assert.equal(game.phase, 'live', `${level.name} did not enter the live siege after founding`);
  assert.ok(game.laneGraph && game.laneGraph.size > 0, `${level.name} built no lane graph`);
  assert.ok(game.nodes.length > 0, `${level.name} generated no lane nodes`);
  assert.ok(
    game.plots.some((p) => p.kind === 'outpost'),
    `${level.name} generated no Forward Camp plots on its nodes`,
  );
  assert.ok(game.plotLocked(game.plots.find((p) => p.kind === 'outpost')),
    `${level.name} lets a Forward Camp be funded on ground the player does not hold`);

  // Every node must be reachable from the city, or the army can never push.
  for (const node of game.nodes) {
    assert.ok(game.laneGraph.adj[node.gi].length > 0, `${level.name}: ${node.name} has no lane`);
  }

  // A camp is a faucet: it musters on build, and again on its timer.
  const camp = game.plots.find((p) => p.kind === 'camp_ranger');
  game._construct(camp, false);
  const afterBuild = game.units.filter((u) => !u.hero).length;
  assert.ok(afterBuild > 0, `${level.name} camp mustered nobody when raised`);
  const def = game.tierDef(camp, camp.tier);
  for (let i = 0; i < def.every * 2 + 2; i++) game._updateCamps(0.5);
  assert.ok(
    game.units.filter((u) => !u.hero).length > afterBuild,
    `${level.name} camp never mustered a second squad`,
  );

  // Hives keep producing on their own, forever.
  const before = game.zombies.length;
  for (let i = 0; i < 40; i++) game._updateHives(1);
  assert.ok(game.zombies.length > before, `${level.name} hives never mustered`);

  // Standing on a clear node takes it.
  const node = game.nodes[0];
  game.zombies = [];
  const hero = game.heroes[0];
  hero.x = node.x; hero.z = node.z;
  for (let i = 0; i < (SIEGE.captureTime + 1) * 4; i++) { game._nodeT = 0; game._updateNodes(0.25); }
  assert.equal(node.owner, 'player', `${level.name} node capture never completed`);
  assert.ok(game.stats.bestHeld >= 1, `${level.name} did not record held nodes`);
  assert.ok(!game.plotLocked(game.plots.find((p) => p.kind === 'outpost' && p.nodeId === node.id)),
    `${level.name} kept the Forward Camp locked on a node the player holds`);

  // Damage no longer heals itself — repairing is a real gold sink. Upgrading
  // still restores health, so repair is only offered once a plot is maxed.
  const house = game.plots.find((p) => p.kind === 'house');
  while (game.nextTier(house)) game._construct(house, true);
  const b = game.buildings.find((o) => o.plotId === house.id);
  b.hp = b.maxHp * 0.5;
  const act = game.plotAction(house);
  assert.equal(act.mode, 'repair', `${level.name} damaged structure did not offer a repair`);
  assert.ok(act.cost > 0, `${level.name} repair was free`);
  game.gold = 500;
  const goldBefore = game.gold;
  hero.x = house.cx; hero.z = house.cz;
  hero.payHold = true;
  for (let i = 0; i < 60; i++) game._updatePlots(1 / 30);
  assert.ok(game.gold < goldBefore, `${level.name} repair did not spend gold`);
  assert.ok(b.hp > b.maxHp * 0.5, `${level.name} repair did not restore health`);

  // A destroyed structure leaves a ruin that must be bought back.
  const b2 = game.buildings.find((o) => o.plotId === house.id);
  game._destroyBuilding(b2, true);
  assert.ok(house.ruined, `${level.name} destroyed building left no ruin`);
  const rebuild = game.plotAction(house);
  assert.equal(rebuild.mode, 'rebuild', `${level.name} ruin did not offer a rebuild`);
  assert.ok(rebuild.cost < game.tierDef(house, house.tier).cost, `${level.name} rebuild was not discounted`);
}

assert.equal(START_GOLD, LEVELS[0].economy.startGold, 'fallback start gold must match level 1');
for (const [name, cost, incomeGain] of paybacks) {
  const seconds = (cost / incomeGain) * SIEGE.incomePeriod;
  assert.ok(seconds <= MAX_PAYBACK_SECONDS, `${name} payback is too slow (${Math.round(seconds)}s)`);
}

// Threat has to climb fast enough to matter and slow enough to build against.
{
  const perNestSeconds = 1 / (THREAT.perSecond + THREAT.perNest * 3);
  assert.ok(perNestSeconds > 55 && perNestSeconds < 110,
    `a Threat level with 3 hives standing should take 55-110s, got ${Math.round(perNestSeconds)}s`);
  // Razing hives has to visibly slow the clock, or there is no reward for it.
  const cleanSeconds = 1 / THREAT.perSecond;
  assert.ok(cleanSeconds > perNestSeconds * 1.5,
    'razing every hive must meaningfully slow the Threat clock');
  // Conquest should cost some Threat, but never dominate it.
  assert.ok(THREAT.perCapture > 0 && THREAT.perCapture <= 0.15,
    'node capture Threat bump must stay a nudge, not the main clock');
  assert.ok(hiveInterval(0) > hiveInterval(THREAT.max), 'hives must muster faster as Threat climbs');
  assert.ok(hiveInterval(THREAT.max) >= 8, 'hive muster interval must not collapse to a spam loop');
  let previous = 0;
  for (let threat = 0; threat <= THREAT.max; threat++) {
    const squad = hiveSquad(threat, 1);
    assert.ok(squad.size >= previous, `hive squad shrank at Threat ${threat}`);
    previous = squad.size;
    const total = Object.values(squad.types).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `hive squad mix at Threat ${threat} does not sum to 1`);
    for (const [type, share] of Object.entries(squad.types)) {
      assert.ok(share >= 0, `hive squad share for ${type} went negative at Threat ${threat}`);
    }
  }
}

// Camps are faucets: every camp tier must state a squad size AND a cadence.
for (const [key, kind] of Object.entries(PLOT_KINDS)) {
  if (!kind.unit) continue;
  assert.ok(UNITS[kind.unit], `${key} fields an unknown unit`);
  for (const tier of kind.tiers) {
    assert.ok(tier.count > 0, `${key} tier ${tier.name} musters nobody`);
    assert.ok(tier.every >= 10 && tier.every <= 40, `${key} tier ${tier.name} has an out-of-bounds muster cadence`);
  }
}

let lastStart = 0;
for (const level of LEVELS) {
  const economy = { startGold: START_GOLD, income: 1, pressure: 1, ...(level.economy || {}) };
  assert.ok(economy.startGold >= openingCost, `${level.name} cannot afford a tower/ranger/economy opening`);
  assert.ok(economy.startGold >= lastStart, `${level.name} start gold regresses`);
  assert.ok(economy.income >= 1 && economy.income <= 1.25, `${level.name} income multiplier is out of bounds`);
  assert.ok(economy.pressure >= 0.85 && economy.pressure <= 1.15, `${level.name} pressure multiplier is out of bounds`);
  lastStart = economy.startGold;

  const map = fakeMap(level);
  const plots = generatePlots(map, map.sites[0]);
  assert.ok(plots.length >= 40, `${level.name} generated too few city plots`);
  assertUpgradeReachFromAllSides(level);
  assertSiegeLoop(level);
}
