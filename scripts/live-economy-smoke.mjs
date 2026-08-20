import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) assert.ok(process.env[key], `${key} is required`);

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { default: economyHandler } = await import('../api/economy.js');
const users = [];

const jsonFetch = async (target, options = {}) => {
  const response = await fetch(target, options);
  const body = await response.json().catch(() => null);
  return { response, body };
};

async function createUser(label) {
  const email = `zillions-smoke-${Date.now()}-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Z!${randomUUID()}a9`;
  const created = await jsonFetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${service}`, apikey: service, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.equal(created.response.status, 200, `create ${label}: ${JSON.stringify(created.body)}`);
  users.push(created.body.id);
  const login = await jsonFetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.response.status, 200, `login ${label}: ${JSON.stringify(login.body)}`);
  return { id: created.body.id, token: login.body.access_token };
}

function request(token, body) {
  return {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
}

function response() {
  return {
    status: 0, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(value) { this.body = JSON.parse(value); },
  };
}

async function mutate(account, action, body, expected = 200) {
  const out = response();
  await economyHandler(request(account.token, { action, ...body }), out);
  assert.equal(out.status, expected, `${action} expected ${expected}, got ${out.status}: ${JSON.stringify(out.body)}`);
  return out.body;
}

const rid = (name) => `${name}-${randomUUID()}`;

try {
  const [a, b] = await Promise.all([createUser('a'), createUser('b')]);
  const charA = `char-a-${randomUUID()}`;
  const charA2 = `char-a2-${randomUUID()}`;
  const charB = `char-b-${randomUUID()}`;
  const character = (name, raceKey = 'human') => ({ name, classKey: 'vanguard', raceKey, customization: { face: 'frontier' } });

  let state = await mutate(a, 'register_character', { requestId: rid('register-a'), characterId: charA, character: character('Smoke A') });
  assert.equal(state.wallet.balance, 500);
  await mutate(a, 'register_character', { requestId: rid('register-a2'), characterId: charA2, character: character('Smoke A2', 'robot') });
  state = await mutate(a, 'snapshot', { requestId: rid('snapshot-a'), characterId: charA });
  assert.equal(state.wallet.balance, 500, 'second character repeated the starter grant');
  await mutate(b, 'register_character', { requestId: rid('register-b'), characterId: charB, character: character('Smoke B', 'robot') });

  const anonRpc = await jsonFetch(`${url}/rest/v1/rpc/economy_mutate`, {
    method: 'POST', headers: { authorization: `Bearer ${anon}`, apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ p_actor: a.id, p_request_id: rid('anon'), p_action: 'snapshot', p_payload: { client_character_id: charA } }),
  });
  assert.ok([401, 403, 404].includes(anonRpc.response.status), `anon RPC unexpectedly executable: ${anonRpc.response.status}`);
  const userRpc = await jsonFetch(`${url}/rest/v1/rpc/economy_mutate`, {
    method: 'POST', headers: { authorization: `Bearer ${a.token}`, apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ p_actor: a.id, p_request_id: rid('user'), p_action: 'snapshot', p_payload: { client_character_id: charA } }),
  });
  assert.ok([401, 403, 404].includes(userRpc.response.status), `authenticated RPC unexpectedly executable: ${userRpc.response.status}`);

  state = await mutate(a, 'buy_vendor', { requestId: rid('buy'), characterId: charA, vendorId: 'quartermaster', offerIndex: 0 });
  assert.equal(state.items.length, 1);
  const bought = state.items[0];
  const afterBuy = state.wallet.balance;

  await mutate(b, 'sell_vendor', { requestId: rid('cross-sell'), characterId: charB, itemId: bought.id }, 400);
  await mutate(a, 'equip', { requestId: rid('stale-equip'), characterId: charA, itemId: bought.id, equipSlot: bought.slotPool === 'offhand' ? 'offhand' : 'weapon', itemRevision: 999 }, 400);
  state = await mutate(a, 'equip', { requestId: rid('equip'), characterId: charA, itemId: bought.id, equipSlot: bought.slotPool === 'offhand' ? 'offhand' : 'weapon', itemRevision: bought.revision });
  const equipped = state.items.find((item) => item.id === bought.id);
  assert.equal(equipped.location, 'equipped');
  state = await mutate(a, 'unequip', { requestId: rid('unequip'), characterId: charA, equipSlot: equipped.equipSlot, itemRevision: equipped.revision });
  assert.equal(state.items.find((item) => item.id === bought.id).location, 'stash');

  const replayId = rid('replay-material');
  const replayBody = { requestId: replayId, characterId: charA, materialId: 'alloy_shard', quantity: 3 };
  state = await mutate(a, 'buy_craft_material', replayBody);
  const replayBalance = state.wallet.balance;
  const replay = await mutate(a, 'buy_craft_material', replayBody);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.wallet.balance, replayBalance, 'replay charged twice');
  await mutate(a, 'buy_craft_material', { ...replayBody, materialId: 'phase_flux', quantity: 1 }, 400);

  const concurrentBody = { requestId: rid('concurrent'), characterId: charA, materialId: 'phase_flux', quantity: 1 };
  const concurrent = await Promise.all([
    mutate(a, 'buy_craft_material', concurrentBody),
    mutate(a, 'buy_craft_material', concurrentBody),
  ]);
  assert.equal(concurrent.filter((entry) => entry.duplicate).length, 1, 'concurrent retry did not serialize cleanly');

  state = await mutate(a, 'craft_recipe', {
    requestId: rid('add-socket'), characterId: charA, itemId: bought.id,
    itemRevision: state.items.find((item) => item.id === bought.id).revision, recipeId: 'add_socket', socketIndex: 0,
  });
  let crafted = state.items.find((item) => item.id === bought.id);
  assert.equal(crafted.sockets.length, 1);

  await mutate(a, 'buy_craft_material', { requestId: rid('buy-prism'), characterId: charA, materialId: 'prism_dust', quantity: 2 });
  state = await mutate(a, 'craft_recipe', {
    requestId: rid('prism'), characterId: charA, itemId: bought.id,
    itemRevision: crafted.revision, recipeId: 'prism_socket', socketIndex: 0,
  });
  crafted = state.items.find((item) => item.id === bought.id);
  assert.equal(crafted.sockets[0].color, 'prismatic');

  state = await mutate(a, 'buy_component', { requestId: rid('component'), characterId: charA, componentId: bought.slotPool === 'weapon' ? 'kinetic_optic' : 'frame_drive' });
  const component = state.components.find((entry) => entry.location === 'inventory');
  assert.ok(component);
  state = await mutate(a, 'socket_insert', {
    requestId: rid('insert'), characterId: charA, itemId: bought.id, itemRevision: crafted.revision,
    componentId: component.id, socketIndex: 0,
  });
  crafted = state.items.find((item) => item.id === bought.id);
  assert.equal(crafted.sockets[0].component.instanceId, component.id);
  state = await mutate(a, 'socket_remove', {
    requestId: rid('remove'), characterId: charA, itemId: bought.id, itemRevision: crafted.revision, socketIndex: 0,
  });
  assert.equal(state.components.find((entry) => entry.id === component.id).location, 'inventory');

  const hidden = await jsonFetch(`${url}/rest/v1/item_instances?select=id&id=eq.${bought.id}`, {
    headers: { authorization: `Bearer ${b.token}`, apikey: anon },
  });
  assert.equal(hidden.response.status, 200);
  assert.deepEqual(hidden.body, [], 'RLS exposed account A item to account B');

  state = await mutate(a, 'sell_vendor', { requestId: rid('sell'), characterId: charA, itemId: bought.id });
  assert.equal(state.items.some((item) => item.id === bought.id), false);
  assert.ok(state.wallet.balance > afterBuy - 500, 'sale did not credit the wallet');

  console.log('live-economy-smoke: two-account auth, grant, buy/sell, equip, crafting, sockets, replay, concurrency, RPC denial, and RLS isolation passed');
} finally {
  await Promise.all(users.map((id) => fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${service}`, apikey: service },
  })));
}
