import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabSession } from '../src/tab-session.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('two tabs in one browser do not share a commander id or a lobby lease', () => {
  const local = memoryStorage();
  const firstSession = memoryStorage();
  const secondSession = memoryStorage();
  let n = 0;
  const randomId = () => `id-${++n}`;
  const first = createTabSession({ session: firstSession, local, now: () => 1_000, randomId, token: 'tab-a' });
  // A duplicated tab copies sessionStorage, including the commander id.
  secondSession.setItem('zillions.tab', first.id);
  const second = createTabSession({ session: secondSession, local, now: () => 1_100, randomId, token: 'tab-b' });
  assert.notEqual(second.id, first.id);
  const hosted = first.claimLease({ kind: 'share', code: 'abc2345678' }, 1_200);
  assert.equal(hosted.ok, true);
  const stolen = second.claimLease({ kind: 'share', code: 'other' }, 1_300);
  assert.equal(stolen.ok, false);
  second.release(1_400);
  assert.equal(first.ownsLease(), true);
  first.release(1_500);
  assert.equal(first.ownsLease(), false);
  assert.equal(second.claimLease({ kind: 'room' }, 1_600).ok, true);
});

test('a refresh keeps the commander id after the closing page releases', () => {
  const local = memoryStorage();
  const session = memoryStorage();
  let n = 0;
  const randomId = () => `id-${++n}`;
  const first = createTabSession({ session, local, now: () => 1_000, randomId, token: 'tab-a' });
  const kept = first.id;
  first.release(1_500);
  first.touch(1_600);
  const next = createTabSession({ session, local, now: () => 1_700, randomId, token: 'tab-b' });
  assert.equal(next.id, kept);
});
