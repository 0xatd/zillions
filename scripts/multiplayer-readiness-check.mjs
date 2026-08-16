import assert from 'node:assert/strict';
import { roomConnectionReadiness } from '../src/multiplayer-readiness.js';

const waitingRoom = { players: 2, _players: [{ seat: 1 }, { seat: 2 }] };
assert.deepEqual(
  roomConnectionReadiness(waitingRoom, 1),
  { expectedPlayers: 2, connected: 1, pending: 1, ready: false },
  'a listed guest must not count as connected before WebRTC opens',
);

assert.deepEqual(
  roomConnectionReadiness(waitingRoom, 2),
  { expectedPlayers: 2, connected: 2, pending: 0, ready: true },
  'the room must become launchable when every listed player is connected',
);

assert.equal(roomConnectionReadiness({ players: 1 }, 1).ready, true, 'a solo online room may launch');
console.log('multiplayer readiness check passed');
