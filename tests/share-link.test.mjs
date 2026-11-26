import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_MAX_PLAYERS, SHARE_STALE_MS, SHARE_TTL_MS,
  admitGuest, clearGuestReady, closeLobby, createLobby, createShareCode, hostStillHere, markStarted, parseShareLocation,
  preferLiveRelay, publicShareLobby, reapStaleSeats, releaseGuest, seatDisplayName, seatGuest, setSeatReady, shareBlockers, shareFailureCopy, shareGuestName, shareLaunchReady, shareRoster, shareStartLabel, shareUrl, SHARE_SILENCE_MS, touchLobby, touchSeatActivity, withSeatHero,
} from '../src/share-link.js';
import { CLIENT_VERSION, LOBBY_PROTOCOL_VERSION } from '../src/online.js';
import { createBrowserHub, createMemoryChannelFactory, createSupabaseHub, loadShareIceServers } from '../src/share-bus.js';

const NOW = 1_700_000_000_000;
const HOST = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const FOURTH = '44444444-4444-4444-8444-444444444444';
const FIFTH = '55555555-5555-4555-8555-555555555555';
const CODE = 'abc2345678';

function lobby(extra = {}) {
  return createLobby({ code: CODE, hostId: HOST, hostName: 'Ada', hero: 'scott', now: NOW, ...extra });
}

