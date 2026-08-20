import assert from 'node:assert/strict';
import { buildingArtState, unitArtState, unitPose } from '../src/art-state.js';

assert.equal(unitArtState({ dead: true, moving: true }, { attackT: 1 }), 'down');
assert.equal(unitArtState({ dead: false, moving: true }, { hitT: 0.1, castT: 1 }), 'hit');
assert.equal(unitArtState({ dead: false, moving: true }, { castT: 0.1, attackT: 1 }), 'cast');
assert.equal(unitArtState({ dead: false, moving: false }, { attackT: 0.1 }), 'attack');
assert.equal(unitArtState({ dead: false, moving: true }), 'run');
assert.equal(unitArtState({ dead: false, moving: false }), 'idle');
assert.ok(unitPose('run', Math.PI / 2).stride >= 0.5 && unitPose('run', Math.PI / 2).stride <= 0.56,
  'run stride must read without flailing at gameplay zoom');
assert.ok(unitPose('idle', Math.PI / 2).y <= 0.015,
  'idle motion must stay restrained');
assert.ok(unitPose('attack', 0, { pulse: 1, melee: true }).z > 0.3);
assert.ok(unitPose('hit', 0, { pulse: 1 }).z < 0);
assert.ok(unitPose('down', 0).roll > 1.4);
assert.equal(buildingArtState({ hp: 100, maxHp: 100 }, 0.2).phase, 'constructing');
assert.equal(buildingArtState({ hp: 100, maxHp: 100 }, 2).phase, 'operational');
assert.equal(buildingArtState({ hp: 50, maxHp: 100 }, 2).phase, 'damaged');
assert.equal(buildingArtState({ hp: 20, maxHp: 100 }, 2).phase, 'critical');
assert.equal(buildingArtState({ hp: 500, maxHp: 0 }, 2).health, 1);
console.log('art state check passed');
