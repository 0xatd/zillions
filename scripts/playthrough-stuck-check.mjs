// Playthrough stuck check: a scripted player founds the city, builds,
// defends and pushes on every campaign map while a watcher looks for any
// figure — hero, ally or enemy — that wants to move but makes no progress.
//
//   node scripts/playthrough-stuck-check.mjs [levelIds=1,2,3,4,5] [maxMinutes=30] [--report]
//
// Asserts per map: no stuck actor, the horde reaches and strikes the base,
// the match ends (win or lose) inside the cap, and a snapshot taken 4 min in
// and restored into a fresh Game runs the next 20 s identically to the live
// game (real terrain, mid-fight — the flat-map determinism check cannot see
// field, pocket or spit-target state).
//
// Debug env: DIFF=casual|normal|brutal, BOTLOG=1, TRACE=id,t0,t1 (unit or
// zombie), TRACEMV=id,t0,t1, GRID=x,z,t (occupancy map), RDIFF=1 (first
// restore divergence).
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { SIM_DT, levelById } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const REPORT = process.argv.includes('--report');
const IDS = (args[0] || '1,2,3,4,5').split(',').map(Number);
const MAX_MIN = Number(args[1] || 30);
const WINDOW = 12;       // seconds of no progress that count as stuck
const SAMPLE = 0.5;      // seconds between watcher samples

