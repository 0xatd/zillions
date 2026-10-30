import assert from 'node:assert/strict';
import {
  SHAKE_CAP, addShake, shakeAmplitude, leadDamageType, shotFeel, writeDigits,
  numberScale, isTowerShot, isArcherShot, waveCleared,
} from '../src/combat-feel.js';

assert.equal(leadDamageType(null), 'kinetic');
assert.equal(leadDamageType({ thermal: 0.8, kinetic: 0.2 }), 'thermal');
assert.equal(leadDamageType({ void: 0.9, shock: 0.1 }), 'void');
assert.equal(shotFeel('flame').pool, 'flame');
assert.equal(shotFeel('tower', 'kinetic').color, shotFeel('soldier').color);

assert.equal(addShake(0, 0.5, true), SHAKE_CAP);
assert.equal(addShake(0.1, 0.05, true), 0.1);
assert.equal(addShake(0.2, 0.9, false), 0.2);
assert.equal(addShake(0, 0.4, false), 0);
assert.equal(shakeAmplitude(1.4, true), SHAKE_CAP);
assert.equal(shakeAmplitude(0.4, false), 0);

const digits = [0, 0, 0];
assert.equal(writeDigits(7, digits), 1);
assert.equal(digits[0], 7);
assert.equal(writeDigits(26, digits), 2);
assert.equal(digits[0], 2);
assert.equal(digits[1], 6);
assert.equal(writeDigits(0, digits), 1);
assert.equal(digits[0], 1);
assert.equal(writeDigits(1400, digits), 3);
assert.equal(digits[0], 9);
assert.equal(numberScale(true) > numberScale(false), true);

assert.equal(isTowerShot('tower'), true);
assert.equal(isTowerShot('flame'), true);
assert.equal(isArcherShot('ranger'), true);
assert.equal(isArcherShot('melee'), false);
assert.equal(waveCleared(4, 6, true), true);
assert.equal(waveCleared(9, 6, true), false);
assert.equal(waveCleared(2, 6, false), false);

console.log('combat feel check passed');
