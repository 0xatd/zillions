import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const online = readFileSync(new URL('../src/online.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert.match(online, /t: 'roomClosed', to: 'all'/, 'host closure must broadcast to every guest');
assert.match(online, /async removeRoomPlayer\(userId\)/, 'host must be able to remove a dead seat');
assert.match(main, /_armLobbyConnectionWatchdog\(\)/, 'guest connection must have a watchdog');
assert.match(main, /t: 'reconnectRequest'/, 'host must be able to request a new dial');
assert.match(main, /Waiting for \$\{connectionNames/, 'start blocker must name disconnected players');
assert.match(ui, /RECONNECT TO HOST/);
assert.match(ui, /room-remove/);
console.log('room lifecycle check passed');
