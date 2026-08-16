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
import { LEVELS, levelById, galaxyLevel, TILE, TILE_INFO, ITEMS, PACK_SLOTS } from '../src/config.js';

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
const siteStats = [];

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
    assert.ok(hq.plan.entrances >= 2,
      `${label} site ${i} has ${hq.plan.entrances} entrances — a city needs somewhere to sortie from`);
    assert.equal(hq.plan.entrances, hq.plan.gates.length,
      `${label} site ${i} reports ${hq.plan.gates.length} gates for ${hq.plan.entrances} entrances`);
    for (const kind of ['camp_militia', 'camp_ranger', 'camp_sniper']) {
      assert.ok(plots.some((p) => p.kind === kind),
        `${label} site ${i} has no ${kind} — all three doctrines must be buildable`);
    }
    assert.ok(plots.filter((p) => p.kind === 'tower').length >= 6,
      `${label} site ${i} has too few tower plots to defend a wall`);
    assert.equal(!!hq.plan.inner, !!CITY_PLANS[planKey].inner,
      `${label} site ${i} did not raise the inner ward its plan calls for`);

    // The boundary must have NO holes — but the wall is only half of it now.
    // Crag, water and deep wood are the other half, so the test is: walk out
    // from the Keep with built wall AND impassable ground both solid, and see
    // whether anything reaches open country.
    const S = scratch.size;
    const wallSet = new Set();
    for (const w of walls) {
      if (w.role === 'outer') continue;   // outer works are optional, not the boundary
      for (const [x, z] of w.tiles) wallSet.add(z * S + x);
    }
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
        if (wallSet.has(ni) || !scratch.isWalkable(nx, nz)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    assert.ok(!escaped, `${label} site ${i}: the boundary has a hole — the gates are decoration`);

    // Every entrance is a ward: towers covering the gate, and a camp inside it
    // so the squads that hold this gate — and push out of it — start here.
    for (const w of walls) {
      if (!w.gate || w.role === 'outer') continue;
      const towers = plots.filter((p) => p.kind === 'tower'
        && Math.hypot(p.cx - w.gate[0], p.cz - w.gate[1]) < 9).length;
      assert.ok(towers >= 1, `${label} site ${i}: ${w.name} has no tower covering it`);
      if (w.role === 'inner') continue;
      const camps = plots.filter((p) => p.kind.startsWith('camp_')
        && Math.hypot(p.cx - w.gate[0], p.cz - w.gate[1]) < 14).length;
      assert.ok(camps >= 1, `${label} site ${i}: ${w.name} has no muster camp to hold or push from`);
    }

    // Outer works, where the land offered a gap: a fence plus a tower behind it.
    for (const w of walls.filter((p) => p.role === 'outer')) {
      assert.ok(w.tiles.length >= 2, `${label} site ${i}: ${w.name} spans nothing`);
      const towers = plots.filter((p) => p.kind === 'tower'
        && Math.hypot(p.cx - w.cx, p.cz - w.cz) < 8).length;
      assert.ok(towers >= 1, `${label} site ${i}: ${w.name} has no tower behind it`);
    }
    siteStats.push({ natural: (hq.plan.naturalShare * 100) | 0, outer: hq.plan.outerWorks });
    perSite.push({
      plots: plots.length, entrances: hq.plan.entrances,
      natural: (hq.plan.naturalShare * 100) | 0,
      inner: hq.plan.inner ? 1 : 0,
      outer: hq.plan.outerWorks,
      towers: plots.filter((p) => p.kind === 'tower').length,
    });
  });

  let sortie = null;
  let nodeForts = null;
  let lootStats = null;
  // --- and it has to actually run ------------------------------------------
  // The balance harness plays on flat test ground. This plays the real map:
  // found the city, run two minutes of siege, and check the systems that
  // depend on terrain — the lane graph, the hive musters, the horde's walk to
  // the walls — all still work on this landform.
  {
    const live = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
    const game = new Game(live, 'normal', 'alexander', null, level.id, 'campaign');
    game.foundCity(0, 0);
    const hqReach = game.plots.find((p) => p.kind === 'hq').plan.reach;
    assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph on its real terrain`);
    // Ground you take is ground you can fortify: every reachable node carries a
    // Forward Camp and a watchtower, and every work on it is locked until the
    // node is yours.
    for (const node of game.activeNodes()) {
      const works = game.plots.filter((p) => p.nodeId === node.id);
      assert.ok(works.some((p) => p.kind === 'outpost'), `${label}: ${node.name} has no Forward Camp plot`);
      assert.ok(works.some((p) => p.kind === 'tower'), `${label}: ${node.name} has no watchtower plot`);
      const structures = works.filter((p) => p.kind !== 'wall');
      for (const work of structures) {
        assert.ok(Math.hypot(work.cx - node.x, work.cz - node.z) >= 4,
          `${label}: ${node.name} ${work.kind} crowds the capture point`);
      }
      for (let i = 0; i < structures.length; i++) {
        for (let j = i + 1; j < structures.length; j++) {
          assert.ok(Math.hypot(structures[i].cx - structures[j].cx, structures[i].cz - structures[j].cz) >= 6,
            `${label}: ${node.name} structures are packed into one collision pocket`);
        }
      }
      for (const w of works) {
        assert.ok(game.plotLocked(w), `${label}: ${node.name} works are buildable before you hold it`);
      }
      // Build the two structures in the test occupancy grid, then prove the
      // capture point still has a route out of the fort instead of becoming a
      // pocket between foundations.
      node.owner = 'player';
      const localReach = () => {
        const startX = node.x | 0, startZ = node.z | 0, N = game.map.size;
        const queue = [[startX, startZ]];
        const seen = new Set([startZ * N + startX]);
        let farthest = 0;
        while (queue.length) {
          const [x, z] = queue.shift();
          farthest = Math.max(farthest, Math.hypot(x - node.x, z - node.z));
          if (farthest >= 10) return farthest;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz, key = nz * N + nx;
            if (seen.has(key) || !game.map.isWalkable(nx, nz) || game.occ[key] !== 0) continue;
            seen.add(key); queue.push([nx, nz]);
          }
        }
        return farthest;
      };
      const naturalReach = localReach();
      for (const work of structures) game._construct(work, true);
      const builtReach = localReach();
      assert.ok(builtReach >= Math.min(6, naturalReach) - 0.25,
        `${label}: ${node.name} structures reduce its route clearance from ${naturalReach.toFixed(1)} to ${builtReach.toFixed(1)}`);
      const workIds = new Set(structures.map((work) => work.id));
      for (const building of game.buildings.filter((b) => workIds.has(b.plotId))) {
        for (let dz = 0; dz < building.size; dz++) {
          for (let dx = 0; dx < building.size; dx++) game.occ[(building.z + dz) * game.map.size + building.x + dx] = 0;
        }
      }
      game.buildings = game.buildings.filter((b) => !workIds.has(b.plotId));
      for (const work of structures) { work.tier = 0; work.ruined = false; }
      node.owner = 'neutral';
    }
    // --- what the frontier is hiding -------------------------------------
    assert.ok(live.chokeSpots.length > 0, `${label} found no natural chokepoints`);
    assert.ok(game.loot.length >= 6, `${label} hid only ${game.loot.length} caches on a whole planet`);
    for (const l of game.loot) {
      assert.ok(live.isWalkable(l.x | 0, l.z | 0), `${label}: a cache is lying on unwalkable ground`);
      assert.ok(ITEMS[l.key], `${label}: a cache holds an unknown item "${l.key}"`);
      assert.ok(l.hidden, `${label}: a cache is visible before anyone has been near it`);
    }
    // Walk a hero onto four caches: the first fill the pack, the last is
    // refused, and dropping frees the slot again.
    {
      const hero = game.heroes[0];
      hero.pack.length = 0;
      game._refreshPackMods(hero);
      for (const l of game.loot.slice(0, PACK_SLOTS + 1)) {
        hero.x = l.x; hero.z = l.z;
        for (let k = 0; k < 3; k++) game.update(1 / 30);  // spot it, then take it
      }
      assert.equal(hero.pack.length, PACK_SLOTS,
        `${label}: the pack holds ${hero.pack.length} of ${PACK_SLOTS} after walking over ${PACK_SLOTS + 1} caches`);
      const carried = game.loot.length;
      game.exec({ t: 'drop', p: 0 });
      assert.equal(hero.pack.length, PACK_SLOTS - 1, `${label}: G did not empty a pack slot`);
      assert.equal(game.loot.length, carried + 1, `${label}: the dropped item did not land on the ground`);
      lootStats = { caches: carried + 1, pack: hero.pack.length };
    }

    nodeForts = {
      nodes: game.activeNodes().length,
      palisades: game.plots.filter((p) => p.nodeId != null && p.kind === 'wall').length,
    };
    const nodes = game.activeNodes();
    assert.ok(nodes.length >= 6, `${label} left only ${nodes.length} reachable lane nodes`);
    assert.ok(game.nests.every((n) => n.alive), `${label} shipped a hive that can never be razed`);

    // Man the wards and order the push. This is the other half of the promise:
    // a city whose gates the terrain closed is a city whose army cannot get
    // out, and a base that cannot sortie cannot take a lane.
    for (const plot of game.plots) {
      if (plot.kind.startsWith('camp_')) game._construct(plot, true);
    }
    game.stance = 'attack';

    for (let i = 0; i < 120 * 30; i++) game.update(1 / 30);
    assert.ok(!game.over, `${label} ended on its own inside two minutes`);
    assert.ok(game.zombies.length > 0, `${label}: nothing is coming — the horde never mustered`);
    assert.ok(game.threat > 0, `${label}: threat never rose`);
    const nearCity = game.zombies.filter((z) => Math.hypot(z.x - game.hq.cx, z.z - game.hq.cz) < 46).length;
    assert.ok(nearCity > 0, `${label}: no attacker can find a way to the city`);

    assert.ok(game.units.length > 0, `${label}: the wards mustered nobody`);
    const out = game.units.filter((u) => Math.hypot(u.x - game.hq.cx, u.z - game.hq.cz) > hqReach + 6).length;
    assert.ok(out >= 3, `${label}: only ${out} squads got out of the city — the gates do not work`);
    sortie = { units: game.units.length, out, zombies: game.zombies.length, threat: +game.threat.toFixed(1) };
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
    console.log(`  city    ${perSite.map((p) => `${p.plots}plots ${p.entrances}gates ${p.natural}% natural ${p.outer}outer${p.inner ? ' +ward' : ''}`).join(' | ')}`);
    console.log(`  loot    ${lootStats.caches} hidden caches, pack holds ${PACK_SLOTS}`);
    console.log(`  forts   ${nodeForts.nodes} expansion sites, ${nodeForts.palisades} with a natural pinch to fence`);
    console.log(`  siege   ${sortie.units} troops (${sortie.out} pushed out), ${sortie.zombies} dead afoot, threat ${sortie.threat} after 2min`);
    console.log(`  chokes  ${map.chokeSpots.length} natural gaps: ${map.chokeSpots.slice(0, 5).map((c) => `${c.name} (${c.width} wide)`).join(', ')}`);
  }
}

// --- the galaxy: the campaign must never run out of playable planets -------
// Spot-check a spread of procedural planets the same way the horde will see
// them: generated, founded, connected, and never sealed or marooned.
{
  const spotIds = [6, 7, 8, 9, 13, 21, 40];
  const combos = new Set();
  for (const id of spotIds) {
    const lv = levelById(id);
    const label = `${lv.name} (galaxy planet ${id})`;
    assert.ok(lv.galaxy, `${label} did not come from the galaxy generator`);
    // Deterministic: the same planet number is the same planet, always.
    const again = galaxyLevel(id);
    assert.equal(lv.seed, again.seed, `${label} is not deterministic`);
    assert.equal(lv.name, again.name, `${label} name is not deterministic`);
    combos.add(`${lv.theme.terrain}/${lv.theme.city}`);
    assert.ok(lv.economy.income <= 1.25 && lv.economy.pressure <= 1.15,
      `${label} economy multipliers out of bounds`);

    const map = new TerrainField(lv.seed, lv.theme, { size: lv.size, nests: lv.nests });
    const game = new Game(map, 'normal', 'alexander', null, id, 'campaign');
    game.foundCity(0, 0);
    assert.equal(game.level.id, id, `${label}: the sim looked up a different level`);
    assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph`);
    assert.ok(game.nests.every((n) => n.alive), `${label} shipped an unreachable hive`);
    assert.ok(game.activeNodes().length >= 6, `${label} has too few reachable nodes`);
    for (let i = 0; i < 20 * 30; i++) game.update(1 / 30);
    assert.ok(game.zombies.length > 0, `${label}: the hives never mustered`);
  }
  assert.ok(combos.size === spotIds.length,
    `galaxy planets repeat landform/plan combos too early (${combos.size}/${spotIds.length} distinct)`);
  if (REPORT) {
    console.log(`
galaxy — first frontier worlds:`);
    for (const id of spotIds) {
      const lv = levelById(id);
      console.log(`  ${String(id).padStart(3)}  ${lv.name.padEnd(18)} ${lv.theme.terrain}/${lv.theme.city}  x${lv.mult.toFixed(2)}  ${lv.boss.name}`);
    }
  }
}

// The whole point of anchoring on terrain is that the ground changes the base.
// If almost no site is using its landform as wall, the feature has regressed to
// "a ring, everywhere, again".
const anchored = siteStats.filter((s) => s.natural >= 10).length;
assert.ok(anchored >= siteStats.length * 0.4,
  `only ${anchored}/${siteStats.length} city sites let the terrain be part of the wall`);
assert.ok(siteStats.some((s) => s.natural >= 35),
  'no site anywhere in the campaign is genuinely terrain-anchored');
// ...and the other way: a site where the ground does nearly all the walling is
// a bye, so `MAX_NATURAL_SHARE` has to keep cutting extra approaches.
const walledOff = siteStats.filter((s) => s.natural > 80);
assert.equal(walledOff.length, 0,
  `${walledOff.length} city sites are ${walledOff.map((s) => s.natural).join('/')}% natural — nothing left to defend`);
assert.ok(siteStats.every((s) => s.outer >= 1),
  'a site was offered no outer chokepoint works at all');

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
