// Galaxy check: the procedural galaxy and the meta-progression ladder, built
// headless and asserted the way `map-check.mjs` asserts a battlefield.
//
// Three questions, and the whole file is answers to them:
//
//   1. Is the galaxy the SAME galaxy every time? A seed must produce one
//      structure hash, forever — lockstep peers agree about where a world is
//      and how hard it is without shipping any of it.
//   2. Is every world in it actually playable? Every frontier world's landform
//      is generated for real and held to map-check's bar: enough ground, three
//      spread city sites on land, every hive placed and reachable. Descriptors
//      are stitched into walking planets and every gate must be reachable on
//      foot from the spawn.
//   3. Can the meta ladder be broken? The tree must have no orphaned or
//      circular prerequisites, and no sequence of awards and purchases —
//      including hostile ones — may drive a balance negative or hand out a
//      node nobody paid for.
//
// Run `node scripts/galaxy-check.mjs --report` for a readout of the galaxy.
import assert from 'node:assert/strict';
import {
  GALAXY_SEED, generateGalaxy, knownGalaxy, galaxyHash, presencePositionAt,
  descriptorForWorld, descriptorForWorldId, galaxyDestinationList, galaxyProgress,
  findWorld, findSystem, worldByLevelId, worldUnlocked, worldCleared, worldMissionMode,
  threatTierFor, THREAT_TIERS,
} from '../src/galaxy.js';
import {
  META_NODES, META_NODES_BY_ID, META_BRANCHES, META_EARN_RATE, emptyMeta,
  normalizeMeta, applyAward, applySpend, bonusesFor, metaTreeView, nodeState,
  loadMeta, awardRun, spend, metaBonuses, setMetaBackend, memoryBackend, resetMeta,
} from '../src/meta.js';
import { LEVELS, LABYRINTH_LEVELS, levelById, GALAXY_WORLD_KINDS, galaxyWorldKind } from '../src/config.js';
import {
  FACTIONS, FACTION_PRESENCE, FACTION_ORIGINS, factionById, factionByKey,
  factionForWorld, proceduralFaction, holdsWorlds, isMobile, systemOwner,
} from '../src/factions.js';
import { TerrainField, TERRAIN_SHAPES } from '../src/terrain.js';
import { OverworldField, overworldReachable, overworldLayout } from '../src/overworld.js';
import { Game, runScore } from '../src/game.js';
import { TILE_INFO } from '../src/config.js';

const REPORT = process.argv.includes('--report');

// map-check's flood, applied to a frontier landform.
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

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------
// The shipped galaxy's structure hash. It is pinned for the same reason
// overworld-check pins Earth's tile hash: the layout is content, and content
// must not move by accident.
const GALAXY_HASH = '2d0626e7';

const galaxy = generateGalaxy(GALAXY_SEED);
const twin = generateGalaxy(GALAXY_SEED);
assert.equal(galaxy.hash, GALAXY_HASH, 'the shipped galaxy changed shape — update GALAXY_HASH deliberately, never silently');
assert.equal(twin.hash, galaxy.hash, 'the same seed must build the same galaxy');
assert.equal(galaxyHash(twin), galaxyHash(galaxy), 'the structure hash must be a pure function of the structure');
assert.deepEqual(
  twin.worlds.map((w) => [w.id, w.name, w.kind, w.levelId, w.threatTier, w.mult]),
  galaxy.worlds.map((w) => [w.id, w.name, w.kind, w.levelId, w.threatTier, w.mult]),
  'the same seed must build the same worlds in the same order',
);
assert.deepEqual(
  twin.systems.map((s) => [s.id, s.name, s.position.x, s.position.y, s.position.z]),
  galaxy.systems.map((s) => [s.id, s.name, s.position.x, s.position.y, s.position.z]),
  'system layout must be seed-stable to the last decimal',
);
assert.equal(knownGalaxy().hash, galaxy.hash, 'knownGalaxy() must be the shipped galaxy');
assert.equal(knownGalaxy(), knownGalaxy(), 'knownGalaxy() must hand out one shared galaxy');

// A different seed is a different universe — proof the generator consumes it.
const other = generateGalaxy(GALAXY_SEED + 1);
assert.notEqual(other.hash, galaxy.hash, 'a different seed must build a different galaxy');
assert.notDeepEqual(
  other.systems.map((s) => s.position.x),
  galaxy.systems.map((s) => s.position.x),
  'a different seed must move the systems',
);

// ---------------------------------------------------------------------------
// 2. Structure
// ---------------------------------------------------------------------------
const frontier = galaxy.worlds.filter((w) => w.id !== 'earth');
assert.ok(frontier.length >= 50, `the galaxy must ship at least 50 frontier worlds (has ${frontier.length})`);
assert.equal(galaxy.systems[0].id, 'sys-sol', 'Sol must be the hub of the galaxy');
assert.equal(galaxy.systems[0].worlds[0].id, 'earth', 'Earth must be the first world of Sol');
assert.equal(galaxy.worlds[0].id, 'earth', 'Earth must be the galactic start');

const ids = new Set();
for (const world of galaxy.worlds) {
  assert.ok(!ids.has(world.id), `world id ${world.id} is used twice`);
  ids.add(world.id);
  assert.ok(world.name && world.systemId && world.position, `${world.id} is missing identity`);
  assert.ok(findSystem(galaxy, world.systemId), `${world.id} belongs to no system`);
}
for (const system of galaxy.systems) {
  assert.ok(system.id && system.name && Number.isFinite(system.seed), `${system.id} is not a real system`);
  assert.ok(system.worlds.length >= 1, `${system.name} has no worlds`);
  assert.equal(system.threatTier, system.worlds[0].threatTier, `${system.name} misreports its threat tier`);
  for (const w of system.worlds) assert.equal(w.systemId, system.id, 'a world escaped its system');
}

