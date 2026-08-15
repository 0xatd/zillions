import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generatePlots } from '../src/plots.js';
import { LEVELS, PAY_RADIUS, PLOT_KINDS, START_GOLD, TILE, waveForNight } from '../src/config.js';

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
  return {
    size,
    seed: level.seed,
    sites: [{ x: size / 2, z: size / 2 }],
    tiles,
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

const paybacks = [
  ['farm t2', tierCost('farm', 1), PLOT_KINDS.farm.tiers[1].income - PLOT_KINDS.farm.tiers[0].income, 3],
  ['house t2', tierCost('house', 1), PLOT_KINDS.house.tiers[1].income - PLOT_KINDS.house.tiers[0].income, 3],
  ['mill t2', tierCost('mill', 1), PLOT_KINDS.mill.tiers[1].income - PLOT_KINDS.mill.tiers[0].income, 3.5],
  ['mine t2', tierCost('mine', 1), PLOT_KINDS.mine.tiers[1].income - PLOT_KINDS.mine.tiers[0].income, 3.5],
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

assert.equal(START_GOLD, LEVELS[0].economy.startGold, 'fallback start gold must match level 1');
for (const [name, cost, incomeGain, maxDawns] of paybacks) {
  assert.ok(cost / incomeGain <= maxDawns, `${name} payback is too slow`);
}

let lastStart = 0;
for (const level of LEVELS) {
  const economy = { startGold: START_GOLD, income: 1, wave: 1, nightMax: 150, ...(level.economy || {}) };
  assert.ok(economy.startGold >= openingCost, `${level.name} cannot afford a tower/ranger/economy opening`);
  assert.ok(economy.startGold >= lastStart, `${level.name} start gold regresses`);
  assert.ok(economy.nightMax >= 100 && economy.nightMax <= 150, `${level.name} night safety timer is out of bounds`);
  assert.ok(economy.income >= 1 && economy.income <= 1.25, `${level.name} income multiplier is out of bounds`);
  assert.ok(economy.wave >= 0.85 && economy.wave <= 1.15, `${level.name} wave multiplier is out of bounds`);
  lastStart = economy.startGold;

  const map = fakeMap(level);
  const plots = generatePlots(map, map.sites[0]);
  assert.ok(plots.length >= 40, `${level.name} generated too few city plots`);
  assertUpgradeReachFromAllSides(level);

  let previousWave = 0;
  for (let night = 1; night <= 10; night++) {
    const wave = waveForNight(night, level.mult * economy.wave).size;
    assert.ok(wave >= previousWave, `${level.name} wave ${night} is smaller than the prior wave`);
    previousWave = wave;
  }
}
