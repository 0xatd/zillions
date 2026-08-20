import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260820190000_living_world_worker.sql', import.meta.url), 'utf8');
for (const marker of ['world_worker_leases','world_battle_orders','living_world_process_shard','command.queued','command.applied','issue_movement','cancel_movement','set_encounter_choice','submit_battle_order','accept_surrender','trade_market'])
  assert.match(sql, new RegExp(marker), `${marker} missing from worker migration`);
assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('world-shard:'\|\|p_shard/, 'worker must take the shared shard lock');
assert.match(sql, /lease_until>now\(\)/, 'worker must honor an unexpired foreign lease');
assert.match(sql, /completed_at is null[\s\S]*for update skip locked/, 'worker must claim only pending commands');
assert.match(sql, /order by created_at,actor_user_id,request_id/, 'command ordering must be stable');
assert.match(sql, /exception when others[\s\S]*status','rejected'/, 'one invalid command must not abort the shard tick');
assert.match(sql, /simulation_tick=simulation_tick\+1/, 'successful calls must advance exactly one tick');
assert.match(sql, /expected_arrival_tick<=v_shard\.simulation_tick\+1/, 'arrival must use simulation time');
assert.match(sql, /greatest\(0,s\.quantity-s\.consumption_per_tick\)/, 'supply consumption must remain non-negative');
assert.match(sql, /salvage_alloy=salvage_alloy-v_cost/, 'market buys must debit authoritative currency');
assert.match(sql, /quantity-reserved_quantity>=v_quantity/, 'market sells must preserve reserved cargo');
assert.match(sql, /unsupported_surrender_terms/, 'unimplemented surrender transfers must fail closed');
assert.doesNotMatch(sql, /'sqlstate',sqlstate/, 'actor-readable responses must not expose database details');
assert.doesNotMatch(sql, /random\s*\(/i, 'worker state changes must not depend on database RNG');
assert.doesNotMatch(sql, /extract\s*\(epoch/i, 'world progress must not depend on wall-clock deltas');
console.log('living world worker check passed');