// Level ids are handed out in distance order and are contiguous, so
// `levelById()` resolves every world and the progression ladder has no holes.
frontier.forEach((world, i) => {
  assert.equal(world.levelId, LEVELS.length + 1 + i, `${world.name} is out of level-id order`);
  assert.equal(world.id, `frontier-${world.levelId}`, 'world ids must stay resolvable by level id');
  assert.equal(worldByLevelId(galaxy, world.levelId), world, 'level-id lookup must find the world');
  assert.equal(findWorld(galaxy, world.id), world, 'world-id lookup must find the world');
});

// Threat: the ladder only ever climbs, it starts past Earth's last front, and
// it reaches the deep end the design asks for.
assert.equal(LEVELS.at(-1).mult, 2, 'the Earth campaign must still end at x2.0');
let prevMult = 2;
for (const world of frontier) {
  const level = levelById(world.levelId);
  assert.equal(world.mult, level.mult, `${world.name} disagrees with levelById() about difficulty`);
  assert.ok(world.mult > prevMult, `${world.name} (x${world.mult}) is not harder than the world before it`);
  assert.equal(world.threatTier, threatTierFor(world.mult), `${world.name} misreports its threat band`);
  assert.ok(world.threatTier >= 1 && world.threatTier < THREAT_TIERS.length, `${world.name} has no threat band`);
  prevMult = world.mult;
}
assert.ok(frontier[0].mult >= 2.2, `the first frontier world must open past x2.2 (is x${frontier[0].mult})`);
assert.ok(frontier.at(-1).mult >= 9, `the deep galaxy must reach x9 or worse (tops out at x${frontier.at(-1).mult})`);
assert.equal(threatTierFor(2), 0, 'Earth-grade difficulty is not a frontier threat band');

// Kinds: all three exist, every world is tagged, and the tag agrees with the
// config-side generator that the simulation reads.
const kindCounts = {};
for (const world of frontier) {
  assert.ok(GALAXY_WORLD_KINDS[world.kind], `${world.name} has an unknown kind "${world.kind}"`);
  assert.equal(world.kind, galaxyWorldKind(world.levelId), `${world.name} disagrees with config about its kind`);
  assert.equal(world.kind, levelById(world.levelId).worldKind, `${world.name} is not tagged on its level`);
  kindCounts[world.kind] = (kindCounts[world.kind] || 0) + 1;
}
for (const kind of ['standard', 'holdout', 'derelict']) {
  assert.ok(kindCounts[kind] >= 4, `the galaxy must offer real variety — only ${kindCounts[kind] || 0} ${kind} worlds`);
}
for (let i = 1; i < frontier.length; i++) {
  const a = frontier[i - 1].kind, b = frontier[i].kind;
  assert.ok(a === 'standard' || b === 'standard' || a !== b,
    `two ${a} worlds in a row at ${frontier[i].name} — the cadence collapsed`);
}
assert.equal(worldMissionMode(frontier.find((w) => w.kind === 'holdout')), 'survival', 'a holdout is a survival world');
assert.equal(worldMissionMode(frontier.find((w) => w.kind === 'standard')), 'campaign', 'a standard world is a campaign world');
assert.equal(worldMissionMode(frontier.find((w) => w.kind === 'derelict')), 'campaign', 'a derelict is walked, not survived');

// Holdouts and derelicts must actually PLAY differently, not just read
// differently: the economy and hive count are what the kind changes.
{
  const eco = (kind) => frontier.filter((w) => w.kind === kind).map((w) => levelById(w.levelId));
  const holdouts = eco('holdout'), derelicts = eco('derelict');
  assert.ok(holdouts.every((l) => l.economy.pressure >= 1.11), 'holdouts must push harder than a standard landing');
  assert.ok(derelicts.every((l) => l.economy.startGold <= 116), 'derelicts must land you poorer');
  assert.ok(holdouts.every((l) => l.quests.some((q) => /Threat/.test(q.desc))), 'a holdout must ask you to last');
  assert.ok(derelicts.every((l) => l.quests.some((q) => /gold/.test(q.desc))), 'a derelict must ask you to salvage');
  for (const level of [...holdouts, ...derelicts]) {
    assert.ok(level.economy.income <= 1.25 && level.economy.pressure <= 1.15,
      `${level.name} economy multipliers out of bounds`);
    assert.ok(level.nests >= 3 && level.nests <= 7, `${level.name} has an unplayable hive count`);
  }
}

// Unlock ladder: nothing off Earth is reachable before Earth is retaken, and
// then exactly one world at a time.
{
  const first = frontier[0];
  assert.ok(!worldUnlocked(first, LEVELS.length - 1), 'the galaxy must stay shut until Earth is retaken');
  assert.ok(worldUnlocked(first, LEVELS.length), 'the first frontier world opens when Earth is retaken');
  assert.ok(!worldUnlocked(frontier[1], LEVELS.length), 'the galaxy must open one world at a time');
  assert.ok(worldCleared(first, first.levelId), 'a world you beat must read as cleared');
  assert.ok(!worldCleared(first, first.levelId - 1), 'a world you have not beaten must not read as cleared');

  const progress = galaxyProgress(galaxy, LEVELS.length + 3);
  assert.equal(progress.cleared, 3, 'progress must count the worlds actually taken');
  assert.equal(progress.total, frontier.length, 'progress must count every frontier world');
  assert.equal(progress.next.levelId, LEVELS.length + 4, 'progress must point at the next world');
  assert.ok(progress.earthRetaken, 'progress must know Earth is behind you');
  assert.equal(galaxyProgress(galaxy, 0).cleared, 0, 'a fresh profile has taken nothing');
  assert.equal(galaxyProgress(galaxy, 0).next, null, 'a fresh profile has no frontier destination');
}

