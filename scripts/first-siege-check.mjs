import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { LEVELS, TILE } from '../src/config.js';

const level = LEVELS[0];
const size = level.size || 160;
const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
const ring = (count, radius) => Array.from({ length: count }, (_, i) => {
  const angle = (i / count) * Math.PI * 2;
  return [Math.round(size / 2 + Math.cos(angle) * radius), Math.round(size / 2 + Math.sin(angle) * radius)];
});
const map = {
  size, seed: level.seed, tiles,
  sites: [{ x: size / 2, z: size / 2, name: 'Old Crossroads' }],
  nestSpots: ring(level.nests || 3, size * 0.34),
  nodeSpots: ring(8, size * 0.22).map(([x, z], i) => ({ x, z, name: `Node ${i + 1}`, kind: 'clearing' })),
  isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
};

const game = new Game(map, 'normal', 'alexander', null, 1, 'campaign');
game.foundCity(0, 0);
// The synthetic all-grass lane graph can prune every remote nest. Restore one
// so this focused check can exercise the warning and reward state machine.
if (game.firstSiege.nestId == null) {
  game.nests[0].alive = true;
  game.nests[0].offMap = false;
  game.firstSiege.nestId = 0;
}
assert.equal(game.firstSiege.stage, 'opening');
assert.equal(game.firstSiegeStatus().title, 'CHOOSE YOUR OPENING');
assert.ok(game.plots.some((plot) => plot.kind === 'house' && game.firstSiegePlotVisible(plot)));
assert.ok(game.plots.some((plot) => plot.kind === 'tower' && game.firstSiegePlotVisible(plot)));
assert.ok(game.plots.some((plot) => plot.kind === 'camp_militia' && game.firstSiegePlotVisible(plot)));
assert.ok(game.plots.some((plot) => plot.kind === 'hq' && !game.firstSiegePlotActionable(plot)), 'Keep upgrade must not steal the opening');

const timers = game.nests.map((nest) => nest.musterT);
game._updateHives(10);
assert.deepEqual(game.nests.map((nest) => nest.musterT), timers, 'hives must wait while the player chooses');

const opening = game.plots.find((plot) => plot.kind === 'camp_militia');
game._construct(opening);
assert.equal(game.firstSiege.stage, 'warning');
assert.ok(game.firstSiegeStatus().nest, 'the first attacking hive must be named');
game.nests[game.firstSiege.nestId].musterT = 0;
game._updateHives(0.1);
assert.equal(game.firstSiege.stage, 'defend');
assert.ok(game.firstSiege.waveIds.length > 0, 'the first wave must be tracked');

for (const zombie of game.zombies) if (game.firstSiege.waveIds.includes(zombie.id)) zombie.dead = true;
const beforeReward = game.gold;
game._updateHives(0);
assert.equal(game.firstSiege.stage, 'complete');
assert.equal(game.gold, beforeReward + 24);
assert.ok(game.plots.every((plot) => game.firstSiegePlotVisible(plot)), 'the full city must reveal after victory');

const restored = new Game(map, 'normal', 'alexander', game.snapshot(), 1, 'campaign');
assert.equal(restored.firstSiege.stage, 'complete');
assert.equal(restored.gold, game.gold);

console.log('first siege check passed');