function play(targetLevel) {
  const level = levelById(targetLevel);
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, process.env.DIFF || 'normal', 'scott', null, targetLevel, 'campaign');
  const targetSite = 0;
  let restoreSame = null;
  let plan = null, lastStance = null, route = [], routeGoal = '';
  const command = (value) => game.exec(value);
  const setStance = (value) => { if (lastStance === value) return; lastStance = value; command({ t: 'stance', s: value, p: 0 }); };
  const builtCount = (kind) => game.plots.filter((plot) => plot.kind === kind && plot.tier > 0 && !plot.ruined).length;
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
      const o = game.occ[next]; if (o && !game.gateIds.has(o)) continue;
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
    // A cached route is stale once something was built across it (the hero
    // paid for a wall standing on its line, then walked into the new stone).
    const blocked = route.length && route.slice(0, 3).some(([rx, rz]) => {
      const o = game.occ[(rz | 0) * game.map.size + (rx | 0)];
      return o && !game.gateIds.has(o);
    });
    if (blocked || routeGoal !== goal || !route.length || Math.hypot(route[0][0] - hero.x, route[0][1] - hero.z) > 1.6) {
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


  // ---- watcher (read-only: never touches the sim) ----
  const track = new Map();   // actor -> { x, z, t, flow, intent, hits }
  const stuck = [];
  let heroIntent = 0, reached = false, struck = false, minFlow = Infinity;
  const hpSeen = new Map();
  const origMove = game._moveActor.bind(game);
  const origZ = game._moveZombie.bind(game);
  const intent = new WeakMap();
  const TMV = process.env.TRACEMV ? process.env.TRACEMV.split(',').map(Number) : null;
  game._moveActor = (a, ...r) => {
    intent.set(a, (intent.get(a) || 0) + 1);
    const x0 = a.x, z0 = a.z, ok = origMove(a, ...r);
    if (TMV && a.id === TMV[0] && game.time >= TMV[1] && game.time <= TMV[2]) {
      console.error('MV', game.time.toFixed(2), x0.toFixed(3), z0.toFixed(3), '->', a.x.toFixed(3), a.z.toFixed(3), ok, r.map((v) => (typeof v === 'number' ? +v.toFixed(2) : v)).join(','), new Error().stack.split('\n')[3].trim().slice(0, 60));
    }
    return ok;
  };
  game._moveZombie = (a, ...r) => { intent.set(a, (intent.get(a) || 0) + 1); return origZ(a, ...r); };
  const ticksPer = Math.round(SAMPLE / SIM_DT);
  function watch() {
    const t = game.time;
    if (game.hq) for (const b of game.buildings) {
      if (!b.alive) continue;
      const prev = hpSeen.get(b);
      if (prev != null && b.hp < prev - 0.01) struck = true;
      hpSeen.set(b, b.hp);
    }
    const actors = [...game.heroes, ...game.units.filter((u) => !u.hero), ...game.zombies.filter((z) => z.wave)];
    for (const a of actors) {
      if (a.dead) { track.delete(a); continue; }
      const isZ = game.zombies.includes(a);
      if (isZ && game.flow) {
        const f = game.flow.distAt(a.x | 0, a.z | 0);
        if (f < minFlow) minFlow = f;
        if (f <= 2.5) reached = true;
      }
      let rec = track.get(a);
      const n = intent.get(a) || 0;
      if (!rec) { track.set(a, { x: a.x, z: a.z, t, n, atk: a.atkT ?? a.cooldown ?? 0, attacked: false, flag: false }); continue; }
      // Did it strike since the window opened? (attack timers jump up on a hit)
      const atk = isZ ? a.atkT : a.cooldown;
      if (atk > rec.atk + 0.05) rec.attacked = true;
      rec.atk = atk;
      if (!isZ && !a.hero) rec.mv = (rec.mv || 0) + (a.moving ? SAMPLE : 0);
      // Furthest it got from where the window opened: a squad that marches
      // off and comes back (a legitimate retarget) is not stuck.
      rec.far = Math.max(rec.far || 0, Math.hypot(a.x - rec.x, a.z - rec.z));
      if (t - rec.t < WINDOW) continue;
      const moved = Math.hypot(a.x - rec.x, a.z - rec.z);
      // Seconds spent trying to move: allies report it themselves (u.moving),
      // the horde through the movement calls it makes.
      const tried = isZ || a.hero ? (n - rec.n) * SIM_DT : rec.mv;
      const stunned = (a.stunT || 0) > 0;
      if (!rec.flag && moved < 0.75 && rec.far < 2 && tried > WINDOW * 0.6 && !rec.attacked && !stunned) {
        rec.flag = true;
        if (process.env.DUMP && stuck.length === Number(process.env.DUMP)) {
          const N = game.map.size, enc = game._enclosure;
          console.error('DUMP t', t.toFixed(0), 'id', a.id, 'actor', a.x.toFixed(1), a.z.toFixed(1), 'enc?', !!enc, 'hq', game.hq.cx, game.hq.cz, 'exitDir', a.exitDx, a.exitDz);
          for (let z = (a.z | 0) - 12; z <= (a.z | 0) + 12; z++) {
            let row = '';
            for (let x = (a.x | 0) - 24; x <= (a.x | 0) + 24; x++) {
              const k = z * N + x, o = game.occ[k];
              row += (x === (a.x | 0) && z === (a.z | 0)) ? '@' : o ? (game.gateIds.has(o) ? 'G' : '#') : !game.map.isWalkable(x, z) ? 'X' : enc && enc[k] ? ',' : '.';
            }
            console.error(row);
          }
        }
        stuck.push({ id: a.id, kind: a.hero ? 'hero' : isZ ? `enemy:${a.type}` : `ally:${a.type || a.kind || '?'}`,
          x: +a.x.toFixed(1), z: +a.z.toFixed(1), at: +t.toFixed(0), tile: game.map.tiles[(a.z | 0) * game.map.size + (a.x | 0)],
          stance: game.stance,
          ...(REPORT ? { hold: a.holdX != null ? [+a.holdX.toFixed(1), +a.holdZ.toFixed(1)] : null,
            route: a.route ? `${a.routeI}/${a.route.length}` : null, unit: a.def?.name || a.type,
            st: { gateExit: a.gateExit, gateCool: a.gateCool && +a.gateCool.toFixed(1), target: a.target ? [a.target.x | 0, a.target.z | 0, a.target.type] : null,
              nest: a.targetNest ? [a.targetNest.x | 0, a.targetNest.z | 0] : null, gi: a.targetGi, giPt: a.targetGi >= 0 ? game._giPoint(a.targetGi).map((v) => v | 0) : null,
              exitD: game.exitField ? +game.exitField.distAt(a.x | 0, a.z | 0).toFixed(1) : null, holder: game._isHolder?.(a) },
            grid: [-2, -1, 0, 1, 2].map((dz) => [-2, -1, 0, 1, 2].map((dx) => {
              const x = (a.x | 0) + dx, z = (a.z | 0) + dz, k = z * game.map.size + x;
              const o = game.occ[k]; return o ? (game.gateIds.has(o) ? 'G' : '#') : (game.map.isWalkable(x, z) ? '.' : 'X');
            }).join('')).join('|') } : {}) });
      }
      track.set(a, { x: a.x, z: a.z, t, n, atk, attacked: false, flag: rec.flag && moved < 0.75 });
    }
  }

  setStance('defend');
  const maxTicks = Math.round(MAX_MIN * 60 / SIM_DT);
  const wall0 = Date.now();
  const RESTORE_AT = Math.round(240 / SIM_DT);
  for (let tick = 0; tick < maxTicks && !game.over; tick++) {
    if (tick === RESTORE_AT) {
      // Mid-match restore on the real terrain, mid-fight: a fresh Game built
      // from the snapshot must walk the same 20 s as the live one (goal-field
      // caches and the enclosure are derived, never saved).
      const saved = JSON.parse(JSON.stringify(game.snapshot()));
      const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
        : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
      const diff = (a, b, path = '') => {
        if (stable(a) === stable(b)) return null;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], path + '.' + k); if (d) return d; }
        }
        return `${path}: ${JSON.stringify(a)?.slice(0, 160)} vs ${JSON.stringify(b)?.slice(0, 160)}`;
      };
      // Run the live game first, then the twin: entity ids come from a
      // module-global counter (one Game per process in real play), so the two
      // must not interleave. Building the twin resets the counter to the
      // snapshot's value, and a matching run leaves it where the live one did.
      const marks = [];
      for (let i = 0; i < 600; i++) {
        game.update(SIM_DT);
        if (process.env.RDIFF && (i < 3 || i % 30 === 0)) marks.push([i, game.snapshot()]);
      }
      const live = game.snapshot();
      const twin = new Game(new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests }),
        process.env.DIFF || 'normal', 'scott', saved, targetLevel, 'campaign');
      for (let i = 0; i < 600; i++) {
        twin.update(SIM_DT);
        if (marks.length && marks[0][0] === i) {
          const [, m] = marks.shift();
          const d = diff(m.zombies, twin.snapshot().zombies, '.zombies') || diff(m, twin.snapshot());
          if (d) { console.error('RESTORE DIFF tick', i, d); marks.length = 0; }
        }
      }
      restoreSame = stable(live) === stable(twin.snapshot());
      if (!restoreSame && !process.env.RDIFF) console.error('restore diff:', diff(live, twin.snapshot()));
    }
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
      const underSiege = false ? false
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
        // Stand ON an empty pad: districts pack pads close, and the nearest
        // rectangle point of a neighbour can tie with the edge of this one.
        const [x, z] = plan.tier === 0 && !plan.ruined && plan.kind !== 'wall' ? [plan.cx, plan.cz] : game.payPoint(plan, hero);
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

    if (process.env.GRID) {
      const [gx, gz, gt] = process.env.GRID.split(',').map(Number);
      if (Math.abs(game.time - gt) < SIM_DT / 2) {
        const N = game.map.size;
        const pl = plan;
        console.error('plan', pl && pl.name, pl && pl.kind, pl && pl.anchor, pl && pl.gate, pl && game.plotAction(pl));
        for (let z = gz - 6; z <= gz + 6; z++) {
          let row = String(z).padStart(4) + ' ';
          for (let x = gx - 7; x <= gx + 7; x++) {
            const id = game.occ[z * N + x];
            const b = id ? game.buildings.find((q) => q.id === id) : null;
            const inPlan = pl && pl.tiles && pl.tiles.some(([a, c]) => a === x && c === z);
            row += (x === (hero.x | 0) && z === (hero.z | 0)) ? 'H' : pl && pl.anchor && x === pl.anchor[0] && z === pl.anchor[1] ? '@'
              : b ? (game.gateIds.has(id) ? 'G' : inPlan ? 'W' : b.kind[0]) : inPlan ? 'p' : game.map.isWalkable(x, z) ? '.' : '#';
          }
          console.error(row);
        }
      }
    }
    game.update(SIM_DT);
    if (game.events.length > 200) game.events.splice(0, game.events.length - 20);
    if (tick % ticksPer === 0) watch();
    if (process.env.BOTLOG && tick % 150 === 0) {
      const h = game.heroes[0];
      console.error(game.time.toFixed(0), game.phase, game.firstSiege?.stage, 'gold', game.gold, 'hero', h.x.toFixed(0), h.z.toFixed(0), h.dead ? 'DEAD' : '', 'plan', plan ? `${plan.kind}@${plan.cx},${plan.cz}` : '-', 'hq', game.hq ? Math.round(game.hq.hp) : '-', 'z', game.zombies.filter((q) => !q.dead).length, 'units', game.units.filter((q) => !q.dead && !q.hero).length);
    }
    if (process.env.TRACE) {
      const [id, t0, t1] = process.env.TRACE.split(',').map(Number);
      const zt = game.time >= t0 && game.time <= t1 && game.zombies.find((q) => q.id === id);
      if (zt && tick % 3 === 0) console.error('Z', game.time.toFixed(1), zt.x.toFixed(2), zt.z.toFixed(2), 'walk', game.map.isWalkable(zt.x | 0, zt.z | 0), 'st', zt.state, 'atk', (zt.atkT || 0).toFixed(2), 'stun', zt.stunT || 0, 'tu', zt.targetU ? [zt.targetU.id, zt.targetU.x.toFixed(1), zt.targetU.z.toFixed(1)].join('/') : '-', 'rt', zt.route ? zt.route.length : '-', 'fd', JSON.stringify(game.flow.dirAt(zt.x | 0, zt.z | 0)));
      const u = game.time >= t0 && game.time <= t1 && game.units.find((q) => q.id === id);
      if (u && tick % 3 === 0) console.error(game.time.toFixed(1), u.x.toFixed(2), u.z.toFixed(2), 'mv', u.moving, 'gx', u.gateExit, 'gc', (u.gateCool || 0).toFixed(1), 'ex', u.exitDx, u.exitDz, 'route', u.route ? u.routeI + '/' + u.route.length : '-', 'gi', u.targetGi, 'tgt', !!u.target, 'nest', !!u.targetNest, 'rp', (u.repathT || 0).toFixed(1), 'wp', u.route ? u.route[u.routeI].map((v) => v.toFixed(1)).join(',') : '', 'reach', u.route ? game._fieldReach(u, u.route[u.routeI][0], u.route[u.routeI][1]) : '', 'fd', u.route ? JSON.stringify(game._fieldDir(u, u.route[u.routeI][0], u.route[u.routeI][1])) : '');
    }
  }
  return {
    level: `${level.id} ${level.name}`, over: game.over, won: game.won,
    minutes: +(game.time / 60).toFixed(1), wallSec: +((Date.now() - wall0) / 1000).toFixed(0),
    kills: game.stats.kills, built: game.stats.built, lost: game.stats.lost, armyPeak: game.stats.armyPeak,
    nestsAlive: game.nests.filter((n) => n.alive).length + '/' + game.nests.length,
    reached, struck, restoreSame, stuck,
  };
}

let failed = 0;
for (const id of IDS) {
  const r = play(id);
  console.log(JSON.stringify(REPORT ? r : { ...r, stuck: r.stuck.slice(0, 8), stuckCount: r.stuck.length }));
  try {
    assert.equal(r.stuck.length, 0, `${r.level}: ${r.stuck.length} stuck figure(s)`);
    assert.ok(r.reached && r.struck, `${r.level}: the horde never reached/struck the base`);
    assert.ok(r.over, `${r.level}: match did not finish inside ${MAX_MIN} min`);
    assert.notEqual(r.restoreSame, false, `${r.level}: snapshot/restore diverged mid-match`);
  } catch (e) { failed++; console.error('FAIL', e.message); }
}
if (failed) process.exit(1);
console.log('playthrough stuck check passed');
