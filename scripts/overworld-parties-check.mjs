// The overworld used to contain nothing but terrain, gates and the player:
// no faction traffic routed between settlements, so a planet at war looked
// abandoned. This check walks whole planets headless and asserts the traffic
// is deterministic, stays on walkable ground, and actually completes trips.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OverworldField, earthWorldDescriptor, OVERWORLD_SEED } from '../src/overworld.js';
import {
  spawnOverworldParties, updateOverworldParties, buildOverworldRoads, overworldSettlements,
  findOverworldPath, destinationsFrom, roadKey, partiesNear, describeParty, settlementHolder,
  chooseDestination, PARTY_ARCHETYPES, MAX_OVERWORLD_PARTIES,
} from '../src/overworld-parties.js';

const map = new OverworldField(earthWorldDescriptor(0));
const walkable = (x, z) => map.isWalkable(x, z);
const settlements = overworldSettlements(map.overworldLayout);

assert.ok(settlements.length >= 2, 'a planet needs at least two settlements to have traffic');
for (const s of settlements) {
  assert.ok(walkable(Math.floor(s.x), Math.floor(s.z)), `${s.name} must stand on walkable ground`);
}

// ---- roads -----------------------------------------------------------------
const roads = buildOverworldRoads(settlements, walkable, map.size);
assert.ok(roads.size > 0, 'settlements must be connected by walkable roads');

for (const [key, path] of roads) {
  assert.ok(path.length >= 2, `road ${key} must have a start and an end`);
  for (const node of path) {
    assert.ok(
      walkable(Math.floor(node.x), Math.floor(node.z)),
      `road ${key} leaves walkable ground at ${node.x},${node.z} — parties would wade across water`,
    );
  }
  // Straight legs must also stay on land, not just their endpoints.
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = Math.floor(a.x + (b.x - a.x) * t), z = Math.floor(a.z + (b.z - a.z) * t);
      assert.ok(walkable(x, z), `road ${key} cuts across impassable ground between waypoints`);
    }
  }
}

// Roads are symmetric: if you can march there you can march back.
for (const key of roads.keys()) {
  const [from, to] = key.split('>');
  assert.ok(roads.has(roadKey(to, from)), `road ${key} must be walkable in both directions`);
}

// A destination inside solid rock has no road rather than a fake one.
assert.equal(findOverworldPath(() => false, 8, { x: 0, z: 0 }, { x: 7, z: 7 }), null,
  'an unreachable destination must yield no road, never a straight line through terrain');

// ---- determinism -----------------------------------------------------------
const runA = spawnOverworldParties(OVERWORLD_SEED, map.overworldLayout, walkable, map.size);
const runB = spawnOverworldParties(OVERWORLD_SEED, map.overworldLayout, walkable, map.size);
assert.ok(runA.parties.length >= 2, 'a planet at war must put parties on its roads');
assert.ok(runA.parties.length <= MAX_OVERWORLD_PARTIES, 'traffic must stay bounded');
assert.deepEqual(
  runA.parties.map((p) => [p.id, p.factionKey, p.kind, p.strength, p.toId]),
  runB.parties.map((p) => [p.id, p.factionKey, p.kind, p.strength, p.toId]),
  'two players on the same planet must see the same traffic',
);

// Simulated forward, the two runs must stay identical — no Math.random anywhere.
const stepAll = (state, seconds, dt = 1 / 30) => {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    events.push(...updateOverworldParties(state.parties, dt, state));
  }
  return events;
};
const eventsA = stepAll(runA, 240);
const eventsB = stepAll(runB, 240);
assert.deepEqual(
  runA.parties.map((p) => [p.id, p.x.toFixed(6), p.z.toFixed(6), p.trips, p.atId]),
  runB.parties.map((p) => [p.id, p.x.toFixed(6), p.z.toFixed(6), p.trips, p.atId]),
  'four minutes of traffic must replay identically',
);
assert.equal(eventsA.length, eventsB.length, 'the same trips must be taken in the same order');

