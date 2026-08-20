import assert from 'node:assert/strict';
import { firstHourStep, equipmentPreview, missionRewardSummary } from '../src/first-hour.js';
import { LEVELS } from '../src/config.js';
import { rollItemKey } from '../src/items.js';

const base = { classKey: 'vanguard', level: 1, items: [], equipment: {}, stats: {} };
const weapon = rollItemKey('scatter_mk1', 7, 1, 1);
assert.equal(firstHourStep(null), 'create');
assert.equal(firstHourStep(base), 'market');
assert.equal(firstHourStep({ ...base, items: [weapon] }), 'equip');
assert.equal(firstHourStep({ ...base, equipment: { weapon } }), 'forge');
assert.equal(firstHourStep({ ...base, equipment: { weapon }, craftingMaterials: { alloy_shard: 1 } }), 'mission');
assert.equal(firstHourStep({ ...base, stats: { victories: 1 } }), 'complete');
assert.equal(firstHourStep({ ...base, firstHourGuideDismissed: true }), 'complete');
assert.ok(equipmentPreview(base, weapon).target);
assert.match(missionRewardSummary(LEVELS[0]), /First Blood/);
console.log('first-hour checks passed');
