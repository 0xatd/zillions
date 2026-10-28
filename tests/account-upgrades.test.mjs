import test from 'node:test';
import assert from 'node:assert/strict';
import { processAccountUpgrade } from '../api/account-upgrades.js';

const fakeStore = () => {
  const calls = [];
  return {
    calls,
    state: async (userId) => ({ owned: ['supply_cache'], imported: false, wallet: { balance: 5, revision: 1 }, userId }),
    mutate: async (args) => { calls.push(args); return { ok: true }; },
  };
};
const userId = '11111111-1111-1111-1111-111111111111';

test('account upgrades: only node ids and request ids reach the RPC, never prices', async () => {
  const store = fakeStore();
  await processAccountUpgrade({ userId, store, body: { action: 'buy', requestId: 'req-12345678', nodeId: 'supply_depot', cost: 1, userId: 'x' } });
  assert.deepEqual(store.calls[0], { p_actor: userId, p_request_id: 'req-12345678', p_action: 'buy', p_payload: { node_id: 'supply_depot' } });
  await processAccountUpgrade({ userId, store, body: { action: 'import_local', requestId: 'import-local-v1', nodes: ['warband_vigor', 'bogus', 'warband_vigor'] } });
  assert.deepEqual(store.calls[1].p_payload, { nodes: ['warband_vigor'] });
  await processAccountUpgrade({ userId, store, body: { action: 'rewire_lattice', requestId: 'req-87654321', characterId: 'mmo_a', spent: 0 } });
  assert.deepEqual(store.calls[2].p_payload, { client_character_id: 'mmo_a' });
});

test('account upgrades: bad requests are refused before the database', async () => {
  const store = fakeStore();
  const refuse = (body, re) => assert.rejects(processAccountUpgrade({ userId, store, body }), re);
  await refuse({ action: 'grant' }, /invalid_action/);
  await refuse({ action: 'buy', nodeId: 'supply_cache' }, /missing_request_id/);
  await refuse({ action: 'buy', requestId: 'req-12345678', nodeId: 'free_money' }, /unknown_upgrade/);
  await refuse({ action: 'import_local', requestId: 'req-12345678', nodes: 'all' }, /invalid_import/);
  await refuse({ action: 'rewire_lattice', requestId: 'req-12345678' }, /missing_character/);
  assert.equal(store.calls.length, 0);
  const state = await processAccountUpgrade({ userId, store, body: { action: 'state' } });
  assert.equal(state.userId, userId);
});