// ---- the traffic must actually go somewhere --------------------------------
const arrivals = eventsA.filter((e) => e.t === 'arrive');
const departures = eventsA.filter((e) => e.t === 'depart');
assert.ok(departures.length > 0, 'parties must leave their settlements');
assert.ok(arrivals.length > 0, 'parties must complete trips between settlements, not wander');
for (const event of arrivals) {
  assert.ok(settlements.some((s) => s.id === event.at), 'an arrival must land on a real settlement');
}
assert.ok(runA.parties.some((p) => p.trips > 0), 'at least one party must have moved on');

// Nothing may drift off the map or onto water while travelling.
for (const party of runA.parties) {
  assert.ok(
    walkable(Math.floor(party.x), Math.floor(party.z)),
    `${party.name} is standing on impassable ground at ${party.x},${party.z}`,
  );
  assert.ok(Number.isFinite(party.x) && Number.isFinite(party.z), 'party position must stay finite');
}

// ---- who is on the road ----------------------------------------------------
// A front the player has not taken flies a hostile banner, so the roads around
// unfinished fronts carry enemies rather than friendly patrols.
const contested = settlements.find((s) => !s.cleared);
if (contested) {
  assert.equal(settlementHolder(contested).war.hostile, true,
    'a front still held against the player must be held by a hostile faction');
}
// Holder assignment is stable — a settlement does not change hands per call.
for (const s of settlements) {
  assert.equal(settlementHolder(s).key, settlementHolder(s).key, 'holders must be stable');
}
// Hostile-only archetypes never fly a friendly banner.
for (const party of runA.parties) {
  const archetype = PARTY_ARCHETYPES[party.kind];
  assert.ok(archetype, `${party.kind} must be a known archetype`);
  if (archetype.hostileOnly) assert.equal(party.hostile, true, `${archetype.label} must be hostile`);
}

// A destination is reachable and is not a pointless immediate turnaround.
for (const party of runA.parties) {
  const anchor = party.atId || party.fromId;
  const options = destinationsFrom(roads, settlements, anchor);
  if (options.length <= 1) continue;
  const next = chooseDestination({ ...party, atId: anchor }, roads, settlements);
  assert.ok(next && next.id !== anchor, 'a party must choose a real onward destination');
}

// ---- what the player reads -------------------------------------------------
const near = partiesNear(runA.parties, runA.parties[0].x, runA.parties[0].z, 6);
assert.ok(near.includes(runA.parties[0]), 'a party must be found near its own position');
assert.deepEqual(near, partiesNear(runA.parties, runA.parties[0].x, runA.parties[0].z, 6),
  'proximity order must be stable');
const line = describeParty(runA.parties[0], settlements);
assert.match(line, /\d+ strong/, 'a party must read its strength to the player');
assert.ok(!/undefined|NaN|\[object/.test(line), `party description must be clean: ${line}`);

// ---- the renderer must actually draw them ----------------------------------
// The whole point of the module is that traffic reaches the walkable world,
// not just a 2D overlay. Assert main.js builds and ticks party meshes.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(main.includes("from './overworld-parties.js'"), 'main.js must consume overworld traffic');
assert.ok(main.includes('_makeOverworldParty'), 'the renderer must build party meshes');
assert.ok(main.includes('updateOverworldParties'), 'the renderer must advance traffic every frame');
assert.ok(/_disposeObject3D\(mesh\)/.test(main), 'party meshes must be disposed with the world');

// Determinism guard: this module must never reach for the global RNG. Strip
// comments first — the rule is stated in prose at the top of the module.
const src = readFileSync(new URL('../src/overworld-parties.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/Math\.random\s*\(/.test(src), 'overworld traffic must stay off Math.random');
assert.ok(!/from 'three'/.test(src), 'the data half must not import three.js');

console.log(`overworld parties check passed: ${runA.parties.length} parties, ${roads.size / 2} roads, `
  + `${departures.length} departures / ${arrivals.length} arrivals over 4 minutes`);
