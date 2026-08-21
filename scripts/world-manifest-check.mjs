import assert from 'node:assert/strict';
import { earthManifest, generatePlanetManifest, manifestHash, validatePlanetManifest } from '../src/world-manifest.js';

const earth = earthManifest();
assert.deepEqual(earthManifest(), earth, 'the same seed and generator version must replay byte-for-byte');
assert.equal(earth.regions.length, 24);
assert.equal(earth.settlements.length, 60);
assert.equal(earth.routes.length, 23);
assert.equal(earth.contentHash, 'fnv64-e5473813927d8477', 'Earth topology changes require an explicit generator version and migration');
assert.notEqual(generatePlanetManifest({ seed: 5151 }).contentHash, earth.contentHash);
assert.notEqual(generatePlanetManifest({ generatorVersion: 2 }).contentHash, earth.contentHash);
assert.equal(manifestHash(earth), earth.contentHash);
const drifted = structuredClone(earth); drifted.regions[0].center.x += 1;
assert.throws(() => validatePlanetManifest(drifted), /manifest_hash_mismatch/);
const disconnected = structuredClone(earth); disconnected.routes = disconnected.routes.filter((route) => !route.key.includes('region-024')); disconnected.contentHash = manifestHash(disconnected);
assert.throws(() => validatePlanetManifest(disconnected), /disconnected_route_graph/);
console.log(`World manifest checks passed (${earth.contentHash})`);
