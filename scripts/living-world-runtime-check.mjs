import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { livingWorldProjectionToUi } from '../src/living-world-client.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
for (const hook of ['onPartyCreate', 'onPartyOpen', 'onPartyMemberLocate', 'onLivingWorldOpen',
  'onLivingWorldViewport', 'onLivingWorldFastTravel', 'onLivingWorldMission', 'onLivingWorldTrackParty']) {
  assert.match(main, new RegExp(`${hook}:`), `${hook} is not wired`);
}
assert.match(main, /setLivingWorldSession\(this\.auth\.session\)/, 'auth session must reach living-world client');
assert.match(main, /this\._refreshLivingWorld\(\)\.catch/, 'overworld entry must hydrate authority projection');
assert.match(main, /getLivingWorldProjection\([^\n]+viewport\)/, 'viewport changes must fetch a bounded authority projection');
assert.doesNotMatch(main, /onLivingWorldMission:[^\n]*startGame/, 'living-world mission must not launch arbitrary campaign content');

const projection = livingWorldProjectionToUi({
  shard: { id: 'earth', name: 'Earth', simulation_tick: 8, revision: 3 },
  ownParties: [{ id: 'p1', name: 'First Company', owner_faction_id: 'free', location_id: 'a', revision: 4, stance: 'friendly' }],
  locations: [
    { id: 'a', name: 'Greenfall', kind: 'town', position: { x: 10, y: 20 }, owner_faction_id: 'free', services: { fastTravel: true } },
    { id: 'b', name: 'Rotmire', kind: 'fort', position: { x: 50, y: 60 }, owner_faction_id: 'hive', services: { fastTravel: true } },
  ],
  routes: [{ id: 'r1', origin_id: 'a', destination_id: 'b', danger: 0.2, control_state: 'controlled', blockade_state: {} }],
  parties: [
    { id: 'p1', owner_faction_id: 'free', location_id: 'a' },
    { id: 'enemy', name: 'Warband', owner_faction_id: 'hive', route_id: 'r1', route_progress: 0.5, stance: 'hostile', intelligence: { estimate: 90 } },
  ],
}, { id: 'c1', name: 'Ted Prime', className: 'Engineer' });
assert.equal(projection.party.id, 'p1');
assert.equal(projection.party.members[0].name, 'Ted Prime');
assert.equal(projection.settlements[0].fastTravel, false, 'current location is not a travel destination');
assert.equal(projection.settlements[1].fastTravel, true, 'authority-known safe connected destination enables fast travel');
assert.deepEqual(projection.routes[0].from, [10, 20]);
assert.deepEqual([projection.parties[0].x, projection.parties[0].y], [30, 40]);
assert.equal(projection.parties[0].strength, 90);
console.log('living-world-runtime-check: auth, hydration, callbacks and honest projection wiring passed');