// The destination list keeps the shape the existing galaxy UI consumes.
{
  const list = galaxyDestinationList(galaxy, LEVELS.length + 2);
  assert.equal(list.length, galaxy.worlds.length, 'every world must be a destination');
  assert.equal(list[0].id, 'earth', 'Earth heads the destination list');
  for (const d of list) {
    for (const key of ['id', 'name', 'subtitle', 'levelId', 'unlocked', 'cleared', 'threat']) {
      assert.ok(key in d, `destination ${d.id} is missing "${key}" — the existing galaxy UI reads it`);
    }
    for (const key of ['factionId', 'faction', 'factionName', 'hostile']) {
      assert.ok(key in d, `destination ${d.id} is missing "${key}" — a galaxy map colours by owner`);
    }
  }
  assert.equal(list.filter((d) => d.cleared).length, 3, 'Earth and the two taken worlds must read as cleared');
  assert.equal(list.filter((d) => d.unlocked).length, 4, 'Earth, two cleared worlds and the next one are open');
  const shallow = galaxyDestinationList(galaxy, LEVELS.length, 4);
  assert.equal(shallow.length, 5, 'a depth-limited chart shows Earth plus that many worlds');
}

// ---------------------------------------------------------------------------
// 2b. Factions
// ---------------------------------------------------------------------------
// The roster ships seven authored factions and mints the rest from their
// number. The rule the rest of this section exists to protect: a faction with
// no ground must never end up owning ground.
assert.equal(FACTIONS.length, 7, 'the authored roster is seven factions');
assert.equal(FACTIONS.filter((f) => f.origin === 'human').length, 3, 'three of the seven are human');
assert.equal(FACTIONS.filter((f) => f.origin === 'xeno').length, 4, 'four of the seven are xeno');
{
  const keys = new Set(), ids = new Set(), names = new Set();
  for (const faction of FACTIONS) {
    assert.ok(!keys.has(faction.key), `duplicate faction key ${faction.key}`);
    assert.ok(!ids.has(faction.id), `duplicate faction id ${faction.id}`);
    assert.ok(!names.has(faction.name), `duplicate faction name ${faction.name}`);
    keys.add(faction.key); ids.add(faction.id); names.add(faction.name);
    assert.ok(FACTION_ORIGINS[faction.origin], `${faction.key} has no origin`);
    assert.ok(FACTION_PRESENCE[faction.presence], `${faction.key} has no presence archetype`);
    assert.ok(faction.name && faction.short && faction.blurb, `${faction.key} has no player-facing copy`);
    assert.ok(Number.isInteger(faction.color) && faction.color >= 0 && faction.color <= 0xffffff,
      `${faction.key} has no map colour`);
    assert.equal(typeof faction.war.hostile, 'boolean', `${faction.key} must declare a posture`);
    assert.ok(faction.war.aggression >= 0 && faction.war.aggression <= 1, `${faction.key} aggression out of range`);
    // `war` is data. A faction that carried behaviour could change the sim.
    for (const value of Object.values(faction.war)) {
      assert.ok(typeof value !== 'function', `${faction.key} carries behaviour in war — factions must be data`);
    }
    assert.equal(factionById(faction.id), faction, `${faction.key} must resolve by id`);
    assert.equal(factionByKey(faction.key), faction, `${faction.key} must resolve by key`);
  }
  // Every presence archetype is represented, or the taxonomy is theoretical.
  for (const presence of Object.keys(FACTION_PRESENCE)) {
    assert.ok(FACTIONS.some((f) => f.presence === presence),
      `no authored faction uses the "${presence}" presence`);
  }
  // The three the design turns on: someone human holds ground, someone flies
  // without any, and something drifts.
  assert.ok(FACTIONS.some((f) => f.origin === 'human' && f.presence === 'worlds'), 'a human faction must hold worlds');
  assert.ok(FACTIONS.some((f) => f.presence === 'fleets' && !holdsWorlds(f)), 'a fleet faction must hold no worlds');
  assert.ok(FACTIONS.some((f) => f.presence === 'drift' && isMobile(f)), 'a drifting faction must be mobile');
  assert.equal(holdsWorlds(factionByKey('courts')), false, 'the Salvage Courts must never hold ground');
  assert.equal(holdsWorlds(factionByKey('gyre')), false, 'the Gyre must never hold ground');
  assert.equal(holdsWorlds(factionByKey('bloom')), false, 'the Bloom must never hold ground');
}

