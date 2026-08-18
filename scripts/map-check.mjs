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
import { LEVELS, LABYRINTH_LEVELS, levelById, galaxyLevel, TILE, TILE_INFO, ITEMS, PACK_SLOTS, SIEGE, itemInfo } from '../src/config.js';

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

  // --- reachability: lane nodes and buildable pockets --------------------
  // The frontier connector bridges hives and sites; nodes and pockets are on
  // it too now. A regression here means marooned objectives (a barrow nobody
  // can ride to) or promised build ground with no road (an outpost inside
  // unmovable terrain) — the exact classes of bug this check exists to kill.
  {
    const reach = flood(map, Math.round(map.sites[0].x), Math.round(map.sites[0].z));
    for (const nd of map.nodeSpots) {
      // A node is "there" if it or any tile within 3 of it is reached — the
      // node anchor itself may sit on the feature (a ford mid-water).
      let ok = false;
      for (let dz = -3; dz <= 3 && !ok; dz++) {
        for (let dx = -3; dx <= 3 && !ok; dx++) {
          const x = Math.round(nd.x) + dx, z = Math.round(nd.z) + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          if (reach[z * N + x]) ok = true;
        }
      }
      assert.ok(ok, `${label}: lane node ${nd.kind} at ${nd.x | 0},${nd.z | 0} is unreachable from ${map.sites[0].name}`);
      // The current outpost progression is a 2x2 fort centered exactly on the
      // flag. A reachable flag is still broken if that footprint is submerged
      // or buried in forest/crag.
      const x0 = (nd.x | 0) - 1, z0 = (nd.z | 0) - 1;
      for (let z = z0; z < z0 + 2; z++) {
        for (let x = x0; x < x0 + 2; x++) {
          assert.ok(map.isBuildable(x, z),
            `${label}: lane node ${nd.kind} at ${nd.x | 0},${nd.z | 0} has an unbuildable outpost foundation`);
        }
      }
    }
    // Buildable pockets outside the main flood must be scenery-sized (<6 tiles).
    const claimed = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if (claimed[i] || reach[i] || !TILE_INFO[map.tiles[i]].build) continue;
      let size = 0;
      const stack = [i];
      claimed[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = j % N, z = (j / N) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const ni = nz * N + nx;
          if (claimed[ni] || reach[ni] || !TILE_INFO[map.tiles[ni]].build) continue;
          claimed[ni] = 1;
          stack.push(ni);
        }
      }
      assert.ok(size < 6,
        `${label}: a buildable pocket of ${size} tiles is unreachable from ${map.sites[0].name} — outpost with no road`);
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
    // Every building has a designed home and no filler to top the city up, so
    // the floor is what the plans actually author — not what a dice roll hid.
    assert.ok(plots.length >= 40, `${label} site ${i} laid out only ${plots.length} plots`);
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

    // --- the pad: inside its disc, the ground is the founders', not the
    // landform's. 100% walkable and buildable, no exceptions, no rounding
    // charity — this is the whole promise of the pad system.
    {
      const R = site.padR;
      assert.ok(R >= 22 && R <= 30, `${label} site ${i} pad radius ${R} is off-spec`);
      let bad = 0;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dz * dz > R * R) continue;
          const x = Math.round(site.x) + dx, z = Math.round(site.z) + dz;
          if (!map.inBounds(x, z)) { bad++; continue; }
          if (!map.isWalkable(x, z) || !map.isBuildable(x, z)) bad++;
        }
      }
      assert.equal(bad, 0,
        `${label} site ${i}: ${bad} tiles inside its own pad are not flat buildable ground`);
    }

    // --- every slot on real ground: a plot footprint the land refuses is a
    // promise the city cannot keep. Zero exceptions.
    for (const p of plots) {
      if (p.kind === 'wall') continue;   // walls may stand on the rim by design
      for (let dz = 0; dz < p.size; dz++) {
        for (let dx = 0; dx < p.size; dx++) {
          assert.ok(scratch.isBuildable(p.x + dx, p.z + dz) && scratch.isWalkable(p.x + dx, p.z + dz),
            `${label} site ${i}: a ${p.kind} plot at ${p.x},${p.z} stands on unbuildable ground`);
        }
      }
    }

    // --- every outpost keep reachable from the city it answers to, and every
    // keep a real one: palisade arcs with a gate and a tower behind it.
    {
      const S = scratch.size;
      const seen = new Uint8Array(S * S);
      const stack = [Math.round(site.z) * S + Math.round(site.x)];
      seen[stack[0]] = 1;
      while (stack.length) {
        const k = stack.pop();
        const x = k % S, z = (k / S) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= S || nz >= S || seen[nz * S + nx]) continue;
          if (!scratch.isWalkable(nx, nz)) continue;
          seen[nz * S + nx] = 1; stack.push(nz * S + nx);
        }
      }
      for (const w of walls.filter((p) => p.role === 'outer')) {
        assert.ok(w.tiles.length >= 2, `${label} site ${i}: ${w.name} spans nothing`);
        assert.ok(w.gate, `${label} site ${i}: ${w.name} has no gate — a fence against yourself`);
        assert.ok(seen[Math.round(w.keep ? w.keep[1] : w.cz) * S + Math.round(w.keep ? w.keep[0] : w.cx)],
          `${label} site ${i}: ${w.name} is unreachable from the city — a keep with no road`);
        const towers = plots.filter((p) => p.kind === 'tower'
          && Math.hypot(p.cx - w.cx, p.cz - w.cz) < 9).length;
        assert.ok(towers >= 1, `${label} site ${i}: ${w.name} has no tower behind it`);
      }
    }
    siteStats.push({ pad: 100, outer: hq.plan.outerWorks });
    perSite.push({
      plots: plots.length, entrances: hq.plan.entrances,
      pad: 100, keeps: hq.plan.outerWorks,
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
    const spawnGame = new Game(live, 'normal', ['scott', 'alexander', 'danny'], null, level.id, 'campaign');
    const spawnTiles = new Set();
    for (const hero of spawnGame.heroes) {
      const x = hero.x | 0, z = hero.z | 0;
      assert.ok(live.isWalkable(x, z), `${label}: ${hero.def.name} spawned on impassable terrain`);
      assert.ok(!spawnTiles.has(`${x},${z}`), `${label}: two heroes spawned on the same tile`);
      spawnTiles.add(`${x},${z}`);
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => live.isWalkable(x + dx, z + dz)),
        `${label}: ${hero.def.name} spawned without a walkable exit`);
    }
    const game = new Game(live, 'normal', 'alexander', null, level.id, 'campaign');
    game.foundCity(0, 0);
    if (game.firstSiege) game.firstSiege.stage = 'complete';
    const hqReach = game.plots.find((p) => p.kind === 'hq').plan.reach;
    assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph on its real terrain`);

    // --- the sortie guarantee, at WORST CASE: every plot funded to its top
    // tier. A city the hero cannot walk out of — plaza sealed by its own
    // districts, or gates that open into terrain pockets — is unplayable no
    // matter how pretty the plan (QA 2026-08-16: a full-built L5 throat keep
    // sealed the hero in with 0 of 1780 outside tiles reachable).
    {
      const N = game.map.size, occ = game.occ, gates = game.gateIds;
      for (const p of game.plots) {
        let guard = 0;
        while (p.tier < 3 && guard++ < 4) game._construct(p, true);
      }
      const pass = (x, z) => x >= 0 && z >= 0 && x < N && z < N
        && game.map.isWalkable(x, z)
        && (occ[z * N + x] === 0 || gates.has(occ[z * N + x]));
      const hq = game.hq;
      const seen = new Uint8Array(N * N);
      // Seed on the plaza ring around the Keep, not the Keep itself.
      let sx = -1, sz = -1;
      outer:
      for (let r = 2; r <= 6; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const x = (hq.cx | 0) + dx, z = (hq.cz | 0) + dz;
          if (pass(x, z)) { sx = x; sz = z; break outer; }
        }
      }
      assert.ok(sx >= 0, `${label}: the Keep plaza itself is unwalkable at full build`);
      // City-ring gates only (rampart + inner ward) — outer palisades are
      // optional works, not entrances.
      const cityGateIds = new Set();
      for (const b of game.buildings) {
        if (!b.gate) continue;
        const p = game.plots.find((pl) => pl.id === b.plotId);
        if (p && p.kind === 'wall' && p.role !== 'outer') cityGateIds.add(b.id);
      }
      const stack = [sz * N + sx];
      seen[sz * N + sx] = 1;
      let escaped = false;
      // Distinct entrances, not tiles: an arch is 3-4 adjacent gate buildings
      // of one wall plot, and the flood must not stop at the first way out.
      const cityGatePlots = new Map();
      for (const b of game.buildings) {
        if (!b.gate) continue;
        const p = game.plots.find((pl) => pl.id === b.plotId);
        if (p && p.kind === 'wall' && p.role !== 'outer') cityGatePlots.set(b.id, p.id);
      }
      const reachedGates = new Set();
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % N, z = (idx / N) | 0;
        if (Math.hypot(x + 0.5 - hq.cx, z + 0.5 - hq.cz) > hqReach + 4) escaped = true;
        const gatePlot = cityGatePlots.get(occ[idx]);
        if (gatePlot) reachedGates.add(gatePlot);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz, ni = nz * N + nx;
          if (seen[ni] || !pass(nx, nz)) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      assert.ok(reachedGates.size >= 2,
        `${label}: at full build the plaza reaches only ${reachedGates.size} city gates — the wards sealed the streets`);
      assert.ok(escaped,
        `${label}: at full build nothing reaches open country — the city is a box`);
    }
    // Ground you take is ground you can fortify: every reachable node carries
    // one flag-centered Forward Camp progression. The camp itself grows the
    // palisade and twin towers, so there are no scattered upgrade plots.
    for (const node of game.activeNodes()) {
      const works = game.plots.filter((p) => p.nodeId === node.id);
      assert.equal(works.length, 1, `${label}: ${node.name} has scattered node upgrade plots`);
      const outpost = works[0];
      assert.equal(outpost.kind, 'outpost', `${label}: ${node.name} has no Forward Camp plot`);
      assert.ok(Math.hypot(outpost.cx - node.x, outpost.cz - node.z) < 0.1,
        `${label}: ${node.name} Forward Camp is not anchored on its flag`);
      assert.ok(game.plotLocked(outpost), `${label}: ${node.name} is buildable before you hold it`);
      node.owner = 'player';
      const hero = game.heroes[0];
      hero.x = node.x + SIEGE.captureRadius - 0.5;
      hero.z = node.z;
      assert.equal(game.buildTargetFor(hero)?.plot.id, outpost.id,
        `${label}: ${node.name} cannot be upgraded from inside its territory circle`);
      node.owner = 'neutral';
    }
    // --- what the frontier is hiding -------------------------------------
    assert.ok(live.chokeSpots.length > 0, `${label} found no natural chokepoints`);
    assert.ok(game.loot.length >= 6, `${label} hid only ${game.loot.length} caches on a whole planet`);
    for (const l of game.loot) {
      assert.ok(live.isWalkable(l.x | 0, l.z | 0), `${label}: a cache is lying on unwalkable ground`);
      // A cache holds either an authored item or a rolled one. Both must
      // resolve to something wearable — an unresolvable key is a dead pickup.
      assert.ok(itemInfo(l.key), `${label}: a cache holds an unknown item "${l.key}"`);
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
      palisades: game.plots.filter((p) => p.nodeId != null && p.kind === 'outpost').length,
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

    let peakZombies = 0, peakThreat = 0, peakNearCity = 0;
    for (let i = 0; i < 120 * 30; i++) {
      game.update(1 / 30);
      peakZombies = Math.max(peakZombies, game.zombies.length);
      peakThreat = Math.max(peakThreat, game.threat);
      peakNearCity = Math.max(peakNearCity,
        game.zombies.filter((z) => Math.hypot(z.x - game.hq.cx, z.z - game.hq.cz) < 46).length);
      if (game.over) break;
    }
    assert.ok(!game.over || game.won, `${label} lost on its own inside two minutes`);
    assert.ok(peakZombies > 0, `${label}: nothing is coming — the horde never mustered`);
    assert.ok(peakThreat > 0, `${label}: threat never rose`);
    assert.ok(peakNearCity > 0, `${label}: no attacker can find a way to the city`);

    assert.ok(game.units.length > 0, `${label}: the wards mustered nobody`);
    const out = game.units.filter((u) => Math.hypot(u.x - game.hq.cx, u.z - game.hq.cz) > hqReach + 6).length;
    assert.ok(out >= 3, `${label}: only ${out} squads got out of the city — the gates do not work`);
    sortie = { units: game.units.length, out, zombies: peakZombies, threat: +peakThreat.toFixed(1) };
  }

  // --- no two planets may read the same ------------------------------------
  // The buckets are fine (1/50th of the map) because the pads now clear a
  // known few percent of every planet — a coarse bucket would read two
  // genuinely different planets as one.
  const sig = [
    (hist.WATER * 50) | 0, (hist.MOUNTAIN * 50) | 0, (hist.FOREST * 50) | 0,
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
    console.log(`  city    ${perSite.map((p) => `${p.plots}plots ${p.entrances}gates ${p.outer}keep-arcs${p.inner ? ' +ward' : ''}`).join(' | ')}`);
    console.log(`  loot    ${lootStats.caches} hidden caches, pack holds ${PACK_SLOTS}`);
    console.log(`  forts   ${nodeForts.nodes} expansion sites, ${nodeForts.palisades} with a natural pinch to fence`);
    console.log(`  siege   ${sortie.units} troops (${sortie.out} pushed out), ${sortie.zombies} dead afoot, threat ${sortie.threat} after 2min`);
    console.log(`  pads    ${map.sites.map((s) => `${s.name} r${s.padR}`).join(' | ')}`);
    console.log(`  keeps   ${map.outpostSpots.map((o) => `${o.name} ${o.x | 0},${o.z | 0}`).join(' · ')}`);
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

// The whole point of the pad is that the ground under a city is authored, so
// every site owes the same three things: a perfect pad, keeps that are real
// forts, and no building the land can refuse. If any site anywhere in the
// campaign falls short, the pad has regressed to "a ring, everywhere, again".
assert.equal(siteStats.filter((s) => s.pad >= 100).length, siteStats.length,
  'a city site shipped without a fully buildable pad');
assert.ok(siteStats.every((s) => s.outer >= 1),
  'a site was offered no outer keep at all');

// Every archetype and every city plan has to be in the campaign — an unused
// one is an untested one. The labyrinth landform belongs to the Labyrinth
// trial roster (scripts/labyrinth-check.mjs exercises it), not the campaign.
const usedTerrain = new Set(LEVELS.map((l) => l.theme.terrain));
const labyrinthTerrain = new Set(LABYRINTH_LEVELS.map((l) => l.theme.terrain));
for (const key of Object.keys(TERRAIN_SHAPES)) {
  assert.ok(usedTerrain.has(key) || labyrinthTerrain.has(key), `landform "${key}" is not used by any level`);
}
const usedPlans = new Set(LEVELS.map((l) => l.theme.city));
for (const key of Object.keys(CITY_PLANS)) {
  assert.ok(usedPlans.has(key), `city plan "${key}" is not used by any level`);
}
assert.equal(usedPlans.size, LEVELS.length, 'two levels share a city plan — the bases would look the same');
assert.equal(usedTerrain.size, LEVELS.length, 'two levels share a landform — the maps would look the same');

console.log(`map-check: ${LEVELS.length} levels, ${usedTerrain.size} landforms, ${usedPlans.size} city plans — all distinct.`);
