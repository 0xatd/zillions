import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/game.js';
import {
  LEVELS, SIM_DT, TILE,
} from '../src/config.js';

const scriptPath = fileURLToPath(import.meta.url);
const TOTAL_TICKS = 720;
const RESTORE_TICK = 360;

function fakeMap(level) {
  const size = level.size || 160;
  const tiles = new Uint8Array(size * size).fill(TILE.GRASS);
  const site = { x: size / 2, z: size / 2 };
  return {
    size,
    seed: level.seed,
    sites: [site],
    nestSpots: [
      [Math.round(size * 0.18), Math.round(size * 0.5)],
      [Math.round(size * 0.82), Math.round(size * 0.5)],
      [Math.round(size * 0.5), Math.round(size * 0.18)],
    ].slice(0, level.nests || 3),
    tiles,
    idx: (x, z) => z * size + x,
    inBounds: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isBuildable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
  };
}

function makeGame(snap = null) {
  const level = LEVELS[(snap?.level || 1) - 1] || LEVELS[0];
  const map = fakeMap(level);
  return new Game(map, snap?.diff || 'normal', snap?.heroKeys || 'alexander', snap, level.id || 1, snap?.mode || 'campaign');
}

function hashSnapshot(snap) {
  return createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

function firstPlot(game, kind, tier = 0) {
  const plot = game.plots.find((p) => p.kind === kind && p.tier === tier);
  assert.ok(plot, `expected ${kind} tier ${tier} plot`);
  return plot;
}

function startFunding(game, kind) {
  const plot = firstPlot(game, kind);
  const next = game.nextTier(plot);
  assert.ok(next && !next.branch, `${kind} must be directly fundable`);
  game.gold = Math.max(game.gold, next.cost + 10);
  const hero = game.heroes[0];
  const [x, z] = game.payPoint(plot, hero);
  hero.x = x;
  hero.z = z;
  hero.mx = 0;
  hero.mz = 0;
  game.exec({ t: 'pay', p: 0, on: true });
  return plot.id;
}

function applyScriptedCommand(game, tick, activeFunding) {
  switch (tick) {
    case 0:
      game.exec({ t: 'found', s: 0, p: 0 });
      break;
    case 8:
      activeFunding.id = startFunding(game, 'farm');
      break;
    case 42:
      game.exec({ t: 'pay', p: 0, on: false });
      assert.ok(game.plots.find((p) => p.id === activeFunding.id)?.tier >= 1, 'farm should finish building');
      break;
    case 58:
      activeFunding.id = startFunding(game, 'camp_ranger');
      break;
    case 116:
      game.exec({ t: 'pay', p: 0, on: false });
      assert.ok(game.units.some((u) => !u.hero && u.camp === activeFunding.id), 'camp should spawn troops');
      break;
    case 132:
      activeFunding.id = startFunding(game, 'tower');
      break;
    case 205:
      game.exec({ t: 'pay', p: 0, on: false });
      assert.ok(game.buildings.some((b) => b.kind === 'tower'), 'tower should finish building');
      break;
    case 218: {
      const hero = game.heroes[0];
      hero.level = 4;
      hero.xp = 0;
      game._refreshHeroDerived(hero);
      for (const key of ['aura', 'passive1', 'ult']) game.exec({ t: 'heroUpgrade', p: 0, key });
      assert.equal(hero.skillPoints, 0, 'hero upgrades should spend all level 4 points');
      break;
    }
    case 230:
      game.exec({ t: 'stance', s: 'attack', p: 0 });
      break;
    case 246: {
      const nest = game.nests.find((n) => n.alive);
      assert.ok(nest, 'expected a living hive nest');
      game._damageNest(nest, Math.round(nest.maxHp * 0.2));
      break;
    }
    case 260:
      game.exec({ t: 'bell', p: 0 });
      break;
    case 365:
      assert.equal(game.phase, 'night', 'bell should start the night wave');
      game.exec({ t: 'cast', p: 0 });
      break;
    case 384:
      activeFunding.id = startFunding(game, 'house');
      assert.equal(game.phase, 'night', 'night building should happen under pressure');
      break;
    case 428:
      game.exec({ t: 'pay', p: 0, on: false });
      assert.ok(game.plots.find((p) => p.id === activeFunding.id)?.tier >= 1, 'house should finish building during the wave');
      break;
    case 430:
      game.exec({ t: 'hdir', p: 0, x: 1, z: 0, s: false });
      break;
    case 520:
      game.exec({ t: 'hdir', p: 0, x: 0, z: -1, s: true });
      break;
    case 610:
      game.exec({ t: 'hdir', p: 0, x: 0, z: 0, s: false });
      break;
    default:
      break;
  }
}

function runScenario({ restore, includeSnapshot = false }) {
  let game = makeGame();
  const activeFunding = { id: null };

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    applyScriptedCommand(game, tick, activeFunding);
    game.update(SIM_DT);

    if (restore && tick === RESTORE_TICK) {
      game = makeGame(game.snapshot());
    }
  }

  const snap = game.snapshot();
  const result = {
    hash: hashSnapshot(snap),
    summary: {
      phase: snap.phase,
      night: snap.night,
      gold: snap.gold,
      buildings: snap.buildings.length,
      units: snap.units.length,
      zombies: snap.zombies.length,
      kills: snap.stats.kills,
      nests: snap.nests,
      hero: snap.heroes[0],
    },
  };
  if (includeSnapshot) result.snapshot = snap;
  return result;
}

function runWorker() {
  const restore = process.argv.includes('--restore');
  const includeSnapshot = process.argv.includes('--snapshot');
  process.stdout.write(`${JSON.stringify(runScenario({ restore, includeSnapshot }))}\n`);
}

function runChild(args = []) {
  const child = spawnSync(process.execPath, [scriptPath, '--worker', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

if (process.argv.includes('--worker')) {
  runWorker();
} else {
  const fullA = runChild();
  const fullB = runChild();
  const restored = runChild(['--restore']);

  assert.equal(fullA.hash, fullB.hash, 'identical command replays diverged');
  assert.deepEqual(fullA.summary, fullB.summary, 'identical replay summaries diverged');
  assert.equal(restored.hash, fullA.hash, 'snapshot restore diverged from uninterrupted replay');
  assert.deepEqual(restored.summary, fullA.summary, 'snapshot restore summary diverged');

  console.log(`sim determinism ok: ${fullA.hash.slice(0, 12)} (${TOTAL_TICKS} ticks, restore at ${RESTORE_TICK})`);
}
