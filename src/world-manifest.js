import { makeRNG } from './utils.js';

export const WORLD_MANIFEST_SCHEMA = 'zillions.world-manifest.v1';
export const EARTH_MANIFEST_SEED = 5150;
export const EARTH_GENERATOR_VERSION = 1;

const BIOMES = ['temperate', 'forest', 'wetland', 'highland', 'desert', 'tundra'];
const SETTLEMENT_KINDS = ['town', 'fort', 'village'];
const EARTH_TERRITORIES = [
  ['alaska-frontier','Alaska Frontier','north-america',10,17,'tundra'], ['pacific-reach','Pacific Reach','north-america',17,31,'forest'],
  ['rocky-crown','Rocky Crown','north-america',22,27,'highland'], ['northern-shield','Northern Shield','north-america',28,20,'tundra'],
  ['great-plains','Great Plains','north-america',27,32,'temperate'], ['atlantic-ward','Atlantic Ward','north-america',34,30,'forest'],
  ['sunward-coast','Sunward Coast','north-america',21,41,'desert'], ['gulf-marches','Gulf Marches','north-america',29,42,'wetland'],
  ['greenfall-isthmus','Greenfall Isthmus','north-america',26,50,'forest'],
  ['orinoco-reach','Orinoco Reach','south-america',31,57,'wetland'], ['amazon-basin','Amazon Basin','south-america',35,65,'forest'],
  ['andean-spine','Andean Spine','south-america',29,69,'highland'], ['southern-crown','Southern Crown','south-america',34,84,'tundra'],
  ['silver-coast','Silver Coast','south-america',39,76,'temperate'], ['eastern-brazil','Eastern Brazil','south-america',42,66,'forest'],
  ['ironwood-isles','Ironwood Isles','europe',47,23,'temperate'], ['iberian-march','Iberian March','europe',48,33,'desert'],
  ['western-union','Western Union','europe',52,27,'temperate'], ['northern-fjords','Northern Fjords','europe',54,17,'tundra'],
  ['central-bastion','Central Bastion','europe',57,27,'forest'], ['balkan-gate','Balkan Gate','europe',59,34,'highland'],
  ['eastern-expanse','Eastern Expanse','europe',63,25,'temperate'],
  ['maghreb-front','Maghreb Front','africa',51,42,'desert'], ['nile-corridor','Nile Corridor','africa',58,48,'desert'],
  ['sahel-belt','Sahel Belt','africa',51,53,'desert'], ['guinean-coast','Guinean Coast','africa',48,60,'wetland'],
  ['congo-heart','Congo Heart','africa',56,65,'forest'], ['rift-highlands','Rift Highlands','africa',61,61,'highland'],
  ['southern-cape','Southern Cape','africa',57,82,'temperate'],
  ['ural-gate','Ural Gate','asia',67,25,'highland'], ['siberian-vast','Siberian Vast','asia',76,18,'tundra'],
  ['steppe-sea','Steppe Sea','asia',70,34,'temperate'], ['levant-crossing','Levant Crossing','asia',63,43,'desert'],
  ['indus-crown','Indus Crown','asia',69,49,'highland'], ['monsoon-reach','Monsoon Reach','asia',72,59,'wetland'],
  ['jade-heartland','Jade Heartland','asia',80,44,'temperate'], ['eastern-rim','Eastern Rim','asia',88,36,'forest'],
  ['southern-archipelago','Southern Archipelago','asia',84,65,'forest'],
  ['western-austral','Western Austral','oceania',82,78,'desert'], ['eastern-austral','Eastern Austral','oceania',90,78,'temperate'],
  ['coral-approach','Coral Approach','oceania',91,67,'wetland'], ['aotearoa-outpost','Aotearoa Outpost','oceania',96,88,'temperate'],
];
const EARTH_SEA_LANES = [
  ['alaska-frontier','siberian-vast'], ['atlantic-ward','ironwood-isles'], ['greenfall-isthmus','orinoco-reach'],
  ['eastern-brazil','guinean-coast'], ['iberian-march','maghreb-front'], ['balkan-gate','levant-crossing'],
  ['eastern-rim','coral-approach'], ['southern-archipelago','western-austral'],
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

function connectGroup(regions, planetId, routeKind = 'land') {
  const connected = new Set([0]), remaining = new Set(regions.slice(1).map((_, index) => index + 1)), routes = [];
  while (remaining.size) {
    let best = null;
    for (const from of connected) for (const to of remaining) {
      const distance = Math.hypot(regions[from].center.x - regions[to].center.x, regions[from].center.y - regions[to].center.y);
      if (!best || distance < best.distance || (distance === best.distance && `${from}:${to}` < `${best.from}:${best.to}`)) best = { from, to, distance };
    }
    const a = regions[best.from], b = regions[best.to];
    routes.push({ id: stableId(planetId, `route:${a.key}:${b.key}`), key: `${a.key}-${b.key}`, originRegionId: a.id, destinationRegionId: b.id, kind: routeKind, distance: Number(best.distance.toFixed(3)) });
    connected.add(best.to); remaining.delete(best.to);
  }
  return routes;
}

function connectRegions(regions, planetId) {
  const landmasses = [...new Set(regions.map((region) => region.landmass).filter(Boolean))];
  if (!landmasses.length) return connectGroup(regions, planetId);
  const routes = landmasses.flatMap((landmass) => connectGroup(regions.filter((region) => region.landmass === landmass), planetId));
  const byKey = new Map(regions.map((region) => [region.key, region]));
  for (const [fromKey, toKey] of EARTH_SEA_LANES) {
    const a = byKey.get(fromKey), b = byKey.get(toKey);
    routes.push({ id: stableId(planetId, `route:${a.key}:${b.key}`), key: `${a.key}-${b.key}`, originRegionId: a.id, destinationRegionId: b.id, kind: 'sea', distance: Number(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y).toFixed(3)) });
  }
  return routes;
}

