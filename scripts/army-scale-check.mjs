import assert from 'node:assert/strict';
import { combatBuckets, nearbyBuckets } from '../src/game.js';
import { PLOT_KINDS, THREAT, hiveInterval, hiveSquad } from '../src/config.js';

// A broad-phase lookup around one fight must stay local even when the world
// contains thousands of actors. This guards against restoring all-vs-all
// target scans to the uncapped simulation.
const actors = Array.from({ length: 6000 }, (_, id) => ({
  id, x: (id % 120) + 0.5, z: ((id / 120) | 0) + 0.5, dead: false,
}));
const buckets = combatBuckets(actors);
const nearby = nearbyBuckets(buckets, actors, 60, 25, 10);
assert.ok(nearby.length > 0, 'spatial combat lookup found nobody');
assert.ok(nearby.length < actors.length / 4,
  `spatial combat lookup scanned too much of the army (${nearby.length}/${actors.length})`);

// One living hive is intentionally stronger than one human producer. Humans
// catch up by capturing ground and raising several camps; razing the hive is
// the only permanent way to stop its flood.
const humanPeak = Math.max(...Object.values(PLOT_KINDS).flatMap((kind) =>
  kind.unit ? kind.tiers.filter((tier) => tier.count && tier.every)
    .map((tier) => tier.count / tier.every) : []));
for (const threat of [0, 6, 12, THREAT.max]) {
  const hiveRate = hiveSquad(threat, 1).size / hiveInterval(threat);
  assert.ok(hiveRate >= humanPeak * 1.5,
    `Threat ${threat} hive rate ${hiveRate.toFixed(2)}/s is not faster than human peak ${humanPeak.toFixed(2)}/s`);
}

console.log(`army-scale ok: ${actors.length} actors bucketed; opening hive ${
  (hiveSquad(0, 1).size / hiveInterval(0)).toFixed(2)}/s vs human ${humanPeak.toFixed(2)}/s`);
