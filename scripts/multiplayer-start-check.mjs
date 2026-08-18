import assert from 'node:assert/strict';
import { inboxForMatchStart, matchStartReady } from '../src/multiplayer-windows.js';

// Reproduce the join race: a window arrives before asynchronous startup ends.
// Guest startup must retain the exact Map so window zero survives.
const earlyWindows = new Map();
const guestInbox = inboxForMatchStart('guest', earlyWindows);
earlyWindows.set(0, [{ t: 'move', p: 0, dx: 1, dz: 0 }]);
assert.equal(guestInbox, earlyWindows, 'guest startup must preserve the live pre-start inbox');
assert.deepEqual(guestInbox.get(0), [{ t: 'move', p: 0, dx: 1, dz: 0 }], 'window zero must survive startup');

const staleHostInbox = new Map([[0, ['stale']]]);
assert.equal(inboxForMatchStart('host', staleHostInbox).size, 0, 'host startup must begin with a clean inbox');

assert.equal(matchStartReady(2, 0), false, 'host must hold before either guest loads');
assert.equal(matchStartReady(2, 1), false, 'host must hold until every connected guest loads');
assert.equal(matchStartReady(2, 2), true, 'host may emit window zero after every guest reports ready');
assert.equal(matchStartReady(3, 2), false, 'a four-player host must wait for the third guest');
assert.equal(matchStartReady(3, 3), true, 'a four-player party may start after all three guests load');
assert.equal(matchStartReady(0, 0), true, 'a solo host needs no startup barrier');

console.log('Multiplayer start check passed.');