// Zillions of factions: past the authored seven they are minted from a number,
// deterministically, forever.
{
  for (const id of [8, 9, 40, 999, 12345, 1000000]) {
    const a = factionById(id), b = proceduralFaction(id);
    assert.equal(a.name, b.name, `faction ${id} is not deterministic`);
    assert.equal(a.presence, b.presence, `faction ${id} presence is not deterministic`);
    assert.equal(a.color, b.color, `faction ${id} colour is not deterministic`);
    assert.ok(FACTION_PRESENCE[a.presence], `faction ${id} has no presence archetype`);
    assert.ok(FACTION_ORIGINS[a.origin], `faction ${id} has no origin`);
    assert.ok(a.procedural, `faction ${id} must be marked procedural`);
    assert.equal(factionById(id), factionById(id), `faction ${id} must be cached, not rebuilt`);
  }
  // Names are two words over a few hundred combinations and WILL repeat; the
  // catalogue designation is what has to be unique, because that is what tells
  // two unnamed factions apart on a map.
  const designations = new Set();
  for (let id = FACTIONS.length + 1; id <= FACTIONS.length + 4000; id++) {
    const faction = factionById(id);
    assert.ok(!designations.has(faction.designation),
      `procedural faction designation ${faction.designation} collides at id ${id}`);
    designations.add(faction.designation);
    assert.ok(faction.label.includes(faction.designation), `faction ${id} must show its designation`);
  }
  // All four presences keep appearing as the roster scales.
  const presences = new Set();
  for (let id = FACTIONS.length + 1; id <= FACTIONS.length + 40; id++) presences.add(factionById(id).presence);
  assert.equal(presences.size, Object.keys(FACTION_PRESENCE).length, 'procedural factions must span every presence');
}

// Assignment: pure, deterministic, and it never gives ground to a faction that
// has none.
{
  for (const kind of ['standard', 'holdout', 'derelict']) {
    for (const n of [1, 2, 3, 12, 25, 33, 44, 55, 110, 400]) {
      const a = factionForWorld(n, kind), b = factionForWorld(n, kind);
      assert.equal(a.id, b.id, `world ${n}/${kind} faction is not deterministic`);
      assert.ok(holdsWorlds(a), `world ${n}/${kind} was given to ${a.name}, which holds no ground`);
    }
  }
  assert.equal(factionForWorld(9, 'derelict').key, 'cenotaph', 'a derelict is a Cenotaph tomb');
  assert.equal(factionForWorld(400, 'derelict').key, 'cenotaph', 'every derelict is a Cenotaph tomb');
  assert.ok(['remnant', 'creed'].includes(factionForWorld(8, 'holdout').key),
    'a holdout is held by humans — that is why it is a holdout');
  // Two deep worlds must not walk onto the same unknown faction.
  const deep = [33, 44, 55, 66, 77, 88].map((n) => factionForWorld(n, 'standard').id);
  assert.equal(new Set(deep).size, deep.length, 'deep frontier worlds collapsed onto one unknown faction');
}

// In the shipped galaxy: every world has a holder, every roamer has none, and
// system ownership is a projection that agrees with the worlds under it.
{
  for (const world of galaxy.worlds) {
    assert.ok(world.faction && world.factionId, `${world.name} has no faction`);
    assert.equal(world.faction.id, world.factionId, `${world.name} faction id disagrees with its record`);
    assert.ok(holdsWorlds(world.faction), `${world.name} is held by ${world.faction.name}, which holds no ground`);
  }
  assert.equal(galaxy.worlds[0].faction.key, 'remnant', 'Earth is held by the Remnant');
  const holders = new Set(galaxy.worlds.map((w) => w.faction.key));
  assert.ok(holders.has('brood'), 'the Brood must hold worlds in the shipped galaxy');
  assert.ok(holders.has('cenotaph'), 'the Cenotaph must hold derelicts in the shipped galaxy');
  assert.ok(holders.size >= 4, `only ${holders.size} factions hold ground — the map reads as one war`);

  assert.ok(galaxy.presence.length > 0, 'the shipped galaxy must have roamers in it');
  const roamers = new Set();
  for (const site of galaxy.presence) {
    assert.ok(site.faction && site.factionId, `${site.id} has no faction`);
    assert.equal(holdsWorlds(site.faction), false,
      `${site.id} is a roaming site owned by ${site.faction.name}, which holds ground`);
    assert.ok(['anchorage', 'bloom'].includes(site.kind), `${site.id} has an unknown site kind`);
    // The invariant that keeps the campaign ladder honest.
    assert.ok(!('levelId' in site), `${site.id} consumes a level id — an anchorage is not a landing`);
    assert.ok(findSystem(galaxy, site.systemId), `${site.id} belongs to no system`);
    roamers.add(site.faction.key);
  }
  assert.ok(roamers.has('bloom') || roamers.has('courts') || roamers.has('gyre'),
    'the shipped galaxy must show an authored roaming faction');

  // Roaming sites take no level ids: the ladder is still contiguous with them
  // in the galaxy, which is the whole reason they are not worlds.
  assert.equal(galaxy.lastLevelId - galaxy.firstLevelId + 1, frontier.length,
    'roaming sites must not consume level ids');

  for (const system of galaxy.systems) {
    const owner = systemOwner(system);
    assert.equal(system.factionId, owner ? owner.id : null, `${system.name} owner is not the computed projection`);
    if (system.worlds.length) {
      assert.ok(system.worlds.some((w) => w.factionId === system.factionId),
        `${system.name} is owned by a faction that holds none of its worlds`);
    }
  }
}

// Mobility: a roamer moves, and moving does not touch the structure hash.
{
  const mobile = galaxy.presence.find((s) => s.mobile);
  assert.ok(mobile, 'the shipped galaxy must contain a mobile roamer');
  const at0 = presencePositionAt(mobile, 0);
  const at0Again = presencePositionAt(mobile, 0);
  const at5 = presencePositionAt(mobile, 5);
  assert.deepEqual(at0, at0Again, 'a roamer position must be deterministic for an epoch');
  assert.notDeepEqual(at0, at5, 'a mobile roamer must actually move between epochs');
  assert.equal(galaxyHash(galaxy), GALAXY_HASH, 'reading a roamer position must not change the structure hash');

  const anchored = galaxy.presence.find((s) => !s.mobile);
  if (anchored) {
    assert.deepEqual(presencePositionAt(anchored, 0), presencePositionAt(anchored, 99),
      'an anchored roamer must not drift');
  }
}

