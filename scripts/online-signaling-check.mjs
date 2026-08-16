import assert from 'node:assert/strict';
import { OnlineLobby } from '../src/online.js';

class FakeChannel {
  constructor(statuses = ['SUBSCRIBED'], sends = ['ok']) {
    this.statuses = statuses;
    this.sends = sends;
    this.handlers = [];
  }

  on(...args) {
    this.handlers.push(args);
    return this;
  }

  subscribe(cb) {
    queueMicrotask(() => cb(this.statuses.shift() || 'SUBSCRIBED'));
    return this;
  }

  async send() {
    return this.sends.shift() || 'ok';
  }
}

const game = new FakeChannel(['SUBSCRIBED'], ['timed out', 'rate limited', 'ok']);
const chat = new FakeChannel();
const channels = [game, chat];
const lobby = new OnlineLobby();
lobby.me = { id: 'player-1', name: 'Tester' };
lobby.sb = {
  channel() { return channels.shift(); },
  removeChannel() {},
};

await lobby._joinGameChannel('room-1', false);
await lobby.signal({ t: 'knock' });
assert.equal(game.sends.length, 0, 'signaling must retry until Supabase acknowledges delivery');

const failed = new OnlineLobby();
failed.me = { id: 'player-2', name: 'Tester 2' };
failed.gameChan = new FakeChannel([], ['timed out', 'timed out', 'timed out']);
await assert.rejects(
  () => failed.signal({ t: 'knock' }),
  /room message was not delivered/,
  'signaling must report a failed delivery instead of silently hanging',
);

const watched = { id: 'room-live', status: 'in_game', host_id: 'host-1' };
const watcher = new OnlineLobby();
watcher.me = { id: 'watcher-1', name: 'Observer' };
let subscribedRoom = null;
let spectatorSignal = null;
watcher._joinGameChannel = async (roomId, asHost) => {
  subscribedRoom = { roomId, asHost };
};
watcher.signal = async (payload) => {
  spectatorSignal = payload;
};
await watcher.watchGame(watched);
assert.equal(watcher.game, watched, 'watching must retain the active game without taking a player seat');
assert.deepEqual(subscribedRoom, { roomId: 'room-live', asHost: false }, 'watching must subscribe as a non-host');
assert.deepEqual(spectatorSignal, { t: 'knock', role: 'spectator', name: 'Observer' }, 'watching must identify a read-only spectator to the host');

console.log('Online signaling check passed.');
