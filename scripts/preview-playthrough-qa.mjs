import { Game } from '../src/game.js';
import { LEVELS, SIM_DT, levelById } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';

const targetLevel = Math.max(1, Math.min(2, Number(process.argv[2] || 1)));
const targetSite = Math.max(0, Math.min(2, Number(process.argv[3] || 0)));
const maxTicks = Math.max(1, Number(process.argv[4] || 108000));
const level = levelById(targetLevel);
const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
const game = new Game(map, 'casual', 'scott', null, targetLevel, 'campaign');
let plan = null;
let lastStance = null;
let route = [];
let routeGoal = '';

function command(value) { game.exec(value); }
function setStance(value) {
  if (lastStance === value) return;
  lastStance = value;
  command({ t: 'stance', s: value, p: 0 });
}
function builtCount(kind) {
  return game.plots.filter((plot) => plot.kind === kind && plot.tier > 0 && !plot.ruined).length;
}
function findRoute(hero, goalX, goalZ, stopRadius = 1) {
  const size = game.map.size;
  const sx = Math.max(0, Math.min(size - 1, Math.floor(hero.x)));
  const sz = Math.max(0, Math.min(size - 1, Math.floor(hero.z)));
  const queue = new Int32Array(size * size);
  const previous = new Int32Array(size * size).fill(-2);
  let head = 0, tail = 0, end = -1;
  const start = sz * size + sx;
  queue[tail++] = start;
  previous[start] = -1;
  while (head < tail) {
    const key = queue[head++], x = key % size, z = Math.floor(key / size);
    if (Math.hypot(x + 0.5 - goalX, z + 0.5 - goalZ) <= stopRadius) { end = key; break; }
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = nz * size + nx;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size || previous[next] !== -2) continue;
      if (!game.map.isWalkable(nx, nz)) continue;
      previous[next] = key;
      queue[tail++] = next;
    }
  }
  if (end < 0) return [];
  const reversed = [];
  for (let key = end; key !== -1; key = previous[key]) reversed.push([key % size + 0.5, Math.floor(key / size) + 0.5]);
  return reversed.reverse().slice(1);
}
function moveHeroToward(hero, x, z, sprint = true, stopRadius = 1) {
  const goal = `${Math.floor(x)},${Math.floor(z)},${stopRadius}`;
  if (routeGoal !== goal || !route.length || Math.hypot(route[0][0] - hero.x, route[0][1] - hero.z) > 3) {
    routeGoal = goal;
    route = findRoute(hero, x, z, stopRadius);
  }
  while (route.length && Math.hypot(route[0][0] - hero.x, route[0][1] - hero.z) < 0.5) route.shift();
  const [tx, tz] = route[0] || [x, z];
  const dx = tx - hero.x;
  const dz = tz - hero.z;
  const distance = Math.hypot(dx, dz) || 1;
  command({ t: 'hdir', x: dx / distance, z: dz / distance, s: sprint, p: 0 });
  return Math.hypot(x - hero.x, z - hero.z);
}

