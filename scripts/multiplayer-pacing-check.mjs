import assert from 'node:assert/strict';
import { consecutiveWindowCount, hasConsecutiveWindowBuffer } from '../src/multiplayer-pacing.js';

const reordered = new Map([[20, []], [22, []], [23, []]]);
assert.equal(consecutiveWindowCount(reordered, 20), 1,
  'out-of-order future packets must not hide the hole after the current window');
assert.equal(hasConsecutiveWindowBuffer(reordered, 20, 2), false,
  'guest must remain buffered instead of resuming for one tick and freezing again');

reordered.set(21, []);
assert.equal(consecutiveWindowCount(reordered, 20), 4);
assert.equal(hasConsecutiveWindowBuffer(reordered, 20, 2), true,
  'guest may resume once the missing packet completes a consecutive buffer');

console.log('Multiplayer pacing check passed.');
