// Broad-phase spatial buckets and army telemetry for the simulation.
// Split out of src/game.js; game.js re-exports these for existing callers.
// Headless and three-free, like the rest of the sim.

export const COMBAT_CELL = 8;            // broad-phase bucket width for uncapped armies

// Numeric cell keys: no per-actor key string. Valid for |cell| < 32768, i.e.
// any map under ~260k world units across.
const bucketKey = (bx, bz) => (bx + 32768) * 65536 + (bz + 32768);

// Pass the previous tick's Map as `into` to reuse it and its arrays: the sim
// rebuilds buckets three times a tick, and with thousands of actors the fresh
// Maps, arrays and key strings were avoidable per-tick garbage. Emptied buckets stay
// in the Map (lookups treat them as empty), bounded by the map's cell count.
export function combatBuckets(actors, into = null) {
  const buckets = into || new Map();
  if (into) for (const bucket of into.values()) bucket.length = 0;
  for (const actor of actors) {
    if (actor.dead) continue;
    const key = bucketKey(Math.floor(actor.x / COMBAT_CELL), Math.floor(actor.z / COMBAT_CELL));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(actor); else buckets.set(key, [actor]);
  }
  return buckets;
}

export const ARMY_PEAK_SAMPLE_SECONDS = 1;
export function sampleArmyPeak(units, peak, time, nextSampleAt = 0) {
  if (time + 1e-9 < nextSampleAt) return nextSampleAt;
  const composition = {};
  for (const unit of units) {
    if (unit.hero || unit.dead) continue;
    composition[unit.key] = (composition[unit.key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(composition)) {
    peak[key] = Math.max(peak[key] || 0, count);
  }
  return (Math.floor(time / ARMY_PEAK_SAMPLE_SECONDS) + 1) * ARMY_PEAK_SAMPLE_SECONDS;
}

export function nearbyBuckets(buckets, fallback, x, z, radius) {
  if (!buckets) return fallback;
  const found = [];
  const minX = Math.floor((x - radius) / COMBAT_CELL), maxX = Math.floor((x + radius) / COMBAT_CELL);
  const minZ = Math.floor((z - radius) / COMBAT_CELL), maxZ = Math.floor((z + radius) / COMBAT_CELL);
  for (let bz = minZ; bz <= maxZ; bz++) for (let bx = minX; bx <= maxX; bx++) {
    const bucket = buckets.get(bucketKey(bx, bz));
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) found.push(bucket[i]);
  }
  return found;
}
