import assert from 'node:assert/strict';
import { adaptiveWindowTarget, consecutiveWindowCount, hasConsecutiveWindowBuffer, rememberWindow } from '../src/multiplayer-pacing.js';

const reordered = new Map([[20, []], [22, []], [23, []]]);
assert.equal(consecutiveWindowCount(reordered, 20), 1,
  'out-of-order future packets must not hide the hole after the current window');
assert.equal(hasConsecutiveWindowBuffer(reordered, 20, 2), false,
  'guest must remain buffered instead of resuming for one tick and freezing again');

reordered.set(21, []);
assert.equal(consecutiveWindowCount(reordered, 20), 4);
assert.equal(hasConsecutiveWindowBuffer(reordered, 20, 2), true,
  'guest may resume once the missing packet completes a consecutive buffer');

assert.equal(adaptiveWindowTarget(20, 2), 3, 'clean local routes should keep a small safety bank');
assert.equal(adaptiveWindowTarget(180, 45), 6, 'jittery internet routes should bank more windows');
assert.equal(adaptiveWindowTarget(2000, 500), 10, 'pathological routes must stay within the latency cap');

const history = new Map();
for (let w = 0; w < 70; w++) rememberWindow(history, w, [{ t: 'move', p: 1 }], 64);
assert.equal(history.has(5), false, 'repair history must discard windows older than its cap');
assert.deepEqual(history.get(20), [{ t: 'move', p: 1 }], 'a stalled guest can request an exact recent window');
assert.equal(history.get(70), undefined, 'repair must never invent a window the host has not emitted');

console.log('Multiplayer pacing check passed.');