// ---------------------------------------------------------------------------
// 3. Every world is buildable
// ---------------------------------------------------------------------------
// The bar map-check holds the authored campaign to, applied to all 50+
// generated worlds: real ground, three spread city sites on land, every hive
// placed and reachable from the ground you would found on.
const buildStats = [];
for (const world of frontier) {
  const level = levelById(world.levelId);
  const label = `${world.name} (${world.kind}, level ${world.levelId})`;
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const N = map.size;

  assert.ok(TERRAIN_SHAPES[map.terrainKind], `${label} has no landform archetype`);
  assert.equal(map.terrainKind, level.theme.terrain, `${label} did not build its own landform`);

  let walkable = 0;
  for (const t of map.tiles) if (TILE_INFO[t].walk) walkable++;
  const walkFrac = walkable / (N * N);
  assert.ok(walkFrac > 0.5, `${label} is only ${(walkFrac * 100) | 0}% walkable — no room to manoeuvre`);

  assert.equal(map.sites.length, 3, `${label} must offer three city sites`);
  for (const s of map.sites) {
    assert.ok(map.isWalkable(Math.round(s.x), Math.round(s.z)), `${label} site ${s.name} is not on land`);
    assert.ok(s.name && s.hint, `${label} has an unnamed city site`);
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(map.sites[i].x - map.sites[j].x, map.sites[i].z - map.sites[j].z);
      assert.ok(d > N * 0.2, `${label} sites ${i} and ${j} are ${d | 0} apart — too close to be a choice`);
    }
  }

  assert.equal(map.nestSpots.length, level.nests, `${label} did not place every hive`);
  const reach = flood(map, Math.round(map.sites[0].x), Math.round(map.sites[0].z));
  for (const [x, z] of map.nestSpots) {
    assert.ok(reach[z * N + x], `${label}: a hive is unreachable from ${map.sites[0].name} — unwinnable`);
  }
  assert.ok(map.nodeSpots.length >= 6, `${label} has too few lane nodes to fight over`);

  buildStats.push({ world, walkFrac, nodes: map.nodeSpots.length });
}
assert.equal(buildStats.length, frontier.length, 'every frontier world must be validated, not sampled');

// ---------------------------------------------------------------------------
// 4. Every world descriptor is a walkable planet
// ---------------------------------------------------------------------------
// Descriptors go through the real overworld stitcher. A gate you cannot reach
// on foot is a world you cannot leave.
const descriptorSamples = [
  frontier[0],
  frontier.find((w) => w.kind === 'holdout'),
  frontier.find((w) => w.kind === 'derelict'),
  frontier[Math.floor(frontier.length / 2)],
  frontier.at(-1),
].filter(Boolean);

for (const world of descriptorSamples) {
  const label = `${world.name} (${world.kind})`;
  const descriptor = descriptorForWorld(world, world.levelId);
  for (const key of ['id', 'name', 'seed', 'size', 'spawn', 'regions']) {
    assert.ok(descriptor[key] != null, `${label} descriptor is missing "${key}"`);
  }
  assert.equal(descriptor.id, world.id, `${label} descriptor must keep the world id`);
  assert.equal(descriptor.kind, world.kind, `${label} descriptor must carry its world kind`);
  assert.equal(descriptor.mode, worldMissionMode(world), `${label} descriptor must carry its mission mode`);
  assert.ok(descriptor.regions.some((r) => r.kind === 'portal'), `${label} has no Orbital Lift — you could never leave`);
  assert.ok(descriptor.regions.some((r) => r.kind === 'level' && r.levelId === world.levelId),
    `${label} has no warzone`);
  const shelf = descriptor.regions[0], mission = descriptor.regions[1];
  assert.notEqual(shelf.terrain, mission.terrain, `${label} reads as one biome — the landing shelf must differ`);
  assert.notDeepEqual(shelf.palette, mission.palette, `${label} landing shelf must vary the palette`);
  if (world.kind === 'derelict') {
    const hulk = descriptor.regions.find((r) => r.kind === 'labyrinth');
    assert.ok(hulk, `${label} is a derelict with nothing to explore`);
    assert.equal(hulk.trials.length, LABYRINTH_LEVELS.length, `${label} hulk must lead to the trials`);
    assert.ok(hulk.radius > 8 && hulk.center, `${label} hulk must own real ground`);
  } else {
    assert.ok(!descriptor.regions.some((r) => r.kind === 'labyrinth'), `${label} is not a derelict but grew a hulk`);
  }

  const field = new OverworldField(descriptor);
  const twinField = new OverworldField(descriptor);
  assert.deepEqual([...field.tiles], [...twinField.tiles], `${label} planet must be seed-stable`);
  assert.equal(field.size, descriptor.size, `${label} planet is not the size it claims`);

  const layout = overworldLayout(descriptor);
  const reachable = overworldReachable(field);
  assert.ok(reachable.size > field.size * 4, `${label} is a corridor, not a planet`);
  const stops = [...layout.gates, layout.cave].filter(Boolean);
  for (const gate of stops) {
    assert.ok(field.isWalkable(gate.x, gate.z), `${label}: ${gate.name} does not stand on walkable ground`);
    assert.ok(reachable.has(gate.z * field.size + gate.x), `${label}: ${gate.name} is unreachable from the spawn`);
  }
  assert.ok(field.isWalkable(descriptor.spawn.x, descriptor.spawn.z), `${label} spawns you inside terrain`);
}

