import assert from 'node:assert/strict';
import { filterProjection } from '../api/living-world.js';
import { livingWorldProjectionToUi } from '../src/living-world-client.js';

const actor = 'actor-1';
const snapshot = {
  shard: { id: 'earth-1', name: 'Earth', simulation_tick: 44, revision: 3 },
  planet: { id: 'earth', name: 'Earth' },
  factions: [
    { id: 'free', name: 'Greenfall Freeholds', kind: 'state' },
    { id: 'host', name: 'Rotmire Host', kind: 'hostile' },
    { id: 'secret', name: 'Hidden faction', kind: 'state' },
  ],
  regions: [
    { id: 'greenfall', name: 'Greenfall', owner_faction_id: 'free', control_state: 'controlled', control_strength: .91 },
    { id: 'rotmire', name: 'Rotmire', owner_faction_id: 'host', control_state: 'contested', control_strength: .54 },
    { id: 'hidden-region', name: 'Hidden', owner_faction_id: 'secret', control_state: 'controlled', control_strength: 1 },
  ],
  locations: [
    { id: 'home', province_id: 'greenfall', name: 'Greenfall Crossing', kind: 'town', owner_faction_id: 'free', position: { x: 20, y: 50 }, services: { fastTravel: true } },
    { id: 'border', province_id: 'rotmire', name: 'Rotmire Gate', kind: 'gate', owner_faction_id: 'host', control_state: 'contested', position: { x: 75, y: 40 }, services: { fastTravel: true } },
    { id: 'hidden-town', province_id: 'hidden-region', name: 'Secret', kind: 'town', owner_faction_id: 'secret', position: { x: 90, y: 10 } },
  ],
  routes: [
    { id: 'cross', origin_id: 'home', destination_id: 'border', origin_region_id: 'greenfall', destination_region_id: 'rotmire', danger: .2, control_state: 'controlled', blockade_state: {} },
    { id: 'leak', origin_id: 'home', destination_id: 'hidden-town', origin_region_id: 'greenfall', destination_region_id: 'hidden-region', danger: 0, control_state: 'controlled' },
  ],
  parties: [
    { id: 'mine', region_id: 'greenfall', owner_user_id: actor, owner_faction_id: 'free', name: 'My Company', kind: 'player', location_id: 'home', stance: 'friendly', revision: 8 },
    { id: 'friend', region_id: 'rotmire', owner_user_id: 'actor-2', owner_faction_id: 'free', name: 'Friend Company', kind: 'player', location_id: 'border', stance: 'friendly', revision: 2 },
  ],
  scoutingReports: [{ observer_party_id: 'mine', location_id: 'border', observed_tick: 43, expires_tick: 50, intelligence: {} }],
  socialParty: { id: 'social', name: 'The Company', revision: 2, members: [
    { user_id: actor, role: 'leader', worldParty: null },
    { user_id: 'actor-2', role: 'member', worldParty: null },
  ] },
};
snapshot.socialParty.members[0].worldParty = snapshot.parties[0];
snapshot.socialParty.members[1].worldParty = snapshot.parties[1];

const projection = filterProjection(snapshot, actor);
assert.deepEqual(projection.regions.map((region) => region.id), ['greenfall', 'rotmire'], 'only regions supported by player knowledge are projected');
assert.deepEqual(projection.factions.map((faction) => faction.id), ['free', 'host'], 'hidden faction identity does not leak');
assert.deepEqual(projection.routes.map((route) => route.id), ['cross'], 'routes with unknown destinations do not leak');
assert.equal(projection.socialParty.members.length, 2, 'social party locations are projected to members');

const ui = livingWorldProjectionToUi(projection, { id: actor, name: 'Alex', className: 'Vanguard' });
assert.equal(ui.world.name, 'Earth');
assert.equal(ui.regions.find((region) => region.id === 'rotmire').controlState, 'contested');
assert.equal(ui.party.members.find((member) => member.id === 'actor-2').regionId, 'rotmire', 'party frame preserves authoritative member region');
const destination = ui.settlements.find((location) => location.id === 'border');
assert.equal(destination.reachable, true, 'direct authoritative route enables travel');
assert.equal(destination.crossRegion, true, 'route exposes worker handoff boundary');
assert.equal(destination.fastTravel, true, 'safe known unlocked service enables fast travel');

snapshot.routes[0].control_state = 'blocked';
const blocked = livingWorldProjectionToUi(filterProjection(snapshot, actor)).settlements.find((location) => location.id === 'border');
assert.equal(blocked.reachable, false, 'blocked route cannot authorize movement');
assert.equal(blocked.fastTravel, false, 'blocked route cannot authorize fast travel');
console.log('earth map projection check passed');
