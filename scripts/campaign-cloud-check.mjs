import assert from 'node:assert/strict';
import { AuthClient } from '../src/auth.js';

function query(table, writes) {
  const state = { table, action: 'select', payload: null };
  const result = () => ({ error: null });
  return {
    select() { state.action = 'select'; return this; },
    update(payload) { state.action = 'update'; state.payload = payload; writes.push(state); return this; },
    upsert(payload) { state.action = 'upsert'; state.payload = payload; writes.push(state); return Promise.resolve(result()); },
    eq() { return this; },
    maybeSingle() {
      if (table === 'profiles') return Promise.resolve({
        data: { id: 'u1', handle: 'ted', display_name: 'ted', selected_hero: 'engineer', username_set: true },
        error: null,
      });
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      return Promise.resolve({
        data: { id: 'u1', handle: 'ted', display_name: 'ted', selected_hero: 'engineer', username_set: true },
        error: null,
      });
    },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
}

const legacy = new AuthClient();
legacy.session = { user: { id: 'u1', user_metadata: {} } };
const legacyProfile = legacy.profileFromBundle({
  profile: { handle: 'ted', display_name: 'ted', username_set: true }, stats: {},
});
assert.equal(Object.hasOwn(legacyProfile, 'campaign'), false,
  'accounts without cloud campaign data must preserve existing local progress during merge');

const auth = new AuthClient();
auth.session = { user: { id: 'u1', user_metadata: { campaign: 3 } } };
auth.profile = { selected_hero: 'engineer' };
assert.equal(auth.profileFromBundle({
  profile: { handle: 'ted', display_name: 'ted', username_set: true }, stats: {},
}).campaign, 3, 'cloud campaign progress must hydrate into the local profile');

const writes = [];
const metadataWrites = [];
auth.client = {
  from(table) { return query(table, writes); },
  auth: {
    async updateUser({ data }) {
      metadataWrites.push(data);
      return { data: { user: { id: 'u1', user_metadata: data } }, error: null };
    },
  },
};

await auth.syncLocalProfile({ campaign: 2, lastHero: 'engineer' });
assert.equal(metadataWrites.at(-1).campaign, 3,
  'a stale local profile must not lower campaign progress already known by the account session');

await auth.syncLocalProfile({ campaign: 5, lastHero: 'engineer' });
assert.equal(metadataWrites.at(-1).campaign, 5, 'a campaign win must be written to account metadata');
assert.equal(auth.user.user_metadata.campaign, 5,
  'the in-memory authenticated session must reflect persisted campaign progress immediately');
assert.equal(auth.profileFromBundle({
  profile: { handle: 'ted', display_name: 'ted', username_set: true }, stats: {},
}).campaign, 5, 'persisted campaign progress must survive the next cloud hydration');

console.log('campaign cloud check passed');