// Unknown ids fall back to Earth rather than stranding anyone.
assert.equal(descriptorForWorldId(galaxy, 'earth', 0).id, 'earth', 'Earth must resolve to the authored campaign planet');
assert.equal(descriptorForWorldId(galaxy, null, 0).id, 'earth', 'a missing world id falls back to Earth');
assert.equal(descriptorForWorldId(galaxy, 'frontier-999999', 0).id, 'earth', 'an unknown world id falls back to Earth');
assert.equal(descriptorForWorldId(galaxy, frontier[0].id, 99).id, frontier[0].id, 'a known world id resolves its own planet');

// ---------------------------------------------------------------------------
// 5. The simulation accepts a generated world
// ---------------------------------------------------------------------------
// One world per kind, played for real: found a city, run the clock, and check
// the hives muster. This is the seam where a galaxy world stops being data.
const simSamples = ['standard', 'holdout', 'derelict'].map((kind) => frontier.find((w) => w.kind === kind));
const scores = [];
for (const world of simSamples) {
  const level = levelById(world.levelId);
  const label = `${world.name} (${world.kind})`;
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const game = new Game(map, 'normal', 'alexander', null, world.levelId, worldMissionMode(world));
  game.foundCity(0, 0);
  assert.equal(game.level.id, world.levelId, `${label}: the sim looked up a different level`);
  assert.equal(game.level.mult, world.mult, `${label}: the sim disagrees about difficulty`);
  assert.ok(game.laneGraph && game.laneGraph.size > 0, `${label} built no lane graph`);
  assert.ok(game.nests.every((n) => n.alive), `${label} shipped an unreachable hive`);
  assert.ok(game.activeNodes().length >= 6, `${label} has too few reachable nodes`);
  for (let i = 0; i < 20 * 30; i++) game.update(1 / 30);
  assert.ok(game.zombies.length > 0, `${label}: the hives never mustered`);

  // Scoring is read-only: taking a score must not perturb the simulation.
  const before = game.snapshot();
  const score = runScore(game);
  assert.deepEqual(game.snapshot(), before, `${label}: scoring a run changed the simulation`);
  assert.ok(score.score >= 0, `${label}: a run scored negative`);
  assert.equal(score.levelId, world.levelId, `${label}: the score names the wrong world`);
  assert.equal(score.worldKind, world.kind, `${label}: the score forgot what kind of world it was`);
  assert.equal(score.mult, world.mult, `${label}: the score forgot how hard the world was`);
  scores.push({ world, score });
}

// A catastrophic loss still scores, and still scores at zero or better.
{
  const ruin = runScore({
    stats: { kills: 0, coins: 0, nests: 0, nodes: 0, built: 0, lost: 500, bestHeld: 0, heroDeaths: 9, bossKillT: null },
    won: false, mode: 'campaign', levelId: frontier[0].levelId, level: levelById(frontier[0].levelId), threatLevel: 1,
  });
  assert.equal(ruin.score, 0, 'a total defeat must floor at zero, never go negative');
  const empty = runScore({});
  assert.equal(empty.score, 0, 'scoring nothing must not throw or go negative');
}

// ---------------------------------------------------------------------------
// 6. The meta tree is well formed
// ---------------------------------------------------------------------------
assert.equal(META_NODES.length, 12, 'the meta tree ships twelve nodes');
assert.equal(Object.keys(META_BRANCHES).length, 3, 'the meta tree ships three branches');
{
  const seen = new Set();
  for (const node of META_NODES) {
    assert.ok(!seen.has(node.id), `duplicate meta node id ${node.id}`);
    seen.add(node.id);
    assert.ok(META_BRANCHES[node.branch], `${node.id} belongs to no branch`);
    assert.ok(node.name && node.desc, `${node.id} has no player-facing copy`);
    assert.ok(Number.isInteger(node.cost) && node.cost > 0, `${node.id} must cost a positive whole number`);
    assert.ok(Array.isArray(node.requires), `${node.id} has no prerequisite list`);
    // Effects are DATA. A payload that carried behaviour could change the sim.
    const groups = Object.entries(node.effect || {});
    assert.ok(groups.length > 0, `${node.id} does nothing`);
    for (const [group, payload] of groups) {
      assert.ok(['economy', 'hero', 'unlock'].includes(group), `${node.id} uses unknown effect group "${group}"`);
      for (const [key, value] of Object.entries(payload)) {
        assert.equal(typeof value, 'number', `${node.id}.${group}.${key} is not a number — effects must be data`);
        assert.ok(Number.isFinite(value) && value > 0, `${node.id}.${group}.${key} must be a positive number`);
      }
    }
  }
  for (const branch of Object.keys(META_BRANCHES)) {
    const nodes = META_NODES.filter((n) => n.branch === branch);
    assert.equal(nodes.length, 4, `branch ${branch} must hold four nodes`);
    assert.ok(nodes.some((n) => n.requires.length === 0), `branch ${branch} has no entry node`);
  }
  // No orphaned prerequisites, and no cycles: every node must be reachable by
  // buying its way up from an entry node.
  for (const node of META_NODES) {
    for (const req of node.requires) {
      assert.ok(META_NODES_BY_ID.has(req), `${node.id} requires "${req}", which is not a node`);
      assert.equal(META_NODES_BY_ID.get(req).branch, node.branch, `${node.id} reaches across branches for "${req}"`);
      assert.ok(META_NODES_BY_ID.get(req).cost < node.cost, `${node.id} costs no more than its own prerequisite`);
    }
  }
  const resolved = new Set();
  for (let pass = 0; pass < META_NODES.length + 1 && resolved.size < META_NODES.length; pass++) {
    for (const node of META_NODES) {
      if (resolved.has(node.id)) continue;
      if (node.requires.every((r) => resolved.has(r))) resolved.add(node.id);
    }
  }
  assert.equal(resolved.size, META_NODES.length, 'the meta tree has a prerequisite cycle — some nodes can never be bought');
}

