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

// Supabase can briefly return an incomplete nested relationship immediately
// after a successful seat upsert. The local client must retain its own verified
// seat; this is different from response ordering because the newest response
// itself is incomplete.
const incomplete = deferred();
const selfRenders = [];
const seated = new OnlineLobby({ onRoom: (room) => selfRenders.push(room._players.map((p) => p.user_id)) });
seated.me = { id: 'guest', name: 'guest', hero: 'alexander' };
seated.game = roomToGameForTest({ ...base, room_players: [
  { user_id: 'host', seat: 1, display_name: 'host' },
  { user_id: 'guest', seat: 2, display_name: 'guest' },
] });
seated._seatedRoomId = 'room-1';
seated._localRoomPlayer = { user_id: 'guest', seat: 2, display_name: 'guest', hero: 'alexander' };
seated.sb = { from: () => incomplete.query };
const refresh = seated.refreshCurrentGame();
incomplete.resolve({ data: { ...base, room_players: [
  { user_id: 'host', seat: 1, display_name: 'host' },
] }, error: null });
await refresh;

assert.deepEqual(seated.game._players.map((p) => p.user_id).sort(), ['guest', 'host'], 'a verified local seat must survive an incomplete newest snapshot');
assert.deepEqual(selfRenders, [['host', 'guest']], 'the room renderer must keep the joined player visible');

// A stalled database read must not stall the WebRTC lobby handshake. Return
// the cached roster after the deadline; the outstanding read may still heal
// the room later if the network recovers.
const stalled = deferred();
const bounded = new OnlineLobby({});
bounded.game = { id: 'room-1', players: 2 };
bounded.sb = { from: () => stalled.query };
const startedAt = Date.now();
const fallback = await bounded.refreshCurrentGameBounded(20);
assert.equal(fallback, bounded.game, 'a timed-out refresh must return the cached room');
assert.ok(Date.now() - startedAt < 250, 'a stalled refresh must respect the handshake deadline');

console.log('Room refresh race check passed.');

function roomToGameForTest(row) {
  const players = row.room_players || [];
  return {
    id: row.id,
    host_id: row.host_user_id,
    players: players.length,
    _players: players,
  };
}
