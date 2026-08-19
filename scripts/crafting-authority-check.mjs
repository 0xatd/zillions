import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { evaluateAuthorityCraft, CRAFT_VENDOR } from '../api/economy.js';
import { socketComponentMods } from '../src/crafting.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('supabase/schema.sql');
const api = read('api/economy.js');
const economy = read('src/economy.js');
const game = read('src/game.js');

for (const marker of ['crafting_material_balances', 'component_instances', 'buy_craft_material', 'buy_component', 'craft_recipe', 'socket_insert', 'socket_remove']) assert.match(schema, new RegExp(marker));
assert.match(schema, /select \* into v_item[\s\S]*for update/);
assert.match(schema, /expected_item_revision[\s\S]*stale_revision/);
assert.match(schema, /salvage_alloy>=v_price/);
assert.match(schema, /quantity>=v_quantity/);
assert.match(schema, /location='socketed'[\s\S]*item_instance_id=v_item.id/);
assert.match(schema, /location='inventory',item_instance_id=null,socket_index=null/);
assert.match(schema, /provenance=provenance\|\|jsonb_build_object\('last_craft'/);
assert.match(schema, /primary key \(actor_user_id, request_id\)/);
assert.match(schema, /player_wallets\(user_id, salvage_alloy\) values \(p_actor, 500\) on conflict \(user_id\) do nothing/, 'free launch needs one non-repeatable server starter grant');
assert.match(api, /authorityCraftSnapshot[\s\S]*evaluateAuthorityCraft/);
assert.doesNotMatch(api, /alloyBalance:\s*body\./);
assert.doesNotMatch(api, /materials:\s*body\./);
assert.match(api, /crafting_material_balances\?select=material_id,quantity[^`]+character_id=eq\.\$\{authoritativeCharacterId\}/);
assert.match(api, /component_instances\?select=id,owner_user_id,character_id,component_id,rank,location[^`]+character_id=eq\.\$\{authoritativeCharacterId\}/);
assert.match(schema, /component_id text not null check \(component_id in \('frame_drive'[\s\S]*'phase_ward'\)\)/);
assert.equal(CRAFT_VENDOR.materials.alloy_shard, 8);

const actor = '11111111-1111-1111-1111-111111111111';
const itemId = '22222222-2222-2222-2222-222222222222';
const componentId = '33333333-3333-3333-3333-333333333333';
const authority = {
  item: { id: itemId, owner_user_id: actor, legacy_key: 'scatter_mk3:authority:70:3', revision: 4, sockets: [{ color: 'reflex', type: 'optic', component: null }] },
  wallet: { salvage_alloy: 500 }, materials: { alloy_shard: 10, phase_flux: 5, prism_dust: 5 }, componentInventoryCount: 1,
  component: { id: componentId, owner_user_id: actor, component_id: 'kinetic_optic', rank: 1 }, processedRequestIds: [],
};
const inserted = evaluateAuthorityCraft('socket_insert', authority, { requestId: 'insert-1', itemRevision: 4, socketIndex: 0 }, actor);
assert.equal(inserted.ok, true);
assert.equal(inserted.mutation.components.consume[0].instanceId, componentId);
assert.equal(inserted.item.revision, 5);
assert.equal(socketComponentMods([inserted.item, inserted.item]).critChance, 0.01);
const removed = evaluateAuthorityCraft('socket_remove', { ...authority, item: { ...authority.item, revision: 5, sockets: inserted.item.sockets } }, { requestId: 'remove-1', itemRevision: 5, socketIndex: 0 }, actor);
assert.equal(removed.mutation.components.return[0].instanceId, componentId);
assert.equal(evaluateAuthorityCraft('craft_recipe', authority, { requestId: 'stale', itemRevision: 3, recipeId: 'add_socket', socketIndex: 0 }, actor).error.code, 'stale_revision');
assert.equal(evaluateAuthorityCraft('craft_recipe', { ...authority, processedRequestIds: ['replay'] }, { requestId: 'replay', itemRevision: 4, recipeId: 'add_socket', socketIndex: 0 }, actor).error.code, 'duplicate_request');
assert.equal(evaluateAuthorityCraft('craft_recipe', { ...authority, item: { ...authority.item, owner_user_id: '44444444-4444-4444-4444-444444444444' } }, { requestId: 'steal', itemRevision: 4, recipeId: 'add_socket', socketIndex: 0 }, actor).error.code, 'not_owner');
const crafted = evaluateAuthorityCraft('craft_recipe', authority, { requestId: 'add', itemRevision: 4, recipeId: 'add_socket', socketIndex: 0 }, actor);
assert.deepEqual(crafted.costs, { alloy: 60, materials: { alloy_shard: 3, phase_flux: 1 } });
assert.match(economy, /socketComponentMods\(equipped\)/);
assert.match(game, /camp\?\.socketMods/);

// Stateful transaction model: exercise the same proposal contract across
// multiple calls so the checks prove rollback/replay behavior, not just one
// pure evaluator result.
const ledger = { alloy: 500, materials: { alloy_shard: 10, phase_flux: 5 }, revision: 4, sockets: authority.item.sockets, loose: new Set([componentId]), processed: new Map() };
const commit = (proposal) => {
  if (ledger.processed.has(proposal.requestId)) return { ...ledger.processed.get(proposal.requestId), duplicate: true };
  if (proposal.mutation.expectedRevision !== ledger.revision) throw new Error('stale_revision');
  if (ledger.alloy < proposal.costs.alloy) throw new Error('insufficient_funds');
  for (const [id, quantity] of Object.entries(proposal.costs.materials)) if ((ledger.materials[id] || 0) < quantity) throw new Error('insufficient_materials');
  ledger.alloy -= proposal.costs.alloy;
  for (const [id, quantity] of Object.entries(proposal.costs.materials)) ledger.materials[id] -= quantity;
  for (const component of proposal.mutation.components.consume) assert.equal(ledger.loose.delete(component.instanceId), true);
  for (const component of proposal.mutation.components.return) ledger.loose.add(component.instanceId);
  ledger.revision = proposal.mutation.nextRevision; ledger.sockets = proposal.item.sockets;
  const result = { revision: ledger.revision, alloy: ledger.alloy }; ledger.processed.set(proposal.requestId, result); return result;
};
const insertCommit = commit(inserted);
assert.equal(ledger.loose.has(componentId), false, 'insert consumes component');
assert.deepEqual(commit(inserted), { ...insertCommit, duplicate: true }, 'replay returns the prior result without a second mutation');
assert.equal(ledger.alloy, 500, 'zero-cost replay must leave Alloy unchanged');
assert.throws(() => commit({ ...crafted, mutation: { ...crafted.mutation, expectedRevision: 4 } }), /stale_revision/);
assert.equal(ledger.materials.alloy_shard, 10, 'stale craft must roll back materials');
const removeCommit = evaluateAuthorityCraft('socket_remove', { ...authority, item: { ...authority.item, revision: ledger.revision, sockets: ledger.sockets }, componentInventoryCount: 0 }, { requestId: 'return-live', itemRevision: ledger.revision, socketIndex: 0 }, actor);
commit(removeCommit);
assert.equal(ledger.loose.has(componentId), true, 'remove returns the same component instance');

const makeResponse = () => ({ status: 0, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); }, setHeader() {} });
const makeRequest = (body) => ({ method: 'POST', headers: { authorization: 'Bearer player' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } });
process.env.SUPABASE_URL = 'https://zillions.invalid';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
const originalFetch = globalThis.fetch;
const stored = { ok: true, duplicate: false, character: { revision: 8 }, wallet: { balance: 377 }, items: [], materials: {}, components: [] };
let unexpectedAuthorityRead = false;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: actor }) };
  if (target.includes('/game_characters?')) return { ok: true, json: async () => ([{ id: '55555555-5555-5555-5555-555555555555', revision: 8 }]) };
  if (target.includes('/economy_requests?')) return { ok: true, json: async () => ([{ request_id: 'same-request', response_payload: stored }]) };
  unexpectedAuthorityRead = true; return { ok: false, json: async () => ({}) };
};
const replayResponse = makeResponse();
await handler(makeRequest({ action: 'craft_recipe', requestId: 'same-request', characterId: 'char-1', itemId, itemRevision: 4, recipeId: 'add_socket' }), replayResponse);
assert.equal(replayResponse.status, 200);
assert.deepEqual(replayResponse.body, { ...stored, duplicate: true }, 'completed replay must return the stored exact result');
assert.equal(unexpectedAuthorityRead, false, 'completed replay must not re-read or mutate authority state');
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: actor }) };
  if (target.includes('/game_characters?')) return { ok: true, json: async () => ([{ id: '55555555-5555-5555-5555-555555555555', revision: 8 }]) };
  if (target.includes('/economy_requests?')) return { ok: true, json: async () => ([{ request_id: 'busy-request', response_payload: null }]) };
  return { ok: false, json: async () => ({}) };
};
const busyResponse = makeResponse();
await handler(makeRequest({ action: 'craft_recipe', requestId: 'busy-request', characterId: 'char-1', itemId, itemRevision: 4, recipeId: 'add_socket' }), busyResponse);
assert.equal(busyResponse.status, 409);
assert.equal(busyResponse.body.error, 'request_in_progress');
globalThis.fetch = originalFetch;
console.log('crafting-authority-check: authority, replay, revisions, ownership, debits, components, provenance, and stats hold');