// ---------------------------------------------------------------------------
// 7. Award and spend math cannot go negative
// ---------------------------------------------------------------------------
setMetaBackend(memoryBackend(null));
{
  const fresh = loadMeta({ force: true });
  assert.equal(fresh.currency, 0, 'a new profile starts with nothing');
  assert.deepEqual(fresh.nodes, {}, 'a new profile owns no nodes');
  assert.deepEqual(bonusesFor(fresh).economy, { startGold: 0, income: 0 }, 'a new profile has no bonuses');

  // Hostile score results: nothing here may mint or destroy currency.
  const hostile = [
    { score: -100000, won: true, levelId: 6 },
    { score: NaN, won: true, levelId: 6 },
    { score: Infinity, won: true, levelId: 6 },
    { score: '900000000000', won: true, levelId: 6 },
    {}, null, undefined,
  ];
  for (const bad of hostile) {
    const before = loadMeta().currency;
    const result = awardRun(bad || {});
    assert.ok(result.earned >= 0, `an award paid out ${result.earned}`);
    assert.ok(loadMeta().currency >= before, 'an award must never reduce the balance');
    assert.ok(Number.isFinite(loadMeta().currency), 'the balance must stay a real number');
  }
  resetMeta();
}

{
  // A real run pays out, and the payout follows the published rate.
  const sample = scores[0].score;
  const award = awardRun({ ...sample, score: 5000, won: true, cleared: true });
  assert.equal(award.earned, Math.round(5000 * META_EARN_RATE), 'the payout must follow the published rate');
  assert.equal(loadMeta().currency, award.earned, 'the payout must land in the balance');
  assert.equal(loadMeta().lifetime.runs, 1, 'a run must be counted');
  assert.equal(loadMeta().records.worldsCleared, 1, 'a cleared world must be recorded');
  assert.ok(loadMeta().records.highestThreat >= 2.2, 'the highest threat cleared must be recorded');
  assert.equal(loadMeta().records.highestTier, threatTierFor(sample.mult), 'the threat band cleared must be recorded');

  // Clearing the same world twice does not double-count it.
  awardRun({ ...sample, score: 5000, won: true, cleared: true });
  assert.equal(loadMeta().records.worldsCleared, 1, 'a re-run must not re-count a world');
  assert.equal(loadMeta().lifetime.runs, 2, 'a re-run is still a run');

  // A labyrinth trial is never a world.
  awardRun({ score: 1000, won: true, levelId: LABYRINTH_LEVELS[0].id, worldKind: 'labyrinth', mult: 1 });
  assert.equal(loadMeta().records.worldsCleared, 1, 'a labyrinth trial must never count as a world cleared');
  resetMeta();
}

{
  // Spending: refusals are total. Nothing is deducted, nothing is granted.
  awardRun({ score: 10000, won: true, levelId: 6, mult: 2.22 });
  const funded = loadMeta().currency;
  assert.ok(funded >= 200, 'the test needs a funded profile');

  for (const [nodeId, reason] of [['not_a_node', 'unknown'], ['supply_depot', 'locked'], ['warband_focus', 'locked']]) {
    const before = loadMeta().currency;
    const result = spend(nodeId);
    assert.equal(result.ok, false, `${nodeId} should not have been purchasable`);
    assert.equal(result.reason, reason, `${nodeId} was refused for the wrong reason`);
    assert.equal(loadMeta().currency, before, `a refused purchase of ${nodeId} still charged the player`);
    assert.ok(!loadMeta().nodes[nodeId], `a refused purchase of ${nodeId} still granted the node`);
  }

  const bought = spend('supply_cache');
  assert.equal(bought.ok, true, 'an affordable, unlocked node must be purchasable');
  assert.equal(loadMeta().currency, funded - META_NODES_BY_ID.get('supply_cache').cost, 'a purchase must charge exactly its cost');
  assert.equal(loadMeta().lifetime.spent, META_NODES_BY_ID.get('supply_cache').cost, 'spending must be recorded');
  assert.equal(spend('supply_cache').reason, 'owned', 'a node cannot be bought twice');
  assert.equal(metaBonuses().economy.startGold, 25, 'an owned node must pay its effect');
  assert.equal(nodeState(loadMeta(), 'supply_cache'), 'owned', 'an owned node must read as owned');
  assert.equal(nodeState(loadMeta(), 'warband_focus'), 'locked', 'a gated node must read as locked');

  // Drain the balance and try to overspend: refused, and never negative.
  let guard = 0;
  while (loadMeta().currency > 0 && guard++ < 200) {
    const affordable = META_NODES.find((n) => nodeState(loadMeta(), n.id) === 'available');
    if (!affordable) break;
    spend(affordable.id);
  }
  const broke = loadMeta();
  assert.ok(broke.currency >= 0, `overspending drove the balance to ${broke.currency}`);
  for (const node of META_NODES) {
    if (broke.nodes[node.id]) continue;
    const result = spend(node.id);
    assert.equal(result.ok, false, `${node.id} was bought with an empty balance`);
    assert.ok(['poor', 'locked', 'owned'].includes(result.reason), `${node.id} refused for an odd reason`);
  }
  assert.ok(loadMeta().currency >= 0, 'a failed spending spree must leave a non-negative balance');
  assert.equal(loadMeta().lifetime.spent + loadMeta().currency, loadMeta().lifetime.earned,
    'earned must always equal spent plus held — currency is neither minted nor lost');
  resetMeta();
}