export function generatePlanetManifest({ planetId = 'earth', name = 'Earth', seed = EARTH_MANIFEST_SEED, generatorVersion = EARTH_GENERATOR_VERSION, regionCount } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(generatorVersion) || generatorVersion < 1) throw new Error('invalid_manifest_identity');
  const earthLike = planetId === 'earth';
  regionCount ??= earthLike ? EARTH_TERRITORIES.length : 24;
  if (!Number.isInteger(regionCount) || regionCount < 3 || regionCount > 256) throw new Error('invalid_region_count');
  const rng = makeRNG((seed ^ Math.imul(generatorVersion, 0x9e3779b1)) >>> 0);
  const regions = earthLike && regionCount === EARTH_TERRITORIES.length ? EARTH_TERRITORIES.map(([key, territoryName, landmass, x, y, biome]) => ({
    id: stableId(planetId, key), key, name: territoryName, landmass, center: { x, y }, biome, resourceBias: Number(rng().toFixed(4)),
  })) : Array.from({ length: regionCount }, (_, index) => {
    const key = `region-${String(index + 1).padStart(3, '0')}`;
    return { id: stableId(planetId, key), key, name: `Province ${index + 1}`, center: { x: Number((5 + rng() * 90).toFixed(3)), y: Number((5 + rng() * 90).toFixed(3)) }, biome: BIOMES[Math.floor(rng() * BIOMES.length)], resourceBias: Number(rng().toFixed(4)) };
  });
  const settlements = regions.flatMap((region, regionIndex) => Array.from({ length: 2 + (regionIndex % 2) }, (_, slot) => {
    const key = `${region.key}-settlement-${slot + 1}`;
    return { id: stableId(planetId, key), key, regionId: region.id, name: `${region.name} ${slot === 0 ? 'Crossing' : slot === 1 ? 'Hold' : 'Village'}`, kind: SETTLEMENT_KINDS[slot], position: { x: Number(Math.max(0, Math.min(100, region.center.x + (rng() - .5) * 8)).toFixed(3)), y: Number(Math.max(0, Math.min(100, region.center.y + (rng() - .5) * 8)).toFixed(3)) } };
  }));
  const manifest = { schema: WORLD_MANIFEST_SCHEMA, planetId, name, seed, generatorVersion, projection: earthLike ? 'earth-equirectangular-v1' : 'procedural-plane-v1', size: { width: 100, height: 100 }, regions, settlements, routes: connectRegions(regions, planetId) };
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
