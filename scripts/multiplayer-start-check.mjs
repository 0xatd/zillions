import assert from 'node:assert/strict';
import { inboxForMatchStart } from '../src/multiplayer-windows.js';

// Reproduce the join race: a window arrives before asynchronous startup ends.
// Guest startup must retain the exact Map so window zero survives.
const earlyWindows = new Map();
const guestInbox = inboxForMatchStart('guest', earlyWindows);
earlyWindows.set(0, [{ t: 'move', p: 0, dx: 1, dz: 0 }]);
assert.equal(guestInbox, earlyWindows, 'guest startup must preserve the live pre-start inbox');
assert.deepEqual(guestInbox.get(0), [{ t: 'move', p: 0, dx: 1, dz: 0 }], 'window zero must survive startup');

const staleHostInbox = new Map([[0, ['stale']]]);
assert.equal(inboxForMatchStart('host', staleHostInbox).size, 0, 'host startup must begin with a clean inbox');

console.log('Multiplayer start check passed.');