{
  // The whole tree is reachable, and the payload adds up to exactly the sum of
  // what was bought.
  let meta = emptyMeta();
  meta.currency = META_NODES.reduce((sum, n) => sum + n.cost, 0);
  for (let pass = 0; pass < META_NODES.length; pass++) {
    for (const node of META_NODES) {
      const result = applySpend(meta, node.id);
      if (result.ok) meta = result.meta;
    }
  }
  assert.equal(Object.keys(meta.nodes).length, META_NODES.length, 'the full tree must be purchasable');
  assert.equal(meta.currency, 0, 'buying every node must spend exactly the tree total');
  const full = bonusesFor(meta);
  assert.equal(full.economy.startGold, 100, 'the supply branch must total +100 starting gold');
  assert.ok(Math.abs(full.economy.income - 0.14) < 1e-9, 'the supply branch must total +14% income');
  assert.equal(full.hero.hp, 40, 'the warband branch must total +40 hero HP');
  assert.ok(Math.abs(full.hero.dmg - 0.1) < 1e-9, 'the warband branch must total +10% hero damage');
  assert.equal(full.unlock.saveSlots, 1, 'the command branch must grant a save slot');
  assert.equal(full.unlock.galaxyDepth, 3, 'the command branch must total three systems of chart depth');
  assert.equal(full.nodes.length, META_NODES.length, 'the payload must name every owned node');

  // A hand-edited profile cannot smuggle in a node it never earned the way to.
  const forged = normalizeMeta({ currency: -50, nodes: { warband_focus: 1, command_harness: 1, ghost_node: 1 } });
  assert.equal(forged.currency, 0, 'a negative balance normalises to zero');
  assert.deepEqual(forged.nodes, {}, 'nodes with missing prerequisites must be dropped, not honoured');
  assert.deepEqual(bonusesFor(forged), bonusesFor(emptyMeta()), 'a forged profile must pay out nothing');

  const view = metaTreeView(meta);
  assert.equal(view.branches.length, 3, 'the tree view must show every branch');
  assert.equal(view.branches.reduce((n, b) => n + b.nodes.length, 0), META_NODES.length, 'the tree view must show every node');
  assert.ok(view.branches.every((b) => b.nodes.every((n) => n.owned)), 'a fully bought tree must read as owned');
}

// Storage round-trips through the backend, which is the seam a server takes.
{
  const backend = memoryBackend(null);
  setMetaBackend(backend);
  awardRun({ score: 30000, won: true, levelId: 7, mult: 2.44 }, { now: 1234 });
  spend('warband_vigor');
  const persisted = backend.read();
  assert.ok(persisted && persisted.nodes.warband_vigor, 'purchases must reach the backend');
  assert.equal(persisted.v, 1, 'persisted state must carry its version');
  setMetaBackend(memoryBackend(persisted));
  assert.equal(loadMeta({ force: true }).nodes.warband_vigor, 1, 'a reloaded profile must keep what it bought');
  assert.equal(metaBonuses().hero.hp, 40, 'a reloaded profile must keep its bonuses');
}
setMetaBackend(memoryBackend(null));
loadMeta({ force: true });

if (REPORT) {
  console.log(`\ngalaxy ${galaxy.hash} — ${galaxy.systems.length} systems, ${frontier.length} frontier worlds`);
  for (const system of galaxy.systems.slice(0, 10)) {
    console.log(`  ${system.name.padEnd(20)} r=${system.polar.r.toFixed(2)} arm ${system.arm} T${system.threatTier}`
      + `  ${system.worlds.map((w) => `${w.name} [${w.kind}] x${w.mult.toFixed(2)}`).join(' · ')}`);
  }
  console.log(`  kinds: ${Object.entries(kindCounts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const holders = {}, roamers = {};
  for (const w of galaxy.worlds) holders[w.faction.short] = (holders[w.faction.short] || 0) + 1;
  for (const p of galaxy.presence) roamers[`${p.faction.short} ${p.kind}`] = (roamers[`${p.faction.short} ${p.kind}`] || 0) + 1;
  console.log(`  holders: ${Object.entries(holders).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  roamers: ${Object.entries(roamers).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('\nfactions:');
  for (const f of FACTIONS) {
    console.log(`  ${f.icon} ${f.name.padEnd(20)} ${f.origin.padEnd(5)} ${FACTION_PRESENCE[f.presence].label.padEnd(14)}`
      + `${f.war.hostile ? 'hostile' : 'not hostile'}`);
  }
  console.log(`  walkable: ${(buildStats.reduce((s, b) => s + b.walkFrac, 0) / buildStats.length * 100).toFixed(1)}% average`);
  console.log('\nmeta tree:');
  for (const branch of metaTreeView(emptyMeta()).branches) {
    console.log(`  ${branch.name}: ${branch.nodes.map((n) => `${n.name} (${n.cost})`).join(' → ')}`);
  }
}

console.log(`galaxy check passed: ${galaxy.systems.length} systems, ${frontier.length} worlds built and walked, `
  + `${FACTIONS.length} authored factions (+procedural) over ${galaxy.presence.length} roaming sites, `
  + `${META_NODES.length} meta nodes across ${Object.keys(META_BRANCHES).length} branches, award/spend math held`);
