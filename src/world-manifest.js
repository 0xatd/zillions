import { makeRNG } from './utils.js';

export const WORLD_MANIFEST_SCHEMA = 'zillions.world-manifest.v1';
export const EARTH_MANIFEST_SEED = 5150;
export const EARTH_GENERATOR_VERSION = 1;

const BIOMES = ['temperate', 'forest', 'wetland', 'highland', 'desert', 'tundra'];
const SETTLEMENT_KINDS = ['town', 'fort', 'village'];
const HASH_PREFIX = 'zillions-fingerprint-v1';
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

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  for (const point of sorted.toReversed()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return [...lower, ...upper];
}

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
  return `${HASH_PREFIX}-${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

function clipHalfPlane(polygon, a, b, c) {
  const inside = ([x, y]) => a * x + b * y <= c + 1e-9;
  const intersection = (start, end) => {
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const denominator = a * dx + b * dy;
    const t = Math.abs(denominator) < 1e-12 ? 0 : (c - a * start[0] - b * start[1]) / denominator;
    return [start[0] + dx * t, start[1] + dy * t];
  };
  const output = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index], previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (inside(current)) {
      if (!inside(previous)) output.push(intersection(previous, current));
      output.push(current);
    } else if (inside(previous)) output.push(intersection(previous, current));
  }
  return output;
}

function provinceCells(regions, landmassPolygon) {
  return regions.map((region) => {
    let polygon = landmassPolygon.map((point) => [...point]);
    for (const other of regions) {
      if (other === region) continue;
      const a = 2 * (other.center.x - region.center.x);
      const b = 2 * (other.center.y - region.center.y);
      const c = other.center.x ** 2 + other.center.y ** 2 - region.center.x ** 2 - region.center.y ** 2;
      polygon = clipHalfPlane(polygon, a, b, c);
    }
    if (polygon.length < 3) throw new Error('empty_province_geometry');
    return polygon.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
  });
}

const samePoint = (a, b, tolerance = 1e-3) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
const pointOnSegment = (point, a, b, tolerance = 2e-2) => {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > tolerance) return false;
  return point[0] >= Math.min(a[0], b[0]) - tolerance && point[0] <= Math.max(a[0], b[0]) + tolerance && point[1] >= Math.min(a[1], b[1]) - tolerance && point[1] <= Math.max(a[1], b[1]) + tolerance;
};
const pointInOrOnPolygon = (point, polygon) => pointInPolygon(point[0], point[1], polygon) || polygon.some((end, index) => pointOnSegment(point, polygon[(index + polygon.length - 1) % polygon.length], end));
const polygonArea = (polygon) => Math.abs(polygon.reduce((sum, point, index) => { const next = polygon[(index + 1) % polygon.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
const strictPointInPolygon = (point, polygon) => pointInPolygon(point[0], point[1], polygon) && !polygon.some((end, index) => pointOnSegment(point, polygon[(index + polygon.length - 1) % polygon.length], end));
const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const properIntersection = (a, b, c, d) => orientation(a, b, c) * orientation(a, b, d) < -1e-8 && orientation(c, d, a) * orientation(c, d, b) < -1e-8;
const segmentsIntersect = (a, b, c, d) => properIntersection(a, b, c, d) || pointOnSegment(a, c, d, 1e-7) || pointOnSegment(b, c, d, 1e-7) || pointOnSegment(c, a, b, 1e-7) || pointOnSegment(d, a, b, 1e-7);

function validSimplePolygon(polygon) {
  if (polygon.length < 3 || polygonArea(polygon) <= 1e-6) return false;
  if (new Set(polygon.map(([x, y]) => `${x}:${y}`)).size !== polygon.length) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length], current = polygon[index], next = polygon[(index + 1) % polygon.length];
    if (samePoint(previous, current, 1e-6) || Math.abs(orientation(previous, current, next)) <= 1e-7) return false;
    for (let other = index + 1; other < polygon.length; other += 1) {
      if (other === index || other === index + 1 || (index === 0 && other === polygon.length - 1)) continue;
      const otherNext = polygon[(other + 1) % polygon.length];
      if (segmentsIntersect(current, next, polygon[other], otherNext)) return false;
    }
  }
  return true;
}

function polygonsOverlap(a, b) {
  if (a.some((point) => strictPointInPolygon(point, b)) || b.some((point) => strictPointInPolygon(point, a))) return true;
  const centroid = (polygon) => [polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length, polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length];
  if (strictPointInPolygon(centroid(a), b) || strictPointInPolygon(centroid(b), a)) return true;
  for (let left = 0; left < a.length; left += 1) for (let right = 0; right < b.length; right += 1) if (properIntersection(a[left], a[(left + 1) % a.length], b[right], b[(right + 1) % b.length])) return true;
  return false;
}

function sharedBoundary(a, b) {
  const shared = [];
  for (const point of a) if (b.some((other, index) => pointOnSegment(point, b[(index + b.length - 1) % b.length], other))) shared.push(point);
  for (const point of b) if (a.some((other, index) => pointOnSegment(point, a[(index + a.length - 1) % a.length], other)) && !shared.some((entry) => samePoint(entry, point))) shared.push(point);
  if (shared.length < 2) return null;
  let pair = null;
  for (const left of shared) for (const right of shared) {
    const distance = Math.hypot(left[0] - right[0], left[1] - right[1]);
    if (!pair || distance > pair.distance) pair = { left, right, distance };
  }
  if (!pair || pair.distance <= 1e-3) return null;
  return [Number(((pair.left[0] + pair.right[0]) / 2).toFixed(4)), Number(((pair.left[1] + pair.right[1]) / 2).toFixed(4))];
}

function connectGroup(regions, planetId, kind = 'land') {
  const connected = new Set([0]), remaining = new Set(regions.slice(1).map((_, index) => index + 1)), routes = [];
  while (remaining.size) {
    let best = null;
    for (const from of connected) for (const to of remaining) {
      const crossing = regions[from].polygon && regions[to].polygon ? sharedBoundary(regions[from].polygon, regions[to].polygon) : null;
      if (regions[from].polygon && !crossing) continue;
      const distance = Math.hypot(regions[from].center.x - regions[to].center.x, regions[from].center.y - regions[to].center.y);
      if (!best || distance < best.distance || (distance === best.distance && `${from}:${to}` < `${best.from}:${best.to}`)) best = { from, to, distance, crossing };
    }
    if (!best) throw new Error('disconnected_province_adjacency');
    const a = regions[best.from], b = regions[best.to];
    const path = [[a.center.x, a.center.y], ...(best.crossing ? [best.crossing] : []), [b.center.x, b.center.y]];
    const key = `${a.key}-${b.key}`;
    routes.push({ id: stableId(planetId, `route:${key}`), key, originRegionId: a.id, destinationRegionId: b.id, kind, distance: Number(best.distance.toFixed(3)), path });
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
    if (!from.length || !to.length) continue;
    let best = null;
    for (const a of from) for (const b of to) {
      const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      if (!best || distance < best.distance) best = { a, b, distance };
    }
    const key = `${best.a.key}-${best.b.key}`;
    routes.push({ id: stableId(planetId, `route:${key}`), key, originRegionId: best.a.id, destinationRegionId: best.b.id, kind: 'sea', distance: Number(best.distance.toFixed(3)), path: [[best.a.center.x, best.a.center.y], [best.b.center.x, best.b.center.y]] });
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

function coastalAnchor(region, landmass, target) {
  const candidates = [];
  for (const point of region.polygon) for (let index = 0; index < landmass.polygon.length; index += 1) {
    const end = landmass.polygon[index], start = landmass.polygon[(index + landmass.polygon.length - 1) % landmass.polygon.length];
    if (pointOnSegment(point, start, end)) candidates.push(point);
  }
  if (!candidates.length) throw new Error('sea_route_region_has_no_coast');
  return candidates.sort((a, b) => Math.hypot(a[0] - target.x, a[1] - target.y) - Math.hypot(b[0] - target.x, b[1] - target.y))[0];
}

function generateEarthRegions(planetId, rng) {
  const regions = [];
  for (const landmass of EARTH_LANDMASSES) {
    const landPolygon = convexHull(landmass.polygon);
    const xs = landPolygon.map(([x]) => x), ys = landPolygon.map(([, y]) => y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let slot = 0; slot < landmass.count; slot += 1) {
      let x, y, attempts = 0;
      do { x = minX + rng() * (maxX - minX); y = minY + rng() * (maxY - minY); attempts += 1; }
      while (!pointInPolygon(x, y, landPolygon) && attempts < 1000);
      if (attempts >= 1000) throw new Error('earth_landmass_sampling_failed');
      const key = `${landmass.key}-${String(slot + 1).padStart(2, '0')}`;
      const climate = y < 20 ? 'tundra' : y > 72 ? 'temperate' : y > 56 ? 'wetland' : BIOMES[Math.floor(rng() * (BIOMES.length - 1))];
      regions.push({ id: stableId(planetId, key), key, name: `${landmass.name} Province ${slot + 1}`, landmass: landmass.key, center: { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }, biome: climate, resourceBias: Number(rng().toFixed(4)) });
    }
  }
  for (const landmass of EARTH_LANDMASSES) {
    const group = regions.filter((region) => region.landmass === landmass.key);
    const cells = provinceCells(group, convexHull(landmass.polygon));
    group.forEach((region, index) => { region.polygon = cells[index]; });
  }
  return regions;
}

function sampleInsidePolygon(polygon, center, rng) {
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const x = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + rng() * (Math.max(...ys) - Math.min(...ys));
    if (pointInPolygon(x, y, polygon)) return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
  }
  return { ...center };
}

export function generatePlanetManifest({ planetId = 'earth', name = 'Earth', seed = EARTH_MANIFEST_SEED, generatorVersion = EARTH_GENERATOR_VERSION, regionCount } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(generatorVersion) || generatorVersion < 1) throw new Error('invalid_manifest_identity');
  const earthLike = planetId === 'earth';
  regionCount ??= earthLike ? EARTH_LANDMASSES.reduce((sum, landmass) => sum + landmass.count, 0) : 24;
  if (!Number.isInteger(regionCount) || regionCount < 3 || regionCount > 256) throw new Error('invalid_region_count');
  const rng = makeRNG((seed ^ Math.imul(generatorVersion, 0x9e3779b1)) >>> 0);
  const proceduralSurface = { key: 'surface', name: 'Surface', polygon: [[0,0],[100,0],[100,100],[0,100]] };
  const regions = earthLike && regionCount === 72 ? generateEarthRegions(planetId, rng) : Array.from({ length: regionCount }, (_, index) => {
    const key = `region-${String(index + 1).padStart(3, '0')}`;
    return { id: stableId(planetId, key), key, name: `Province ${index + 1}`, landmass: proceduralSurface.key, center: { x: Number((5 + rng() * 90).toFixed(3)), y: Number((5 + rng() * 90).toFixed(3)) }, biome: BIOMES[Math.floor(rng() * BIOMES.length)], resourceBias: Number(rng().toFixed(4)) };
  });
  if (!earthLike) {
    const cells = provinceCells(regions, proceduralSurface.polygon);
    regions.forEach((region, index) => { region.polygon = cells[index]; });
  }
  const settlements = regions.flatMap((region, regionIndex) => Array.from({ length: earthLike ? 3 + (regionIndex % 3) : 2 + (regionIndex % 2) }, (_, slot) => {
    const key = `${region.key}-settlement-${slot + 1}`;
    return { id: stableId(planetId, key), key, regionId: region.id, name: `${region.name} ${slot === 0 ? 'Crossing' : slot === 1 ? 'Hold' : 'Village'}`, kind: SETTLEMENT_KINDS[slot % SETTLEMENT_KINDS.length], position: region.polygon ? sampleInsidePolygon(region.polygon, region.center, rng) : { x: Number(Math.max(0, Math.min(100, region.center.x + (rng() - .5) * 4)).toFixed(3)), y: Number(Math.max(0, Math.min(100, region.center.y + (rng() - .5) * 4)).toFixed(3)) } };
  }));
  const routes = connectRegions(regions, planetId);
  for (const route of routes.filter((entry) => entry.kind === 'sea')) {
    const originRegion = regions.find((entry) => entry.id === route.originRegionId);
    const destinationRegion = regions.find((entry) => entry.id === route.destinationRegionId);
    for (const [side, regionId] of [['origin', route.originRegionId], ['destination', route.destinationRegionId]]) {
      const region = regions.find((entry) => entry.id === regionId);
      const other = side === 'origin' ? destinationRegion : originRegion;
      const sourceLandmass = EARTH_LANDMASSES.find((entry) => entry.key === region.landmass);
      const landmass = { ...sourceLandmass, polygon: convexHull(sourceLandmass.polygon) };
      const anchor = coastalAnchor(region, landmass, other.center);
      const position = { x: Number((anchor[0] + (region.center.x - anchor[0]) * 0.001).toFixed(4)), y: Number((anchor[1] + (region.center.y - anchor[1]) * 0.001).toFixed(4)) };
      const key = `${region.key}-port-${route.key}`;
      const port = { id: stableId(planetId, key), key, regionId, name: `${region.name} Port`, kind: 'port', position, coastAnchor: anchor };
      settlements.push(port); route[`${side}PortId`] = port.id;
    }
    const origin = settlements.find((entry) => entry.id === route.originPortId);
    const destination = settlements.find((entry) => entry.id === route.destinationPortId);
    route.path = [[origin.position.x, origin.position.y], [destination.position.x, destination.position.y]];
  }
  const landmasses = earthLike ? EARTH_LANDMASSES.map(({ key, name: landmassName, polygon }) => ({ key, name: landmassName, polygon: convexHull(polygon) })) : [proceduralSurface];
  const manifest = { schema: WORLD_MANIFEST_SCHEMA, planetId, name, seed, generatorVersion, projection: earthLike ? 'earth-equirectangular-v1' : 'procedural-plane-v1', size: { width: 100, height: 100 }, landmasses, regions, settlements, routes };
  manifest.contentHash = manifestHash(manifest);
  return validatePlanetManifest(manifest);
}

export function validatePlanetManifest(manifest) {
  if (!manifest || manifest.schema !== WORLD_MANIFEST_SCHEMA) throw new Error('invalid_manifest_schema');
  if (typeof manifest.planetId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.planetId) || typeof manifest.name !== 'string' || manifest.name.trim().length < 1 || manifest.name.length > 128 || !Number.isInteger(manifest.seed) || manifest.seed < 0 || !Number.isInteger(manifest.generatorVersion) || manifest.generatorVersion < 1 || !['earth-equirectangular-v1', 'procedural-plane-v1'].includes(manifest.projection) || (manifest.planetId === 'earth') !== (manifest.projection === 'earth-equirectangular-v1')) throw new Error('invalid_manifest_identity');
  if (manifest.contentHash !== manifestHash(manifest)) throw new Error('manifest_hash_mismatch');
  const ids = [...manifest.regions, ...manifest.settlements, ...manifest.routes].map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate_stable_id');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const entry of manifest.regions) if (!uuid.test(entry.id) || entry.id !== stableId(manifest.planetId, entry.key)) throw new Error('invalid_stable_id');
  for (const entry of manifest.settlements) if (!uuid.test(entry.id) || entry.id !== stableId(manifest.planetId, entry.key)) throw new Error('invalid_stable_id');
  for (const entry of manifest.routes) if (!uuid.test(entry.id) || entry.id !== stableId(manifest.planetId, `route:${entry.key}`)) throw new Error('invalid_stable_id');
  const regionIds = new Set(manifest.regions.map((region) => region.id));
  const settlementsById = new Map(manifest.settlements.map((settlement) => [settlement.id, settlement]));
  const keys = [...manifest.landmasses, ...manifest.regions, ...manifest.settlements, ...manifest.routes].map((entry) => entry.key);
  if (keys.some((key) => typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(key)) || new Set(keys).size !== keys.length) throw new Error('invalid_or_duplicate_manifest_key');
  if (!manifest.regions.length || !manifest.settlements.length || !manifest.routes.length) throw new Error('empty_manifest_topology');
  if (manifest.settlements.some((settlement) => !regionIds.has(settlement.regionId))) throw new Error('orphan_settlement');
  const finitePoint = (point) => Array.isArray(point) ? point.length === 2 && point.every(Number.isFinite) : point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const inBounds = (point) => { const [x, y] = Array.isArray(point) ? point : [point.x, point.y]; return x >= 0 && y >= 0 && x <= manifest.size.width && y <= manifest.size.height; };
  if (!manifest.size || !Number.isFinite(manifest.size.width) || !Number.isFinite(manifest.size.height) || manifest.size.width <= 0 || manifest.size.height <= 0) throw new Error('invalid_manifest_size');
  if (manifest.landmasses.some((landmass) => !Array.isArray(landmass.polygon) || landmass.polygon.some((point) => !finitePoint(point) || !inBounds(point)) || !validSimplePolygon(landmass.polygon))) throw new Error('invalid_landmass_geometry');
  const landmassByKey = new Map(manifest.landmasses.map((entry) => [entry.key, entry]));
  for (const region of manifest.regions) if (!finitePoint(region.center) || !inBounds(region.center) || (manifest.landmasses.length && (!landmassByKey.has(region.landmass) || !Array.isArray(region.polygon) || region.polygon.some((point) => !finitePoint(point) || !inBounds(point) || !pointInOrOnPolygon(point, landmassByKey.get(region.landmass).polygon)) || !validSimplePolygon(region.polygon) || !pointInOrOnPolygon([region.center.x, region.center.y], region.polygon)))) throw new Error(`invalid_province_geometry:${region.key}`);
  for (const landmass of manifest.landmasses) {
    const landRegions = manifest.regions.filter((region) => region.landmass === landmass.key);
    for (let left = 0; left < landRegions.length; left += 1) for (let right = left + 1; right < landRegions.length; right += 1) if (polygonsOverlap(landRegions[left].polygon, landRegions[right].polygon)) throw new Error('overlapping_provinces');
    const regionArea = landRegions.reduce((sum, region) => sum + polygonArea(region.polygon), 0);
    if (Math.abs(regionArea - polygonArea(landmass.polygon)) > 0.05) throw new Error('invalid_province_coverage');
  }
  if (manifest.settlements.some((settlement) => !finitePoint(settlement.position))) throw new Error('invalid_settlement_position');
  for (const settlement of manifest.settlements) {
    const region = manifest.regions.find((entry) => entry.id === settlement.regionId);
    if (region.polygon && !pointInPolygon(settlement.position.x, settlement.position.y, region.polygon)) throw new Error('settlement_outside_province');
  }
  for (const route of manifest.routes) {
    const origin = manifest.regions.find((entry) => entry.id === route.originRegionId), destination = manifest.regions.find((entry) => entry.id === route.destinationRegionId);
    if (!origin || !destination || origin.id === destination.id || !['land', 'sea'].includes(route.kind) || !Number.isFinite(route.distance) || route.distance <= 0 || !Array.isArray(route.path) || route.path.length < 2 || route.path.some((point) => !finitePoint(point) || !inBounds(point))) throw new Error('invalid_route_geometry');
    if (route.kind === 'land') {
      if (origin.landmass !== destination.landmass || !sharedBoundary(origin.polygon, destination.polygon) || !samePoint(route.path[0], [origin.center.x, origin.center.y]) || !samePoint(route.path.at(-1), [destination.center.x, destination.center.y]) || route.path.some((point) => !pointInOrOnPolygon(point, origin.polygon) && !pointInOrOnPolygon(point, destination.polygon))) throw new Error('invalid_land_route');
    } else {
      const originPort = settlementsById.get(route.originPortId), destinationPort = settlementsById.get(route.destinationPortId);
      const validPort = (port, region) => {
        if (port?.kind !== 'port' || port.regionId !== region.id || !finitePoint(port.coastAnchor)) return false;
        const landmass = landmassByKey.get(region.landmass);
        const onLandCoast = landmass?.polygon.some((end, index, polygon) => pointOnSegment(port.coastAnchor, polygon[(index + polygon.length - 1) % polygon.length], end));
        const onProvinceCoast = region.polygon.some((end, index, polygon) => pointOnSegment(port.coastAnchor, polygon[(index + polygon.length - 1) % polygon.length], end));
        const expected = [port.coastAnchor[0] + (region.center.x - port.coastAnchor[0]) * 0.001, port.coastAnchor[1] + (region.center.y - port.coastAnchor[1]) * 0.001];
        return onLandCoast && onProvinceCoast && samePoint([port.position.x, port.position.y], expected, 2e-3);
      };
      if (!validPort(originPort, origin) || !validPort(destinationPort, destination) || originPort.id === destinationPort.id || !samePoint(route.path[0], [originPort.position.x, originPort.position.y]) || !samePoint(route.path.at(-1), [destinationPort.position.x, destinationPort.position.y])) throw new Error('invalid_sea_ports');
    }
  }
  const reached = new Set([manifest.regions[0].id]); let changed = true;
  while (changed) { changed = false; for (const route of manifest.routes) if (reached.has(route.originRegionId) !== reached.has(route.destinationRegionId)) { reached.add(route.originRegionId); reached.add(route.destinationRegionId); changed = true; } }
  if (reached.size !== manifest.regions.length) throw new Error('disconnected_route_graph');
  return manifest;
}

export function earthManifest() { return generatePlanetManifest(); }
