import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAuthoritativeEvent, movementDuration, validateWorldCommand } from '../src/living-world.js';
import { evaluatePursuit, rearguardEstimate, resolveAutosimRound } from '../src/world-encounter.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260820173000_living_world_authority.sql');
for (const marker of ['world_shards', 'world_provinces', 'world_locations', 'world_routes', 'world_parties',
  'world_unit_stacks', 'world_cargo', 'world_markets', 'world_movement_orders', 'world_scouting_reports',
  'world_pursuits', 'world_encounters', 'world_engagements', 'world_battle_rounds', 'world_battle_results',
  'world_commands', 'world_events', 'living_world_command']) assert.match(migration, new RegExp(marker), `${marker} missing`);
assert.match(migration, /primary key\s*\(shard_id,\s*actor_user_id,\s*request_id\)/);
assert.match(migration, /expected_revision/);
assert.match(migration, /v_existing\.expected_revision<>p_expected_revision/, 'idempotency identity must bind the expected revision');
assert.match(migration, /p_type not in\(/, 'the RPC must whitelist command types');
assert.match(migration, /jsonb_typeof\(p_payload\)<>'object'/, 'the RPC must require an object payload');
assert.match(migration, /insert into public\.world_commands\(shard_id,actor_user_id,request_id/, 'command inserts need an explicit column list');
assert.match(migration, /world-shard:[\s\S]*world-command:/, 'lock order must be shard then command');
assert.match(migration, /shard_not_found/, 'commands must reject unknown shards');
assert.match(migration, /shard lock serializes sequence allocation/, 'event allocation must be serialized by the shard lock');
assert.match(migration, /service_role_required/);
assert.match(migration, /enable row level security/);

const command = { type: 'issue_movement', requestId: 'req-1', shardId: 'earth-1', partyId: 'party-1', expectedRevision: 1 };
assert.equal(validateWorldCommand(command), true);
assert.throws(() => validateWorldCommand({ ...command, expectedRevision: 0 }), /invalid_revision/);
assert.equal(movementDuration({ distance: 100 }, { speed: 10, cargoWeight: 0, cargoCapacity: 100, fatigue: 0 }), 10);
const pursuitA = evaluatePursuit({ pursuer: { speed: 8, scouting: 4 }, caught: { speed: 6, scouting: 2 }, seed: 'p1' });
const pursuitB = evaluatePursuit({ pursuer: { speed: 8, scouting: 4 }, caught: { speed: 6, scouting: 2 }, seed: 'p1' });
assert.deepEqual(pursuitA, pursuitB, 'pursuits must replay deterministically');
assert.equal(rearguardEstimate({ troops: 100 }, { troops: 80 }, 'plains', 0.2).escapingTroops, 80);
const battleArgs = { engagementId: 'eng-1', round: 1, seed: 'battle', attacker: { troops: 100, quality: 1, morale: 50, supplies: 50 }, defender: { troops: 100, quality: 1, morale: 50, supplies: 50 } };
const battleA = resolveAutosimRound(battleArgs);
const battleB = resolveAutosimRound(battleArgs);
assert.deepEqual(battleA, battleB, 'battle replay must be deterministic');
const once = applyAuthoritativeEvent({ sequence: 0 }, { id: 'evt-1', sequence: 1 });
assert.equal(applyAuthoritativeEvent(once, { id: 'evt-1', sequence: 1 }).duplicate, true);
assert.throws(() => applyAuthoritativeEvent({ sequence: 0 }, { id: 'evt-2', sequence: 2 }), /event_sequence_gap/);
console.log('living world authority check passed');
