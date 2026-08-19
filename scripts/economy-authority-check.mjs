import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/economy.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('supabase/schema.sql');
const vendor = read('src/vendor.js');
const ui = read('src/ui.js');

for (const marker of ['game_characters', 'player_wallets', 'item_instances', 'economy_requests', 'economy_audit_events', 'economy_mutate']) {
  assert.match(schema, new RegExp(marker), `${marker} is missing from the authority schema`);
}
assert.match(schema, /primary key \(actor_user_id, request_id\)/, 'requests must be idempotent per actor');
assert.match(schema, /salvage_alloy >= 0/, 'wallets must reject negative currency');
assert.match(schema, /item_instances_one_equipped_slot/, 'one item slot must have one owner');
assert.match(schema, /stale_revision/, 'mutations must reject stale revisions');
assert.match(schema, /unauthorized_ownership/, 'mutations must enforce item ownership');
assert.match(schema, /invalid_equipment_slot/, 'mutations must enforce equipment compatibility');
assert.match(schema, /inventory_full/, 'mutations must enforce stash capacity');
assert.match(schema, /provenance jsonb not null/, 'items must retain provenance');
assert.match(schema, /grant execute[\s\S]*service_role/, 'only the server role may execute economic mutations');
assert.match(vendor, /OFFLINE ONLY/, 'local vendor mutations must be marked offline-only');
assert.match(ui, /onMarketBuy/, 'signed-in market buys must cross the server callback');
assert.match(ui, /onMarketSell/, 'signed-in market sales must cross the server callback');
assert.match(ui, /onAuthorityEquip/, 'signed-in equip must cross the server callback');
assert.match(ui, /onAuthorityUnequip/, 'signed-in unequip must cross the server callback');
assert.doesNotMatch(read('api/economy.js'), /body\.characterLevel/, 'vendor level must not come from the browser');

const response = () => ({ status: 0, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); }, setHeader() {} });
const request = (body, authorization = '') => ({ method: 'POST', headers: { authorization }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } });
process.env.SUPABASE_URL = 'https://zillions.invalid';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const anonymous = response();
await handler(request({ action: 'snapshot', requestId: 'r1', characterId: 'c1' }), anonymous);
assert.equal(anonymous.status, 401, 'anonymous economy requests must fail');

const originalFetch = globalThis.fetch;
let rpcBody = null;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: '11111111-1111-1111-1111-111111111111' }) };
  rpcBody = JSON.parse(options.body);
  return { ok: true, json: async () => ({ ok: true, duplicate: false, character: { revision: 2 }, wallet: { balance: 5 }, items: [] }) };
};
const authorized = response();
await handler(request({ action: 'snapshot', requestId: 'r2', characterId: 'local-c1' }, 'Bearer player-token'), authorized);
globalThis.fetch = originalFetch;
assert.equal(authorized.status, 200);
assert.equal(rpcBody.p_actor, '11111111-1111-1111-1111-111111111111');
assert.equal(rpcBody.p_action, 'snapshot');
assert.equal(rpcBody.p_request_id, 'r2');
assert.equal(rpcBody.p_payload.client_character_id, 'local-c1');
console.log('economy authority check passed');
