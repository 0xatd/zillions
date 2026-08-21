import { makeRNG } from './utils.js';

export const WORLD_MANIFEST_SCHEMA = 'zillions.world-manifest.v1';
export const EARTH_MANIFEST_SEED = 5150;
export const EARTH_GENERATOR_VERSION = 1;

const BIOMES = ['temperate', 'forest', 'wetland', 'highland', 'desert', 'tundra'];
const SETTLEMENT_KINDS = ['town', 'fort', 'village'];
const EARTH_LANDMASSES = [
  { key: 'north-america', name: 'North America', count: 14, polygon: [[7,13],[20,8],[32,14],[36,25],[31,38],[27,49],[20,51],[16,41],[10,31]] },
  { key: 'south-america', name: 'South America', count: 8, polygon: [[27,51],[42,53],[44,64],[40,79],[34,93],[29,82],[27,68]] },
  { key: 'europe', name: 'Europe', count: 9, polygon: [[46,17],[61,15],[67,25],[63,37],[51,38],[45,29]] },
  { key: 'africa', name: 'Africa', count: 12, polygon: [[46,39],[63,38],[69,52],[64,73],[57,86],[49,72],[44,54]] },
  { key: 'asia', name: 'Asia', count: 23, polygon: [[62,13],[91,10],[98,25],[91,43],[83,56],[72,63],[64,48],[59,34]] },
  { key: 'oceania', name: 'Oceania', count: 6, polygon: [[78,67],[96,65],[99,88],[88,94],[77,84]] },
];
const EARTH_SEA_LANES = [
  ['north-america','asia'], ['north-america','europe'], ['north-america','south-america'], ['south-america','africa'],
  ['europe','africa'], ['europe','asia'], ['africa','asia'], ['asia','oceania'],
];