setStance('defend');
for (let tick = 0; tick < maxTicks && !game.over; tick++) {
  const hero = game.heroes[0];
  if (!hero) break;
  if (game.phase === 'found') {
    const site = game.map.sites[targetSite];
    if (moveHeroToward(hero, site.x, site.z, true, 1.8) < 2.2) {
      command({ t: 'hdir', x: 0, z: 0, p: 0 });
      command({ t: 'found', s: targetSite, p: 0 });
    }
  } else if (!hero.dead) {
    if (hero.skillPoints > 0) command({ t: 'heroUpgrade', key: 'damage', p: 0 });
    if (hero.abilCd <= 0) command({ t: 'cast', p: 0 });
    const closeThreat = game.hq && game.zombies.some((zombie) => !zombie.dead
      && ((zombie.x - game.hq.cx) ** 2 + (zombie.z - game.hq.cz) ** 2) < 625);
    const underSiege = targetLevel === 1 ? false
      : (game.firstSiege?.stage === 'warning' || (game.firstSiege?.stage === 'defend' && closeThreat));
    const priority = targetLevel === 1
      ? ['tower', 'camp_militia', 'camp_ranger', 'wall', 'farm', 'house', 'mill', 'hq']
      : (game.firstSiege?.stage === 'opening'
        ? ['tower', 'camp_militia', 'farm', 'house']
        : ['farm', 'house', 'camp_militia', 'tower', 'camp_ranger', 'wall', 'mill', 'hq']);
    const candidates = game.plots.filter((plot) => !plot.ruined
      && !game.plotLocked(plot)
      && !plot.kind.startsWith('outpost')
      && game.firstSiegePlotActionable(plot)
      && game.plotAction(plot)?.mode !== 'branch');
    candidates.sort((a, b) => {
      const pa = priority.indexOf(a.kind);
      const pb = priority.indexOf(b.kind);
      const da = (a.cx - game.hq.cx) ** 2 + (a.cz - game.hq.cz) ** 2;
      const db = (b.cx - game.hq.cx) ** 2 + (b.cz - game.hq.cz) ** 2;
      return targetLevel === 1
        ? ((pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.tier - b.tier || da - db)
        : (a.tier - b.tier || (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || da - db);
    });
    if (underSiege) plan = null;
    else if (!plan || !candidates.includes(plan) || !game.plotAction(plan)) {
      const desired = game.firstSiege?.stage === 'opening' ? 'camp_militia'
        : builtCount('camp_militia') < 2 ? 'camp_militia'
          : builtCount('tower') < 3 ? 'tower'
            : builtCount('farm') < 3 ? 'farm'
              : builtCount('house') < 3 ? 'house'
                : builtCount('camp_ranger') < 2 ? 'camp_ranger'
                  : builtCount('camp_sniper') < 1 ? 'camp_sniper' : null;
      plan = (desired ? candidates.find((plot) => plot.kind === desired && plot.tier === 0
        && (game.plotAction(plot)?.cost ?? Infinity) <= game.gold) : null)
        || candidates.find((plot) => (game.plotAction(plot)?.cost ?? Infinity) <= game.gold)
        || null;
    }
    if (!underSiege && plan && game.gold > 0) {
      const [x, z] = game.payPoint(plan, hero);
      if (moveHeroToward(hero, x, z, true, 1) < 1.6) {
        command({ t: 'hdir', x: 0, z: 0, p: 0 });
        command({ t: 'pay', on: true, p: 0 });
      } else command({ t: 'pay', on: false, p: 0 });
    } else {
      command({ t: 'pay', on: false, p: 0 });
      const readyToAttack = game.firstSiege?.stage === 'complete'
        || (!game.firstSiege && game.time > 180 && builtCount('camp_militia') > 0);
      if (readyToAttack) setStance('attack');
      const target = readyToAttack
        ? (game.nests.find((nest) => nest.alive) || game.zombies.find((zombie) => !zombie.dead))
        : (game.zombies.find((zombie) => !zombie.dead) || game.hq);
      if (target) moveHeroToward(hero, target.x ?? target.cx, target.z ?? target.cz, true, 1.5);
    }
  }
  game.update(SIM_DT);
  if (game.events.length > 200) game.events.splice(0, game.events.length - 20);
}

const result = {
  level: LEVELS[targetLevel - 1].name,
  won: game.won,
  over: game.over,
  time: Number(game.time.toFixed(1)),
  kills: game.stats.kills,
  built: game.stats.built,
  lost: game.stats.lost,
  gold: game.gold,
  armyPeak: game.stats.armyPeak,
  nestsAlive: game.nests.filter((nest) => nest.alive).length,
  firstSiege: game.firstSiege?.stage,
  structures: game.buildings.filter((building) => building.alive).map((building) => building.kind),
  plots: game.plots.filter((plot) => plot.tier > 0).map((plot) => `${plot.kind}:${plot.tier}`),
  nests: game.nests.map((nest) => ({ alive: nest.alive, hp: Math.round(nest.hp), x: Math.round(nest.x), z: Math.round(nest.z) })),
};
console.log(JSON.stringify(result));
if (game.over && !game.won) process.exitCode = 1;
