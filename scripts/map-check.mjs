// Map check: build every campaign level's landform and city for real, then
// assert it is playable and that no two planets read the same.
//
// This runs in plain Node because `src/terrain.js` and `src/plots.js` carry no
// renderer. Run `node scripts/map-check.mjs --report` for a per-level readout
// of coverage, sites, hives and lane nodes.
import assert from 'node:assert/strict';
import { TerrainField, TERRAIN_SHAPES } from '../src/terrain.js';
import { generatePlots, CITY_PLANS } from '../src/plots.js';
import { Game } from '../src/game.js';
import { LEVELS, TILE, TILE_INFO } from '../src/config.js';

const REPORT = process.argv.includes('--report');

function tileHistogram(map) {
  const counts = {};
  for (const t of map.tiles) counts[t] = (counts[t] || 0) + 1;
  const total = map.size * map.size;
  const out = {};
  for (const [name, tile] of Object.entries(TILE)) out[name] = (counts[tile] || 0) / total;
  return out;
}

// Flood the walkable ground from a tile — the same connectivity the horde and
// the lane graph see.
function flood(map, sx, sz) {
  const N = map.size;
  const seen = new Uint8Array(N * N);
  if (!map.isWalkable(sx, sz)) return seen;
  const stack = [sz * N + sx];
  seen[sz * N + sx] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (seen[ni] || !map.isWalkable(nx, nz)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

const signatures = new Map();

for (const level of LEVELS) {
  const label = `${level.name} (level ${level.id})`;
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const hist = tileHistogram(map);
  const N = map.size;

  // --- the landform is the one the level asked for -------------------------
  assert.ok(TERRAIN_SHAPES[map.terrainKind], `${label} has no landform archetype`);
  assert.equal(map.terrainKind, level.theme.terrain, `${label} did not build its own landform`);

  // --- there is enough ground to fight on ---------------------------------
  let walkable = 0;
  for (const t of map.tiles) if (TILE_INFO[t].walk) walkable++;
  const walkFrac = walkable / (N * N);
  assert.ok(walkFrac > 0.5, `${label} is only ${(walkFrac * 100) | 0}% walkable — no room to manoeuvre`);

  // --- sites: three of them, spread out, on real ground, each with an identity
  assert.equal(map.sites.length, 3, `${label} must offer three city sites`);
  for (const s of map.sites) {
    assert.ok(map.isWalkable(Math.round(s.x), Math.round(s.z)), `${label} site ${s.name} is not on land`);
    assert.ok(s.name && s.hint, `${label} has an unnamed city site`);
  }
  for (let i = 0; i < map.sites.length; i++) {
    for (let j = i + 1; j < map.sites.length; j++) {
      const d = Math.hypot(map.sites[i].x - map.sites[j].x, map.sites[i].z - map.sites[j].z);
      assert.ok(d > N * 0.2, `${label} sites ${i} and ${j} are ${d | 0} apart — too close to be a choice`);
    }
  }

  // --- hives: the right number, off the ring, and never marooned ----------
  assert.equal(map.nestSpots.length, level.nests, `${label} did not place every hive`);
  const centre = [N / 2, N / 2];
  const radii = map.nestSpots.map(([x, z]) => Math.hypot(x - centre[0], z - centre[1]));
  const spread = Math.max(...radii) - Math.min(...radii);
  assert.ok(spread > N * 0.05, `${label} hives sit on a ring (radius spread ${spread.toFixed(1)})`);

  for (const site of map.sites) {
    const reach = flood(map, Math.round(site.x), Math.round(site.z));
    for (const [x, z] of map.nestSpots) {
      assert.ok(reach[z * N + x], `${label}: a hive is unreachable from ${site.name} — unwinnable`);
    }
  }

  // --- lane nodes: enough of them, and a mix of kinds ---------------------
  assert.ok(map.nodeSpots.length >= 7, `${label} found only ${map.nodeSpots.length} lane nodes`);
  const kinds = new Set(map.nodeSpots.map((n) => n.kind));
  assert.ok(kinds.size >= 3, `${label} lane nodes are all the same kind of ground`);

  // --- the city: a real plan, closed walls, gates, and a full build-out ----
  const planKey = level.theme.city;
  assert.ok(CITY_PLANS[planKey], `${label} names an unknown city plan "${planKey}"`);
  const perSite = [];
  map.sites.forEach((site, i) => {
    const scratch = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    const plots = generatePlots(scratch, site, { levelId: level.id, siteIdx: i });
    const walls = plots.filter((p) => p.kind === 'wall');
    const hq = plots.find((p) => p.kind === 'hq');
    assert.ok(hq, `${label} site ${i} has no Keep`);
    assert.equal(hq.plan.key, planKey, `${label} site ${i} did not build its level's city plan`);
    assert.ok(plots.length >= 44, `${label} site ${i} laid out only ${plots.length} plots`);
    assert.equal(walls.length, hq.plan.gates.length,
      `${label} site ${i} has ${walls.length} wall segments for ${hq.plan.gates.length} gates`);
    assert.equal(plots.filter((p) => p.kind.startsWith('camp_')).length, 3,
      `${label} site ${i} is missing a muster camp`);
    assert.ok(plots.filter((p) => p.kind === 'tower').length >= 6,
      `${label} site ${i} has too few tower plots to defend a wall`);

    // The rampart must be CLOSED: every wall tile 4-connected to another, and
    // the ring has to actually separate inside from outside.
    const wallSet = new Set();
    for (const w of walls) for (const [x, z] of w.tiles) wallSet.add(z * scratch.size + x);
    for (const w of walls) {
      for (const [x, z] of w.tiles) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .filter(([dx, dz]) => wallSet.has((z + dz) * scratch.size + (x + dx))).length;
        assert.ok(n >= 2, `${label} site ${i} rampart breaks at ${x},${z}`);
      }
    }
    // Walk out from the Keep with the rampart solid. Nothing may reach open
    // ground: if anything does, the ring has a hole in it and the gates are
    // decoration.
    const S = scratch.size;
    const seen = new Uint8Array(S * S);
    const start = Math.round(hq.cz) * S + Math.round(hq.cx);
    const stack = [start];
    seen[start] = 1;
    let escaped = false;
    while (stack.length && !escaped) {
      const idx = stack.pop();
      const x = idx % S, z = (idx / S) | 0;
      if (Math.hypot(x - hq.cx, z - hq.cz) > hq.plan.reach + 4) { escaped = true; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const ni = nz * S + nx;
        if (nx < 0 || nz < 0 || nx >= S || nz >= S || seen[ni]) continue;
        if (wallSet.has(ni)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    assert.ok(!escaped, `${label} site ${i}: the rampart has a hole — the gates are decoration`);

    // Every gate needs towers covering it, or the chokepoint is decoration.
    for (const w of walls) {
      const near = plots.filter((p) => p.kind === 'tower'
        && Math.hypot(p.cx - w.gate[0], p.cz - w.gate[1]) < 9).length;
      assert.ok(near >= 1, `${label} site ${i}: ${w.name} gate has no tower covering it`);
    }
    perSite.push({ plots: plots.length, walls: walls.length, towers: plots.filter((p) => p.kind === 'tower').length });
  });

  // --- and it has to actually run ------------------------------------------
  // The balance harness plays on flat test ground. This plays the real map:
  // found the city, run two minutes of siege, and check the systems that
  // depend on terrain — the lane graph, the hive musters, the horde's walk to
  // the walls — all still work on this landform.
  {
    const live = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    const game = new Game(live, 'normal', 'alexander', null, level.id, 'campaign');
    game.foundCity(0, 0);
    assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph on its real terrain`);
    const nodes = game.activeNodes();
    assert.ok(nodes.length >= 6, `${label} left only ${nodes.length} reachable lane nodes`);
    assert.ok(game.nests.every((n) => n.alive), `${label} shipped a hive that can never be razed`);

    for (let i = 0; i < 120 * 30; i++) game.update(1 / 30);
    assert.ok(!game.over, `${label} ended on its own inside two minutes`);
    assert.ok(game.zombies.length > 0, `${label}: nothing is coming — the horde never mustered`);
    assert.ok(game.threat > 0, `${label}: threat never rose`);
    const nearCity = game.zombies.filter((z) => Math.hypot(z.x - game.hq.cx, z.z - game.hq.cz) < 46).length;
    assert.ok(nearCity > 0, `${label}: no attacker can find a way to the city`);
  }

  // --- no two planets may read the same ------------------------------------
  const sig = [
    (hist.WATER * 20) | 0, (hist.MOUNTAIN * 20) | 0, (hist.FOREST * 20) | 0,
  ].join('/');
  const clash = signatures.get(sig);
  assert.ok(!clash, `${label} has the same terrain signature (${sig}) as ${clash}`);
  signatures.set(sig, label);

  if (REPORT) {
    const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);
    console.log(`\n${label} — ${TERRAIN_SHAPES[map.terrainKind].label}, ${CITY_PLANS[planKey].label}`);
    console.log(`  cover   water ${pct(hist.WATER)}  crag ${pct(hist.MOUNTAIN)}  wood ${pct(hist.FOREST)}  open ${pct(hist.GRASS)}`);
    console.log(`  sites   ${map.sites.map((s) => `${s.name} [${s.kind}]`).join(' | ')}`);
    console.log(`  hives   ${map.nestSpots.map(([x, z]) => `${x},${z}`).join(' ')}`);
    console.log(`  nodes   ${map.nodeSpots.length}: ${[...kinds].join(', ')}`);
    console.log(`  city    ${perSite.map((p) => `${p.plots} plots/${p.walls} walls/${p.towers} towers`).join(' | ')}`);
  }
}

// Every archetype and every city plan has to be in the campaign — an unused
// one is an untested one.
const usedTerrain = new Set(LEVELS.map((l) => l.theme.terrain));
for (const key of Object.keys(TERRAIN_SHAPES)) {
  assert.ok(usedTerrain.has(key), `landform "${key}" is not used by any level`);
}
const usedPlans = new Set(LEVELS.map((l) => l.theme.city));
for (const key of Object.keys(CITY_PLANS)) {
  assert.ok(usedPlans.has(key), `city plan "${key}" is not used by any level`);
}
assert.equal(usedPlans.size, LEVELS.length, 'two levels share a city plan — the bases would look the same');
assert.equal(usedTerrain.size, LEVELS.length, 'two levels share a landform — the maps would look the same');

console.log(`map-check: ${LEVELS.length} levels, ${usedTerrain.size} landforms, ${usedPlans.size} city plans — all distinct.`);
