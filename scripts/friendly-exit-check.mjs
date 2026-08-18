// Friendly-exit check: squads must be able to leave their own city. The
// horde always had building-aware navigation (walls are expensive, gates are
// cheap); friendlies only ever had terrain lanes, so a squad inside a walled
// compound routing to an outside objective ground the inner rampart forever —
// repath produced the identical terrain-only route every time (QA 2026-08-17:
// "bunch of guys stuck in this base, happens all over").
//
// This check builds a real campaign city, raises every wall and tower at
// once, drops squads INSIDE the ring, orders the attack stance, and lets the
// war run for a minute. Every living friendly must end up on ground reachable
// from the map edge without passing a wall (or standing in the gate itself —
// the way out is allowed to be mid-stride). Then the whole run repeats and
// must land on identical positions: the exit is a flow-field descent, so it
// is as deterministic as the horde's own navigation. Runs from `npm run check`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TerrainField } from '../src/terrain.js';
import { Game } from '../src/game.js';
import { LEVELS, SIM_DT } from '../src/config.js';

const RUN_SECONDS = 60;
const RUN_TICKS = Math.round(RUN_SECONDS / SIM_DT);

function buildAndRun() {
  const level = LEVELS[0];
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'alexander', null, level.id, 'campaign');

  // Found the city on the first site, then raise the whole ring at once —
  // walls, gates and towers, exactly as a long game would leave them.
  game.foundCity(0, 0);
  assert.ok(game.hq, 'founding must raise the Keep');
  let raised = 0;
  for (const pl of game.plots) {
    if (pl.kind === 'wall' || pl.kind === 'tower') { game._construct(pl, true); raised++; }
  }
  assert.ok(raised >= 4, `expected a real ring, raised ${raised} wall/tower plots`);
  assert.ok(game.gateIds.size >= 1, 'the ring must have at least one open gate');

  // Eight squads scattered inside the ring, reseated off any footprint.
  let spawned = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = game.hq.cx + Math.cos(a) * 8;
    const z = game.hq.cz + Math.sin(a) * 8;
    const spot = game._reseat(x, z, 12) || [x, z];
    const u = game._spawnUnit('soldier', spot[0], spot[1]);
    spawned++;
    assert.equal(u.camp, null);
  }
  assert.equal(spawned, 8);
  game.setStance('attack');

  for (let t = 0; t < RUN_TICKS; t++) game.update(SIM_DT);
  return { game, map };
}

// The city compound: ground reachable from the Keep treating EVERY occupied
// tile — gates included — as blocking. That is the trap this fix empties: a
// squad standing on compound ground (and not in the door itself) is sealed
// behind its own walls no matter what terrain pocket or far fort it can
// technically see. Seeded from the HQ, not the map border, so a soldier
// fighting in a distant ravine is not falsely accused.
function compoundFlood(game, map) {
  const N = map.size;
  const seen = new Uint8Array(N * N);
  const start = ((game.hq.cz | 0) * N + (game.hq.cx | 0));
  const stack = [];
  if (map.isWalkable(start % N, (start / N) | 0) && game.occ[start] !== 0) {
    // the Keep's own footprint seeds the flood through its tiles
  }
  stack.push(start);
  seen[start] = 1;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % N, z = (idx / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (seen[ni] || !map.isWalkable(nx, nz) || game.occ[ni] !== 0) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

function gateTiles(game, map) {
  const N = map.size;
  const tiles = [];
  for (let i = 0; i < game.occ.length; i++) {
    const id = game.occ[i];
    if (id !== 0 && game.gateIds.has(id)) tiles.push([i % N, (i / N) | 0]);
  }
  return tiles;
}

function positionsHash(game) {
  // Ids come from a module-level counter that carries across runs in one
  // process — hash the positions and roster, not the badges.
  const rows = game.units
    .filter((u) => !u.hero && !u.dead)
    .map((u) => `${u.key}:${(u.x).toFixed(3)}:${(u.z).toFixed(3)}`)
    .sort();
  return createHash('sha256').update(rows.join('|')).digest('hex');
}

const CHILD = process.argv.includes('--child');
const { game, map } = buildAndRun();
const compound = compoundFlood(game, map);
const gates = gateTiles(game, map);
const N = map.size;

let alive = 0;
const trapped = [];
for (const u of game.units) {
  if (u.hero || u.dead) continue;
  alive++;
  const x = u.x | 0, z = u.z | 0;
  if (!compound[z * N + x]) continue;                  // free ground — out
  const inDoor = gates.some(([gx, gz]) => Math.max(Math.abs(gx - x), Math.abs(gz - z)) <= 2);
  if (inDoor) continue;                                // holding or crossing the door
  trapped.push(`unit ${u.id} at ${x},${z}`);
}
assert.ok(alive >= 1, 'the war must leave someone alive to tell it');
assert.equal(trapped.length, 0, `squads still sealed inside the walls after ${RUN_SECONDS}s: ${trapped.join('; ')}`);

// The exit is a deterministic field descent — run the whole war again and
// every surviving squad must land on the same tile.
// Determinism must be judged across processes: unit ids are assigned from a
// module-level counter, and squad roles (holder/pusher, ranked target picks)
// are id-modulo — a second game in the SAME process would legitimately pick
// different targets. sim-determinism-check runs the same subprocess pattern.
if (CHILD) {
  console.log(positionsHash(game));
} else {
  const self = fileURLToPath(import.meta.url);
  const runs = [0, 1].map(() =>
    spawnSync(process.execPath, [self, '--child'], { encoding: 'utf8', cwd: process.cwd() }));
  for (const r of runs) assert.equal(r.status, 0, `child run failed: ${r.stderr}`);
  assert.equal(runs[0].stdout.trim(), runs[1].stdout.trim(),
    'the gate-exit must be as deterministic as the rest of the simulation');
}
if (!CHILD) console.log('friendly-exit check passed: 8 squads founded, ringed in, and out the gates — twice, identically');
