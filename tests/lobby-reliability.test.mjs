import test from 'node:test';
import assert from 'node:assert/strict';
import {
  committedSetupPatch, desyncRecovery, mergeRefreshedRoom, noteSeatReceipts, publicRoomSetup, roomStartLabel,
  shareGuestView, shareRejoinStep, staleOpenSeatIds, withinRejoinGrace,
} from '../src/lobby-reliability.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';

test('public room cards follow the committed host setup, not an older preview', () => {
  const room = {
    level: 4,
    mode: 'campaign',
    difficulty: 'normal',
    metadata: { level: 4, mode: 'campaign', mapName: 'The Black Vale', setupRevision: 1 },
    _players: [],
  };
  assert.equal(publicRoomSetup(room).mapName, 'The Black Vale');
  const committed = committedSetupPatch(room, { level: 1, mode: 'campaign', difficulty: 'casual' }, 2);
  const saved = {
    ...room,
    level: committed.level,
    mode: committed.mode,
    difficulty: committed.difficulty,
    metadata: { ...committed.metadata, mapName: null },
  };
  assert.equal(publicRoomSetup(saved).level, 1);
  assert.equal(publicRoomSetup(saved).difficulty, 'casual');
  assert.equal(publicRoomSetup(saved).mode, 'campaign');
  const staleRead = {
    ...room,
    level: 4,
    difficulty: 'normal',
    metadata: { ...room.metadata, setupRevision: 1 },
  };
  const merged = mergeRefreshedRoom(saved, staleRead);
  assert.equal(publicRoomSetup(merged).level, 1);
  assert.equal(publicRoomSetup(merged).difficulty, 'casual');
  const newer = mergeRefreshedRoom(saved, { ...saved, level: 2, metadata: { ...saved.metadata, level: 2, setupRevision: 3 } });
  assert.equal(publicRoomSetup(newer).level, 2);
});

test('Start names the player who is blocking, and stale seats can be reaped', () => {
  const label = roomStartLabel({
    pending: 1,
    connectionNames: '@Commander',
    waiting: [{ display_name: 'Bea' }],
  });
  assert.equal(label, 'WAITING FOR @Commander TO CONNECT');
  assert.equal(roomStartLabel({
    pending: 0,
    waiting: [{ display_name: 'Bea' }, { display_name: 'Cy' }],
  }), 'WAITING FOR Bea, Cy TO READY');
  const now = Date.parse('2026-11-26T00:00:00Z');
  const players = [
    { user_id: HOST, updated_at: '2026-11-25T23:00:00Z', last_seen_at: '2026-11-25T22:00:00Z' },
    { user_id: GUEST, updated_at: '2026-11-25T23:00:00Z', last_seen_at: '2026-11-25T22:00:00Z' },
  ];
  const seen = noteSeatReceipts({}, players, now - 30_000);
  const fresh = noteSeatReceipts(seen, players.map((player) => (
    player.user_id === GUEST ? { ...player, updated_at: '2026-11-26T00:00:01Z' } : player
  )), now);
  assert.deepEqual(staleOpenSeatIds(players, { hostId: HOST, now, graceMs: 25_000, receipts: fresh }), []);
  assert.deepEqual(staleOpenSeatIds(players, { hostId: HOST, now, graceMs: 25_000, receipts: seen }), [GUEST]);
  assert.deepEqual(staleOpenSeatIds(players, {
    hostId: HOST, now, graceMs: 25_000, receipts: seen, connectedIds: [GUEST],
  }), []);
  assert.deepEqual(staleOpenSeatIds(players, { hostId: HOST, now, graceMs: 25_000, receipts: seen, inGame: true }), []);
});

test('a reloading guest sees Rejoining, then an honest state, never a forever spinner', () => {
  const first = shareGuestView({ rejoinIntent: true, lobbyFresh: false, started: false, waitingMs: 0 });
  assert.equal(first.screen, 'rejoining');
  assert.match(first.button, /REJOINING/);
  const live = shareGuestView({ rejoinIntent: true, lobbyFresh: true, started: true, waitingMs: 1000 });
  assert.equal(live.screen, 'rejoining');
  const freshJoin = shareGuestView({ rejoinIntent: false, lobbyFresh: true, started: false });
  assert.equal(freshJoin.screen, 'waiting');
  const hostBack = shareGuestView({ rejoinIntent: true, lobbyFresh: true, started: false, endedReason: 'host_reloaded' });
  assert.equal(hostBack.screen, 'lobby');
  assert.match(hostBack.status, /back in the lobby/);
  const timedOut = shareGuestView({ rejoinIntent: true, lobbyFresh: true, started: true, waitingMs: 20000 });
  assert.equal(timedOut.screen, 'retry');
  const playing = shareGuestView({ inGame: true, started: true, waitingMs: 90000 });
  assert.equal(playing.screen, 'match');
});

test('a dropped share guest keeps asking until the channel returns or grace ends', () => {
  assert.equal(shareRejoinStep({ open: false, inMatch: true, lostAt: 1_000, now: 2_000 }), 'retry');
  assert.equal(shareRejoinStep({ open: true, inMatch: true, lostAt: 1_000, now: 2_000 }), 'stop');
  assert.equal(shareRejoinStep({ open: false, inMatch: true, lostAt: 1_000, now: 91_001 }), 'giveUp');
  assert.equal(shareRejoinStep({ open: false, inMatch: false, armed: true, hostAlive: true, now: 2_000 }), 'retry');
  assert.equal(shareRejoinStep({ open: false, inMatch: false, armed: true, hostAlive: false, now: 2_000 }), 'hostLeft');
});

test('a hash mismatch keeps restoring from the host snapshot', () => {
  const first = desyncRecovery({ attempts: [], now: 1_000 });
  assert.equal(first.action, 'resync');
  assert.equal(first.repeated, false);
  const second = desyncRecovery({ attempts: first.attempts, now: 2_000 });
  const third = desyncRecovery({ attempts: second.attempts, now: 3_000 });
  const again = desyncRecovery({ attempts: third.attempts, now: 4_000 });
  assert.equal(again.action, 'resync');
  assert.equal(again.repeated, true);
  assert.equal(withinRejoinGrace(1_000, 91_000), true);
  assert.equal(withinRejoinGrace(1_000, 91_001), false);
});
