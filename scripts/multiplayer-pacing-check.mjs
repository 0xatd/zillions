import assert from 'node:assert/strict';
import { adaptiveWindowTarget, consecutiveWindowCount, guestLagWindows, hasConsecutiveWindowBuffer, hostPaceScale, rememberWindow, stallRecovery } from '../src/multiplayer-pacing.js';

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

assert.equal(stallRecovery(200, false), 'wait');
assert.equal(stallRecovery(300, false), 'retry-snapshot', 'a repair that is not served is requested once more, with a snapshot');
assert.equal(stallRecovery(300, true), 'snapshot');
assert.equal(stallRecovery(8000, true), 'resync', 'a stall that outlasts the snapshot still forces one');

assert.equal(guestLagWindows(400, 0), 0, 'a missing guest ack is not a reason to slow the host');
assert.equal(guestLagWindows(400, 397), 3, 'the jitter buffer is a few windows, not a stall');
assert.equal(guestLagWindows(400, 370), 30, 'a hash that is thirty windows old must not be treated as the live frame');

assert.deepEqual(hostPaceScale({ lagWindows: 4, reportFresh: true, easeAgeMs: 0 }), { scale: 1, easing: false });
assert.deepEqual(
  hostPaceScale({ lagWindows: 20, reportFresh: true, easeAgeMs: 0 }),
  { scale: 0.7, easing: true },
  'a guest that is actually behind gets one short slowdown',
);
assert.deepEqual(
  hostPaceScale({ lagWindows: 80, reportFresh: true, easeAgeMs: 3000 }),
  { scale: 1, easing: false },
  'the slowdown is bounded — the host does not crawl until the guest catches up',
);
assert.deepEqual(
  hostPaceScale({ lagWindows: 80, reportFresh: false, easeAgeMs: 0 }),
  { scale: 1, easing: false },
  'a stale hash is not a live guest',
);
assert.equal(hostPaceScale({ lagWindows: 40, reportFresh: true, easeAgeMs: 100, floor: 0.15 }).scale, 0.7,
  'host pace never drops below 70%');

console.log('Multiplayer pacing check passed.');
