import assert from 'node:assert/strict';
import { OnlineLobby } from '../src/online.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return promise; },
  };
  return { query, resolve };
}

const oldRead = deferred();
const newRead = deferred();
const reads = [oldRead.query, newRead.query];
const renders = [];
const lobby = new OnlineLobby({ onRoom: (room) => renders.push(room.players) });
lobby.game = { id: 'room-1' };
lobby.sb = { from: () => reads.shift() };

const older = lobby.refreshCurrentGame();
const newer = lobby.refreshCurrentGame();
const base = {
  id: 'room-1', code: 'ABC123', name: 'Test', host_user_id: 'host', visibility: 'public',
  status: 'open', rules: 'survival-plots', max_players: 3, metadata: {},
};

newRead.resolve({ data: { ...base, room_players: [
  { user_id: 'host', seat: 1, display_name: 'host' },
  { user_id: 'guest', seat: 2, display_name: 'guest' },
] }, error: null });
await newer;
oldRead.resolve({ data: { ...base, room_players: [
  { user_id: 'host', seat: 1, display_name: 'host' },
] }, error: null });
await older;

assert.equal(lobby.game.players, 2, 'an older room read must not erase a newly joined player');
assert.deepEqual(renders, [2], 'only the newest room snapshot may render');
console.log('Room refresh race check passed.');
