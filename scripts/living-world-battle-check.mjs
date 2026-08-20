import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signBattleAssignment, validateBattleResult, verifyBattleAssignment } from '../src/living-world-battle.js';
import { createLivingWorldBattleHandler } from '../api/living-world-battle.js';
import { readFileSync } from 'node:fs';

const ids = { assignment: randomUUID(), engagement: randomUUID(), encounter: randomUUID(), party: randomUUID(), stack: randomUUID() };
const secret = 's'.repeat(48), authoritySecret = 'a'.repeat(48);
const assignment = { id: ids.assignment, engagement_id: ids.engagement, encounter_id: ids.encounter, encounter_revision: 7, nonce: randomUUID(), expires_at: new Date(Date.now() + 60_000).toISOString() };
const token = signBattleAssignment(assignment, secret);
assert.equal(verifyBattleAssignment(token, secret).encounterRevision, 7);
assert.throws(() => verifyBattleAssignment(`${token}x`, secret), /invalid_battle_assignment/);
assert.throws(() => verifyBattleAssignment(signBattleAssignment({ ...assignment, expires_at: new Date(0).toISOString() }, secret), secret), /expired/);

const result = validateBattleResult({ outcome: 'attacker_victory', winnerPartyId: ids.party, casualties: [{ stackId: ids.stack, killed: 2, wounded: 3 }], morale: { attacker: 75, defender: 20 }, cargoTransfers: [], prisoners: [], retreatRoutes: [], stateHash: 'a'.repeat(64), completedTick: 44 });
assert.equal(result.casualties[0].wounded, 3);
assert.throws(() => validateBattleResult({ ...result, casualties: [{ stackId: ids.stack, killed: -1, wounded: 0 }] }), /invalid_casualties/);

function response() { return { status: 0, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } }; }
async function request(handler, body, headers = {}) { const req = { method: 'POST', headers, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } }; const res = response(); await handler(req, res); return res; }
let commits = 0;
const handler = createLivingWorldBattleHandler({ config: { url: 'x', anonKey: 'x', serviceKey: 'x', signingSecret: secret, authoritySecret }, authenticate: async () => ({ id: randomUUID() }), issue: async () => assignment, commit: async (claim, submitted) => { commits += 1; assert.equal(claim.assignmentId, ids.assignment); assert.equal(submitted.stateHash, result.stateHash); return { ok: true }; } });
const launched = await request(handler, { action: 'launch', engagementId: ids.engagement, encounterRevision: 7, requestId: 'launch-1' }, { authorization: 'Bearer user' });
assert.equal(launched.status, 200); assert.ok(launched.body.token);
const rejected = await request(handler, { action: 'result', assignmentToken: token, result }, {});
assert.equal(rejected.status, 401); assert.equal(commits, 0);
const accepted = await request(handler, { action: 'result', assignmentToken: token, result }, { 'x-zillions-battle-authority': authoritySecret });
assert.equal(accepted.status, 200); assert.equal(commits, 1);
const migration = readFileSync(new URL('../supabase/migrations/20260820190000_living_world_battle_authority.sql', import.meta.url), 'utf8');
const commitBody = migration.slice(migration.indexOf('create or replace function public.living_world_commit_battle'));
assert.ok(commitBody.indexOf("pg_advisory_xact_lock(hashtextextended('world-shard:'") < commitBody.indexOf('where id=p_assignment for update'), 'battle commit must acquire the shard lock before aggregate locks');
assert.ok(commitBody.indexOf('where id=p_assignment for update') < commitBody.indexOf('select coalesce(max(sequence),0)+1'), 'assignment must be locked before event sequence allocation');
console.log('living world battle authority checks passed');
