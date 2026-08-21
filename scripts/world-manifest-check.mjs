import assert from 'node:assert/strict';
import { earthManifest, generatePlanetManifest, manifestHash, validatePlanetManifest } from '../src/world-manifest.js';

const earth = earthManifest();
assert.deepEqual(earthManifest(), earth, 'the same seed and generator version must replay byte-for-byte');
assert.equal(earth.projection, 'earth-equirectangular-v1');
assert.equal(earth.landmasses.length, 6);
assert.equal(earth.regions.length, 72);
assert.equal(earth.settlements.length, 304);
assert.equal(earth.routes.length, 74);
assert.equal(earth.routes.filter((route) => route.kind === 'sea').length, 8);
assert.match(earth.contentHash, /^zillions-fingerprint-v1-[0-9a-f]{16}$/);
assert.notEqual(generatePlanetManifest({ seed: 5151 }).contentHash, earth.contentHash);
assert.notEqual(generatePlanetManifest({ generatorVersion: 2 }).contentHash, earth.contentHash);
const mars = generatePlanetManifest({ planetId: 'mars', name: 'Mars' });
assert.deepEqual(generatePlanetManifest({ planetId: 'mars', name: 'Mars' }), mars, 'non-Earth planets must replay byte-for-byte');
assert.equal(mars.projection, 'procedural-plane-v1');
assert.equal(mars.landmasses.length, 1);
assert.ok(mars.regions.every((region) => region.polygon?.length >= 3));
assert.ok(mars.routes.every((route) => route.kind === 'land' && route.path.length === 3));
assert.equal(manifestHash(earth), earth.contentHash);
const drifted = structuredClone(earth); drifted.regions[0].center.x += 1;
assert.throws(() => validatePlanetManifest(drifted), /manifest_hash_mismatch/);
const disconnected = structuredClone(earth); disconnected.routes = disconnected.routes.filter((route) => !route.key.includes('oceania-06')); disconnected.contentHash = manifestHash(disconnected);
assert.throws(() => validatePlanetManifest(disconnected), /disconnected_route_graph/);
for (const region of earth.regions) assert.ok(region.polygon.length >= 3, `${region.key} needs canonical province geometry`);
for (const route of earth.routes) assert.ok(route.path.length >= 2, `${route.key} needs canonical navigation geometry`);
for (const route of earth.routes.filter((entry) => entry.kind === 'sea')) assert.ok(route.originPortId && route.destinationPortId, `${route.key} needs canonical ports`);
const escaped = structuredClone(earth); escaped.settlements[0].position = { x: -1, y: -1 }; escaped.contentHash = manifestHash(escaped);
assert.throws(() => validatePlanetManifest(escaped), /settlement_outside_province/);
const badRoute = structuredClone(earth); badRoute.routes[0].path = []; badRoute.contentHash = manifestHash(badRoute);
assert.throws(() => validatePlanetManifest(badRoute), /invalid_route_geometry/);
const offWorld = structuredClone(earth); offWorld.landmasses[0].polygon[0] = [-5, -5]; offWorld.contentHash = manifestHash(offWorld);
assert.throws(() => validatePlanetManifest(offWorld), /invalid_landmass_geometry/);
const badProvince = structuredClone(earth); badProvince.regions[0].center = { x: 99, y: 99 }; badProvince.contentHash = manifestHash(badProvince);
assert.throws(() => validatePlanetManifest(badProvince), /invalid_province_geometry/);
const coverageGap = structuredClone(earth); coverageGap.regions[0].polygon = coverageGap.regions[0].polygon.map(([x, y]) => [(x + coverageGap.regions[0].center.x) / 2, (y + coverageGap.regions[0].center.y) / 2]); coverageGap.contentHash = manifestHash(coverageGap);
assert.throws(() => validatePlanetManifest(coverageGap), /invalid_province_coverage/);
const landRoute = structuredClone(earth); const firstLand = landRoute.routes.find((route) => route.kind === 'land'); firstLand.path[1] = [99, 99]; landRoute.contentHash = manifestHash(landRoute);
assert.throws(() => validatePlanetManifest(landRoute), /invalid_land_route/);
const forgedPort = structuredClone(earth); const firstSea = forgedPort.routes.find((route) => route.kind === 'sea'); firstSea.originPortId = forgedPort.settlements.find((entry) => entry.kind === 'town').id; forgedPort.contentHash = manifestHash(forgedPort);
assert.throws(() => validatePlanetManifest(forgedPort), /invalid_sea_ports/);
const inlandPort = structuredClone(earth); const inlandSea = inlandPort.routes.find((route) => route.kind === 'sea'); const inland = inlandPort.settlements.find((entry) => entry.id === inlandSea.originPortId); inland.position = { ...inlandPort.regions.find((entry) => entry.id === inland.regionId).center }; inlandSea.path[0] = [inland.position.x, inland.position.y]; inlandPort.contentHash = manifestHash(inlandPort);
assert.throws(() => validatePlanetManifest(inlandPort), /invalid_sea_ports/);
const overlapping = structuredClone(earth); const sameLandmass = overlapping.regions.filter((entry) => entry.landmass === overlapping.regions[0].landmass); sameLandmass[1].polygon = structuredClone(sameLandmass[0].polygon); sameLandmass[1].center = structuredClone(sameLandmass[0].center); overlapping.contentHash = manifestHash(overlapping);
assert.throws(() => validatePlanetManifest(overlapping), /overlapping_provinces/);
for (const field of [['planetId', ''], ['name', ''], ['seed', -1], ['generatorVersion', 0], ['projection', 'mercator-mystery']]) { const invalid = structuredClone(earth); invalid[field[0]] = field[1]; invalid.contentHash = manifestHash(invalid); assert.throws(() => validatePlanetManifest(invalid), /invalid_manifest_identity/); }
const bowTie = structuredClone(earth); bowTie.landmasses[0].polygon = [[5,5],[30,30],[5,30],[30,5],[35,15]]; bowTie.contentHash = manifestHash(bowTie);
assert.throws(() => validatePlanetManifest(bowTie), /invalid_landmass_geometry/);
for (const polygon of [
  [[5,5],[30,5],[30,30],[5,30],[30,5]],
  [[5,5],[30,5],[30,30],[18,5],[5,30]],
  [[5,5],[30,5],[30,30],[10,30],[25,30],[5,20]],
]) { const malformed = structuredClone(earth); malformed.landmasses[0].polygon = polygon; malformed.contentHash = manifestHash(malformed); assert.throws(() => validatePlanetManifest(malformed), /invalid_landmass_geometry/); }
const remapped = structuredClone(earth); const oldRegionId = remapped.regions[0].id; remapped.regions[0].id = '00000000-0000-4000-a000-000000000000'; for (const settlement of remapped.settlements) if (settlement.regionId === oldRegionId) settlement.regionId = remapped.regions[0].id; for (const route of remapped.routes) { if (route.originRegionId === oldRegionId) route.originRegionId = remapped.regions[0].id; if (route.destinationRegionId === oldRegionId) route.destinationRegionId = remapped.regions[0].id; } remapped.contentHash = manifestHash(remapped);
assert.throws(() => validatePlanetManifest(remapped), /invalid_stable_id/);
const malformedId = structuredClone(earth); malformedId.settlements[0].id = 'not-a-uuid'; malformedId.contentHash = manifestHash(malformedId);
assert.throws(() => validatePlanetManifest(malformedId), /invalid_stable_id/);
for(const mutate of [value=>{value.materialization.regions[0].ownerFactionId='rotmire_host';},value=>{value.materialization.routes[0].originId=value.materialization.locations.at(-1).id;},value=>{value.materialization.markets[0].basePrice=999;},value=>{value.materialization.startingLocationId=value.materialization.locations.at(-1).id;}]){const invalid=structuredClone(earth);mutate(invalid);invalid.contentHash=manifestHash(invalid);assert.throws(()=>validatePlanetManifest(invalid),/invalid_materialization_template/);}
console.log(`World manifest checks passed (${earth.contentHash})`);
