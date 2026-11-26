import test from 'node:test';
import assert from 'node:assert/strict';
import { canSocketSend, createSupabaseHub } from '../src/share-bus.js';

test('a socket send waits until the channel is joined', () => {
  assert.equal(canSocketSend('joined', true), true);
  assert.equal(canSocketSend('joining', true), false);
  assert.equal(canSocketSend('joined', false), false);
  assert.equal(canSocketSend(undefined, true), true);
});

test('seat traffic is queued until SUBSCRIBED and is never sent on a closed socket', async () => {
  const sent = [];
  function channel() {
    const listeners = [];
    const channel = {
      state: 'joining',
      on() { return channel; },
      subscribe(callback) {
        queueMicrotask(() => {
          channel.state = 'joined';
          callback('SUBSCRIBED');
        });
        return channel;
      },
      send(message) {
        sent.push(message);
        return Promise.resolve('ok');
      },
      track() { return Promise.resolve('ok'); },
    };
    channel._listeners = listeners;
    return channel;
  }
  const client = {
    realtime: {
      connected: false,
      connect() { this.connected = true; },
      isConnected() { return this.connected; },
    },
    channel() { return channel(); },
    removeChannel() { return Promise.resolve(); },
  };
  const hub = createSupabaseHub(client);
  hub.subscribe('abc2345678', () => {});
  hub.publish('abc2345678', { t: 'lobby', from: 'host' });
  assert.equal(sent.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.t, 'lobby');
  assert.equal(sent[0].type, 'broadcast');
});