function hash32(input) {
  let value = 2166136261;
  for (const char of String(input)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function stableId(namespace, key) {
  const words = [0, 1, 2, 3].map((slot) => hash32(`${namespace}:${key}:${slot}`).toString(16).padStart(8, '0'));
  return `${words[0]}-${words[1].slice(0, 4)}-4${words[1].slice(5, 8)}-a${words[2].slice(1, 4)}-${words[2].slice(4)}${words[3]}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function manifestHash(manifest) {
  const copy = { ...manifest }; delete copy.contentHash;
  const source = canonical(copy);
  let hi = 0x811c9dc5, lo = 0x9e3779b9;
  for (let i = 0; i < source.length; i += 1) {
    hi = Math.imul(hi ^ source.charCodeAt(i), 0x01000193) >>> 0;
    lo = Math.imul(lo ^ source.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `fnv64-${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

function connectGroup(regions, planetId, kind = 'land') {
  const connected = new Set([0]), remaining = new Set(regions.slice(1).map((_, index) => index + 1)), routes = [];
  while (remaining.size) {
    let best = null;
    for (const from of connected) for (const to of remaining) {
      const distance = Math.hypot(regions[from].center.x - regions[to].center.x, regions[from].center.y - regions[to].center.y);
      if (!best || distance < best.distance || (distance === best.distance && `${from}:${to}` < `${best.from}:${best.to}`)) best = { from, to, distance };
    }
    const a = regions[best.from], b = regions[best.to];
    routes.push({ id: stableId(planetId, `route:${a.key}:${b.key}`), key: `${a.key}-${b.key}`, originRegionId: a.id, destinationRegionId: b.id, kind, distance: Number(best.distance.toFixed(3)) });
    connected.add(best.to); remaining.delete(best.to);
  }
  return routes;
}

function connectRegions(regions, planetId) {
  const landmasses = [...new Set(regions.map((region) => region.landmass).filter(Boolean))];
  if (!landmasses.length) return connectGroup(regions, planetId);
  const routes = landmasses.flatMap((landmass) => connectGroup(regions.filter((region) => region.landmass === landmass), planetId));
  for (const [fromLandmass, toLandmass] of EARTH_SEA_LANES) {
    const from = regions.filter((region) => region.landmass === fromLandmass);
    const to = regions.filter((region) => region.landmass === toLandmass);
    let best = null;
    for (const a of from) for (const b of to) {
      const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      if (!best || distance < best.distance) best = { a, b, distance };
    }
    routes.push({ id: stableId(planetId, `route:${best.a.key}:${best.b.key}`), key: `${best.a.key}-${best.b.key}`, originRegionId: best.a.id, destinationRegionId: best.b.id, kind: 'sea', distance: Number(best.distance.toFixed(3)) });
  }
  return routes;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function generateEarthRegions(planetId, rng) {
  const regions = [];
  for (const landmass of EARTH_LANDMASSES) {
    const xs = landmass.polygon.map(([x]) => x), ys = landmass.polygon.map(([, y]) => y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let slot = 0; slot < landmass.count; slot += 1) {
      let x, y, attempts = 0;
      do { x = minX + rng() * (maxX - minX); y = minY + rng() * (maxY - minY); attempts += 1; }
      while (!pointInPolygon(x, y, landmass.polygon) && attempts < 1000);
      if (attempts >= 1000) throw new Error('earth_landmass_sampling_failed');
      const key = `${landmass.key}-${String(slot + 1).padStart(2, '0')}`;
      const climate = y < 20 ? 'tundra' : y > 72 ? 'temperate' : y > 56 ? 'wetland' : BIOMES[Math.floor(rng() * (BIOMES.length - 1))];
      regions.push({ id: stableId(planetId, key), key, name: `${landmass.name} Province ${slot + 1}`, landmass: landmass.key, center: { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }, biome: climate, resourceBias: Number(rng().toFixed(4)) });
    }
  }
  return regions;
}

export function generatePlanetManifest({ planetId = 'earth', name = 'Earth', seed = EARTH_MANIFEST_SEED, generatorVersion = EARTH_GENERATOR_VERSION, regionCount } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(generatorVersion) || generatorVersion < 1) throw new Error('invalid_manifest_identity');
  const earthLike = planetId === 'earth';
  regionCount ??= earthLike ? EARTH_LANDMASSES.reduce((sum, landmass) => sum + landmass.count, 0) : 24;
  if (!Number.isInteger(regionCount) || regionCount < 3 || regionCount > 256) throw new Error('invalid_region_count');
  const rng = makeRNG((seed ^ Math.imul(generatorVersion, 0x9e3779b1)) >>> 0);
  const regions = earthLike && regionCount === 72 ? generateEarthRegions(planetId, rng) : Array.from({ length: regionCount }, (_, index) => {
    const key = `region-${String(index + 1).padStart(3, '0')}`;
    return { id: stableId(planetId, key), key, name: `Province ${index + 1}`, center: { x: Number((5 + rng() * 90).toFixed(3)), y: Number((5 + rng() * 90).toFixed(3)) }, biome: BIOMES[Math.floor(rng() * BIOMES.length)], resourceBias: Number(rng().toFixed(4)) };
  });
  const settlements = regions.flatMap((region, regionIndex) => Array.from({ length: earthLike ? 3 + (regionIndex % 3) : 2 + (regionIndex % 2) }, (_, slot) => {
    const key = `${region.key}-settlement-${slot + 1}`;
    return { id: stableId(planetId, key), key, regionId: region.id, name: `${region.name} ${slot === 0 ? 'Crossing' : slot === 1 ? 'Hold' : 'Village'}`, kind: SETTLEMENT_KINDS[slot % SETTLEMENT_KINDS.length], position: { x: Number(Math.max(0, Math.min(100, region.center.x + (rng() - .5) * 4)).toFixed(3)), y: Number(Math.max(0, Math.min(100, region.center.y + (rng() - .5) * 4)).toFixed(3)) } };
  }));
  const manifest = { schema: WORLD_MANIFEST_SCHEMA, planetId, name, seed, generatorVersion, projection: earthLike ? 'earth-equirectangular-v1' : 'procedural-plane-v1', size: { width: 100, height: 100 }, landmasses: earthLike ? EARTH_LANDMASSES.map(({ key, name: landmassName, polygon }) => ({ key, name: landmassName, polygon })) : [], regions, settlements, routes: connectRegions(regions, planetId) };
  manifest.contentHash = manifestHash(manifest);
  return validatePlanetManifest(manifest);
}

export function validatePlanetManifest(manifest) {
  if (!manifest || manifest.schema !== WORLD_MANIFEST_SCHEMA) throw new Error('invalid_manifest_schema');
  if (manifest.contentHash !== manifestHash(manifest)) throw new Error('manifest_hash_mismatch');
  const ids = [...manifest.regions, ...manifest.settlements, ...manifest.routes].map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate_stable_id');
  const regionIds = new Set(manifest.regions.map((region) => region.id));
  if (!manifest.regions.length || !manifest.settlements.length || !manifest.routes.length) throw new Error('empty_manifest_topology');
  if (manifest.settlements.some((settlement) => !regionIds.has(settlement.regionId))) throw new Error('orphan_settlement');
  if (manifest.routes.some((route) => !regionIds.has(route.originRegionId) || !regionIds.has(route.destinationRegionId))) throw new Error('orphan_route');
  const reached = new Set([manifest.regions[0].id]); let changed = true;
  while (changed) { changed = false; for (const route of manifest.routes) if (reached.has(route.originRegionId) !== reached.has(route.destinationRegionId)) { reached.add(route.originRegionId); reached.add(route.destinationRegionId); changed = true; } }
  if (reached.size !== manifest.regions.length) throw new Error('disconnected_route_graph');
  return manifest;
}

export function earthManifest() { return generatePlanetManifest(); }
