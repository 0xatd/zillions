import assert from 'node:assert/strict';
import { createLivingWorldHandler, filterProjection, loadSnapshot, parseViewport, sanitizeWorldTopology } from '../api/living-world.js';
const response = () => ({ status: 0, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); }, setHeader() {} });
const request = (method, body, authorization = 'Bearer valid', url = '/api/living-world?shardId=earth') => ({ method, url, headers: { host: 'test', authorization }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } });
const handler = createLivingWorldHandler({ config: { url: 'https://test.invalid', anonKey: 'anon', serviceKey: 'service' }, authenticate: async (auth) => auth === 'Bearer valid' ? { id: 'actor-1' } : null, rateLimit: async()=>({allowed:true}), command: async (actor, command) => ({ ok: true, actor, type: command.type }) });
let res = response(); await handler(request('GET', null, ''), res); assert.equal(res.status, 401);
const base = { type: 'issue_movement', requestId: 'req-1', shardId: 'earth', partyId: '8e604971-848f-4dc1-bfc6-8b29912d677e', expectedRevision: 1, payload: { routeId: '148da2b1-cc8a-41f5-a714-99d78d79fd9e' } };
res = response(); await handler(request('POST', { ...base, actorId: 'victim' }), res); assert.equal(res.body.error, 'actor_spoof_rejected');
res = response(); await handler(request('POST', { ...base, payload: { ...base.payload, admin: true } }), res); assert.equal(res.body.error, 'unsupported_payload_field');
res = response(); await handler(request('POST', { ...base, debug: true }), res); assert.equal(res.body.error, 'unsupported_command_field');
res = response(); await handler(request('POST', base), res); assert.equal(res.body.actor, 'actor-1');
let tradeRpcUrl='';
const tradeHandler=createLivingWorldHandler({config:{url:'https://test.invalid',anonKey:'anon',serviceKey:'service'},authenticate:async()=>({id:'actor-1'}),rateLimit:async()=>({allowed:true}),fetch:async(url)=>{tradeRpcUrl=String(url);return{ok:true,status:200,async json(){return{ok:true};}};}});
res=response();await tradeHandler(request('POST',{...base,type:'trade_market',payload:{locationId:'148da2b1-cc8a-41f5-a714-99d78d79fd9e',commodityKey:'food',side:'buy',quantity:1}}),res);
assert.equal(res.status,200);assert.match(tradeRpcUrl,/rpc\/living_world_trade_market$/,'trade must bypass the retired shard worker');
const snapshot = { shard: { simulation_tick: 10 }, parties: [{ id: 'mine', owner_user_id: 'actor-1', owner_faction_id: 'blue', location_id: 'home' }, { id: 'ally', owner_faction_id: 'blue', location_id: 'ally-town' }, { id: 'seen', owner_faction_id: 'red', location_id: 'wild', speed: 9 }, { id: 'hidden', owner_faction_id: 'red', location_id: 'secret' }], locations: [{ id: 'home', owner_faction_id: 'blue' }, { id: 'ally-town', owner_faction_id: 'blue' }, { id: 'wild', owner_faction_id: 'red' }, { id: 'secret', owner_faction_id: 'red' }], routes: [{ id: 'known', origin_id: 'home', destination_id: 'ally-town' }, { id: 'leak', origin_id: 'home', destination_id: 'secret' }], markets: [{ location_id: 'home' }, { location_id: 'secret' }], scoutingReports: [{ observer_party_id: 'mine', subject_party_id: 'seen', location_id: 'wild', observed_tick: 8, expires_tick: 12, accuracy: .7, intelligence: { estimate: 20 } }] };
const projection = filterProjection(snapshot, 'actor-1');
assert.deepEqual(projection.parties.map((p) => p.id), ['mine', 'ally', 'seen']); assert.equal(projection.parties[2].speed, undefined);
assert.deepEqual(projection.locations.map((p) => p.id), ['home', 'ally-town', 'wild']); assert.deepEqual(projection.routes.map((p) => p.id), ['known']); assert.deepEqual(projection.markets.map((p) => p.location_id), ['home']);

assert.deepEqual(parseViewport(new URLSearchParams()), { minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 0 });
assert.deepEqual(parseViewport(new URLSearchParams('zoom=3')), { minX: 0, minY: 0, maxX: 100, maxY: 100, zoom: 3 });
assert.throws(() => parseViewport(new URLSearchParams('minX=90&maxX=10&minY=0&maxY=100&zoom=1')), /invalid_viewport/);
res = response();
await handler(request('GET', null, 'Bearer valid', '/api/living-world?shardId=earth&minX=-1&minY=0&maxX=20&maxY=20&zoom=2'), res);
assert.equal(res.status, 400); assert.equal(res.body.error, 'invalid_viewport');

const manifestRow = { content_hash: 'safe-hash', manifest: { planetId: 'earth', projection: 'earth-equirectangular-v1', size: { width: 100, height: 100 }, seed: 5150, materialization: { secret: true }, landmasses: [{ key: 'earth', name: 'Earth', polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] }], regions: [{ id: 'near', key: 'near', name: 'Near', landmass: 'earth', biome: 'forest', center: { x: 10, y: 10 }, polygon: [[5, 5], [15, 5], [15, 15], [5, 15]] }, { id: 'far', key: 'far', name: 'Far', landmass: 'earth', biome: 'desert', center: { x: 90, y: 90 }, polygon: [[85, 85], [95, 85], [95, 95], [85, 95]] }] } };
const topology = sanitizeWorldTopology(manifestRow, { minX: 0, minY: 0, maxX: 25, maxY: 25, zoom: 2 });
assert.deepEqual(topology.provinces.map((row) => row.id), ['near']);
assert.equal(topology.seed, undefined); assert.equal(topology.materialization, undefined); assert.equal(topology.contentHash, 'safe-hash');