test('invite urls round-trip and malformed codes are refused', () => {
  const code = createShareCode(Uint8Array.from({ length: 10 }, (_, i) => i));
  const url = shareUrl('https://zillions.taborlin.co/', code);
  assert.equal(parseShareLocation(new URL(url).search)?.code, code);
  const kept = new URL(shareUrl('https://zillions.taborlin.co', code, '?quality=low&coop=oldcode'));
  assert.equal(kept.searchParams.get('quality'), 'low');
  assert.equal(kept.searchParams.get('coop'), code);
  assert.equal(preferLiveRelay({ live: true, relayOpen: true, incomingRelay: false }), true);
  assert.equal(preferLiveRelay({ live: true, relayOpen: true, incomingRelay: true }), false);
  assert.equal(preferLiveRelay({ live: false, relayOpen: true, incomingRelay: false }), false);
  assert.equal(parseShareLocation(''), null);
  assert.equal(parseShareLocation('?party=abcd')?.ok, undefined);
  assert.equal(parseShareLocation('?party=abcd'), null);
  assert.deepEqual(parseShareLocation('?coop='), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseShareLocation('?coop=short'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseShareLocation('?coop=iiiiiiiiii'), { ok: false, reason: 'invalid' });
  assert.equal(shareFailureCopy('invalid'), 'This invite link is not valid.');
});

test('a second hero is seated, a duplicate keeps that seat, and the fourth is the last', () => {
  let room = lobby();
  const first = seatGuest(room, { id: GUEST, name: 'Bea', hero: 'alexander' }, NOW + 10);
  assert.equal(first.ok, true);
  assert.equal(first.seat, 2);
  room = first.lobby;
  assert.equal(room.seats[1].hero, 'alexander');
  const again = seatGuest(room, { id: GUEST, name: 'Bea', hero: 'danny' }, NOW + 20);
  assert.equal(again.rejoining, true);
  assert.equal(again.seat, 2);
  assert.equal(again.lobby, room);
  room = withSeatHero(room, GUEST, 'not-a-hero', 'Bea', NOW + 30);
  assert.equal(room.seats[1].hero, 'scott');
  room = seatGuest(room, { id: THIRD, name: 'Cy', hero: 'danny' }, NOW + 40).lobby;
  room = seatGuest(room, { id: FOURTH, name: 'Dee', hero: 'scott' }, NOW + 50).lobby;
  assert.equal(room.seats.length, SHARE_MAX_PLAYERS);
  const full = admitGuest(room, { id: FIFTH }, NOW + 60);
  assert.deepEqual(full, { ok: false, reason: 'full' });
  assert.equal(shareFailureCopy('full'), 'This siege is full.');
  const trial = lobby({ mode: 'labyrinth' });
  const trialFull = seatGuest(seatGuest(trial, { id: GUEST, name: 'Bea', hero: 'scott' }, NOW + 10).lobby, { id: THIRD, name: 'Cy', hero: 'danny' }, NOW + 20).lobby;
  assert.equal(trialFull.seats.length, 3);
  assert.equal(admitGuest(trialFull, { id: FOURTH }, NOW + 30).reason, 'full');
  const roster = shareRoster(room, GUEST);
  assert.equal(roster[1].you, true);
  assert.equal(roster[0].host, true);
});

const claim = { claim: true, protocolVersion: LOBBY_PROTOCOL_VERSION, clientVersion: CLIENT_VERSION, unlockedLevel: 1 };

test('an old client cannot take a share seat, and a locked mission cannot launch', () => {
  const room = lobby({ unlockedLevel: 5 });
  assert.equal(admitGuest(room, { id: GUEST, claim: true }, NOW + 10).reason, 'incompatible');
  assert.match(shareFailureCopy('incompatible'), /different game version/);
  const stale = { ...room, protocolVersion: LOBBY_PROTOCOL_VERSION - 1 };
  assert.equal(admitGuest(stale, { id: GUEST, ...claim }, NOW + 10).reason, 'incompatible');
  const seated = seatGuest(room, { id: GUEST, name: 'Bea', hero: 'scott', ...claim, unlockedLevel: 1 }, NOW + 10).lobby;
  const later = { ...seated, level: 3 };
  assert.equal(shareBlockers(later).length, 1);
  assert.equal(shareBlockers({ ...later, mode: 'survival' }).length, 0);
  const open = new Set([GUEST]);
  assert.equal(shareLaunchReady(seated, open).ready, false);
  const ready = setSeatReady(seated, GUEST, true, NOW + 20);
  assert.equal(shareLaunchReady(ready, open).ready, true);
  assert.equal(shareLaunchReady(ready, new Set()).connecting, true);
  const changed = withSeatHero(ready, GUEST, 'alexander', 'Bea', NOW + 30);
  assert.equal(changed.seats[1].ready, false);
  assert.equal(clearGuestReady(setSeatReady(seated, GUEST, true, NOW + 20), NOW + 40).seats[1].ready, false);
  assert.equal(shareLaunchReady({ ...ready, level: 4 }, open).ready, false);
});

test('share ice prefers the deployment relay list', async () => {
  const turn = [{ urls: 'turn:example.test:3478', username: 'siege', credential: 'secret' }];
  const servers = await loadShareIceServers(async () => ({ ok: true, json: async () => ({ iceServers: turn }) }));
  assert.deepEqual(servers, turn);
  assert.equal(await loadShareIceServers(async () => ({ ok: false, json: async () => ({}) })), null);
});

test('a guest clock ahead of the host does not mean the host left', () => {
  const room = lobby();
  const skewed = { ...room, seenAt: NOW - 60_000 };
  assert.equal(hostStillHere(skewed, NOW), false);
  assert.equal(admitGuest(skewed, { id: GUEST }, NOW, { receivedAt: NOW - 1000 }).ok, true);
  assert.equal(admitGuest(skewed, { id: GUEST }, NOW, { hostPresent: true }).ok, true);
  assert.equal(admitGuest(skewed, { id: GUEST }, NOW).reason, 'host_left');
});

test('a silent seat is dropped after five seconds, including one that still looks connected', () => {
  let room = seatGuest(lobby(), { id: GUEST, name: 'Bea', hero: 'scott' }, NOW).lobby;
  room = seatGuest(room, { id: THIRD, name: 'Commander', hero: 'scott' }, NOW).lobby;
  room = {
    ...room,
    seats: room.seats.map((seat) => (seat.host ? seat : { ...seat, linked: true, ready: true })),
  };
  const open = new Set([GUEST, THIRD]);
  assert.equal(shareLaunchReady(room, open).ready, true);
  assert.equal(reapStaleSeats(room, NOW + SHARE_SILENCE_MS - 1).dropped.length, 0);
  const reaped = reapStaleSeats(room, NOW + SHARE_SILENCE_MS);
  assert.equal(reaped.dropped.length, 2);
  const refreshed = touchSeatActivity(room, THIRD, NOW + 4000);
  const kept = reapStaleSeats(refreshed, NOW + 8000);
  assert.deepEqual(kept.dropped.map((seat) => seat.id), [GUEST]);
  assert.equal(kept.lobby.seats.some((seat) => seat.id === THIRD), true);
});

test('a live heartbeat keeps a guest seated for a full minute without WebRTC', () => {
  let room = seatGuest(lobby(), { id: GUEST, name: 'Bea', hero: 'scott' }, NOW).lobby;
  const open = new Set();
  for (let t = 2000; t <= 60000; t += 2000) {
    const result = reapStaleSeats(room, NOW + t, { openIds: open, presentIds: null });
    assert.equal(result.dropped.length, 0, `reaped at ${t}ms`);
    room = touchSeatActivity(result.lobby, GUEST, NOW + t);
  }
  assert.equal(room.seats.some((seat) => seat.id === GUEST), true);
});

test('a joiner does not wear the host name', () => {
  const id = 'abcdef12-3456-4789-abcd-ef1234567890';
  assert.equal(shareGuestName({ name: 'Gork', id, hostName: 'Gork' }), 'Guest 7890');
  assert.equal(shareGuestName({ name: 'Vanguard', id, hostName: 'Gork' }), 'Guest 7890');
  assert.equal(shareGuestName({ name: '', id, hostName: 'Gork' }), 'Guest 7890');
  assert.equal(shareGuestName({ name: 'Bea', id, hostName: 'Gork' }), 'Bea');
  assert.notEqual(shareGuestName({ name: 'Gork', id, hostName: 'Gork' }), shareGuestName({ name: 'Gork', id: '99999999-9999-4999-8999-999999999991', hostName: 'Gork' }));
});

test('the seat label prefers the founder over the Commander fallback', () => {
  assert.equal(seatDisplayName({ founderName: 'Mara' }), 'Mara');
  assert.equal(seatDisplayName({ username: 'ada', founderName: 'Mara' }), 'ada');
  assert.equal(seatDisplayName({}), 'Commander');
});

test('expired, closed, stale, and already-started links refuse a new hero', () => {
  const room = lobby();
  const stillThere = touchLobby(room, NOW + SHARE_TTL_MS - 1000);
  assert.equal(admitGuest(stillThere, { id: GUEST }, NOW + SHARE_TTL_MS).reason, 'expired');
  assert.match(shareFailureCopy('expired'), /expired/);
  assert.equal(admitGuest(closeLobby(room, NOW + 5), { id: GUEST }, NOW + 5).reason, 'host_left');
  assert.match(shareFailureCopy('host_left'), /host left/);
  assert.equal(admitGuest(room, { id: GUEST }, NOW + SHARE_STALE_MS + 1).reason, 'host_left');
  const started = markStarted(seatGuest(room, { id: GUEST, name: 'Bea', hero: 'scott' }, NOW + 10).lobby, NOW + 20);
  assert.equal(admitGuest(started, { id: THIRD }, NOW + 30).reason, 'started');
  assert.match(shareFailureCopy('started'), /already started/);
  const staying = admitGuest(started, { id: GUEST }, NOW + 30);
  assert.equal(staying.ok, true);
  assert.equal(staying.started, true);
  assert.equal(releaseGuest(started, GUEST, NOW + 40).seats.length, 2);
  const open = seatGuest(room, { id: GUEST, name: 'Bea', hero: 'scott' }, NOW + 10).lobby;
  assert.equal(releaseGuest(open, GUEST, NOW + 15).seats.length, 1);
  assert.equal(admitGuest(null, { id: GUEST }, NOW).reason, 'invalid');
  assert.equal(admitGuest(room, { id: HOST }, NOW + 10).reason, 'invalid');
});

test('two browser tabs exchange a lobby and a join with no server', () => {
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const Channel = createMemoryChannelFactory();
  const host = createBrowserHub({ storage: store, Channel });
  const guest = createBrowserHub({ storage: store, Channel });
  const heard = [];
  host.subscribe(CODE, (message) => heard.push(message), { replay: 'none' });
  const room = publicShareLobby(lobby());
  host.publish(CODE, { t: 'lobby', lobby: room, id: 'h1', from: HOST });
  let replay = null;
  guest.subscribe(CODE, (message) => { replay = message; }, { replay: 'lobby' });
  assert.equal(replay.lobby.code, CODE);
  assert.equal(replay.lobby.seats.length, 1);
  guest.publish(CODE, { t: 'join', id: 'g1', from: GUEST, name: 'Bea', hero: 'alexander' });
  assert.equal(heard.at(-1).t, 'join');
  assert.equal(heard.at(-1).from, GUEST);
});

test('a relay hub delivers the lobby to a second client once it is subscribed', async () => {
  function fakeClient() {
    const byName = new Map();
    return {
      channel(name) {
        const peers = byName.get(name) || [];
        byName.set(name, peers);
        const listeners = [];
        const channel = {
          on(_type, _filter, callback) { listeners.push(callback); return channel; },
          subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
          send(message) {
            for (const other of peers) {
              if (other === channel) continue;
              for (const callback of other._listeners) callback({ payload: message.payload });
            }
            return Promise.resolve('ok');
          },
        };
        channel._listeners = listeners;
        peers.push(channel);
        return channel;
      },
    };
  }
  const client = fakeClient();
  const host = createSupabaseHub(client);
  const guest = createSupabaseHub(client);
  const seen = [];
  guest.subscribe(CODE, (message) => seen.push(message));
  host.publish(CODE, { t: 'lobby', id: 'h1', lobby: { code: CODE } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen[0]?.t, 'lobby');
  assert.equal(seen[0].lobby.code, CODE);
});