const secureSnapshot = {
  shard: { simulation_tick: 10 }, manifest: manifestRow,
  factions: [{ id: 'blue' }, { id: 'red' }], regions: [{ id: 'near', owner_faction_id: 'blue' }],
  locations: [{ id: 'home', province_id: 'near', owner_faction_id: 'blue', position: { x: 10, y: 10 } }, { id: 'enemy-camp', province_id: 'near', owner_faction_id: 'red', position: { x: 12, y: 12 } }],
  parties: [{ id: 'mine', owner_user_id: 'actor-1', owner_faction_id: 'blue', location_id: 'home' }, { id: 'ally', owner_faction_id: 'blue', location_id: 'home' }, { id: 'enemy', owner_faction_id: 'red', location_id: 'enemy-camp' }, { id: 'hidden-enemy', owner_faction_id: 'red', location_id: 'enemy-camp' }],
  armies: [{ party_id: 'mine', combat_power: 77 }, { party_id: 'ally', combat_power: 66 }, { party_id: 'enemy', combat_power: 9999 }],
  scoutingReports: [{ observer_party_id: 'mine', subject_party_id: 'enemy', location_id: 'enemy-camp', expires_tick: 20, intelligence: { estimate: 40 } }],
  sieges: [{ id: 'known-siege', region_id: 'near', location_id: 'enemy-camp', attacker_party_id: 'enemy', status: 'active', progress: .4, private: true }, { id: 'hidden-siege', region_id: 'near', location_id: 'enemy-camp', attacker_party_id: 'hidden-enemy', status: 'active' }],
  pursuits: [{ id: 'known-pursuit', pursuer_party_id: 'ally', target_party_id: 'enemy', state: 'active', result: { chaseRouteId: 'secret-route' } }, { id: 'hidden-pursuit', pursuer_party_id: 'ally', target_party_id: 'hidden-enemy', state: 'active' }],
};
const secure = filterProjection(secureSnapshot, 'actor-1', { minX: 0, minY: 0, maxX: 25, maxY: 25, zoom: 2 });
assert.equal(secure.parties.find((row) => row.id === 'ally').strength, 66);
assert.equal(secure.parties.find((row) => row.id === 'enemy').strength, undefined, 'exact hostile strength does not leak');
assert.equal(secure.parties.find((row) => row.id === 'enemy').intelligence.estimate, 40);
assert.deepEqual(secure.sieges.map((row) => row.id), ['known-siege']); assert.equal(secure.sieges[0].private, undefined);
assert.deepEqual(secure.pursuits.map((row) => row.id), ['known-pursuit']); assert.equal(secure.pursuits[0].result, undefined);

const requestedUrls = [];
const nearViewport = { minX: 0, minY: 0, maxX: 25, maxY: 25, zoom: 3 };
const mockRows = {
  world_shards: [{ id: 'earth-1', simulation_tick: 10 }],
  world_planets: [{ id: 'earth', shard_id: 'earth-1' }],
  world_factions: [{ id: 'blue', planet_id: 'earth' }],
  world_provinces: [{ id: 'near', planet_id: 'earth' }],
  world_locations: [{ id: 'home', province_id: 'near', owner_faction_id: 'blue', position: { x: 10, y: 10 } }],
  world_parties: [{ id: 'mine', region_id: 'near', owner_user_id: 'actor-1', owner_faction_id: 'blue', location_id: 'home' }],
  social_party_members: [], world_scouting_reports: [], world_routes: [], world_markets: [], world_armies: [], world_sieges: [], world_supplies: [], world_cargo: [], world_caravan_plans: [], world_raid_orders: [], world_encounters: [], world_pursuits: [], world_engagements: [],
};
const mockFetch = async (url) => {
  requestedUrls.push(String(url));
  if (String(url).includes('/rpc/living_world_projection_manifest')) return { ok: true, async json() { return manifestRow; } };
  const table = String(url).match(/\/rest\/v1\/([^?]+)/)?.[1];
  return { ok: true, async json() { return mockRows[table] || []; } };
};
const staged = await loadSnapshot({ url: 'https://mock.invalid', serviceKey: 'service' }, 'earth-1', 'actor-1', mockFetch, nearViewport);
assert.deepEqual(staged.regions.map((row) => row.id), ['near']);
assert.ok(requestedUrls.some((url) => url.includes('/world_provinces?') && url.includes('id=in.(near)')));
assert.ok(requestedUrls.some((url) => url.includes('/world_locations?') && url.includes('province_id=in.(near)')));
assert.ok(requestedUrls.some((url) => url.includes('/world_routes?') && url.includes('origin_region_id.in.(near)')));
assert.ok(requestedUrls.filter((url) => url.includes('/world_parties?')).every((url) => url.includes('owner_user_id=eq.actor-1') || url.includes('region_id=in.(near)')), 'party fetches are actor- or viewport-bounded');
assert.ok(requestedUrls.filter((url) => /world_(provinces|locations|routes)\?/.test(url)).every((url) => !url.includes('far')), 'far region is absent from staged queries');
console.log('living world API check passed');
