import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20260820210000_earth_faction_ai.sql',import.meta.url),'utf8');

for(const goal of ['patrol','trade','raid','reinforce','pursue','defend','siege_prepare']) assert.match(sql,new RegExp(`'${goal}'`),`missing ${goal}`);
assert.match(sql,/world_faction_region_states[\s\S]*ownership_pressure[\s\S]*evaluated_tick/,'faction goals must retain visible causal state');
assert.match(sql,/enforce_world_faction_region_state_scope[\s\S]*f\.planet_id=p\.planet_id[\s\S]*l\.province_id=new\.region_id[\s\S]*before insert or update/,'faction state ownership and targets must remain inside the region planet');
assert.match(sql,/strategic_intent text[\s\S]*strategic_reason text[\s\S]*strategic_target_location_id/,'army intent must be visible');
assert.match(sql,/hashtextextended\(v_party\.id::text\|\|':'\|\|v_state\.simulation_tick::text,0\)/,'goal selection must derive from stable identity and authoritative tick');
assert.doesNotMatch(sql,/abs\s*\(\s*hashtextextended/i,'deterministic hashing must not overflow on signed bigint edge cases');
assert.doesNotMatch(sql,/\brandom\s*\(|clock_timestamp\s*\(/i,'faction simulation must not use nondeterministic inputs');
assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('world-region:'\|\|p_region::text,0\)\)[\s\S]*world_region_states where region_id=p_region for update[\s\S]*world_region_worker_leases where region_id=p_region for update/,'region state and lease must be serialized');
assert.match(sql,/v_lease\.worker_id<>p_worker or v_lease\.lease_epoch<>p_lease_epoch[\s\S]*v_lease\.lease_until<=now\(\)[\s\S]*stale_region_lease/,'worker id, epoch, and expiry must all fence writes');
assert.match(sql,/world_parties p[\s\S]*p\.region_id=p_region and p\.owner_user_id is null[\s\S]*p\.owner_faction_id is not null/,'only faction-owned server parties in the leased region may be simulated');
assert.match(sql,/f\.id=p\.owner_faction_id and f\.planet_id=owned_region\.planet_id/,'AI must reject cross-planet faction ownership');
assert.match(sql,/order by mod\(mod\(hashtextextended\(p\.id::text\|\|':'\|\|v_state\.simulation_tick::text,0\)/,'bounded ticks must rotate the deterministic army work set');
assert.match(sql,/not exists\(select 1 from public\.world_movement_orders where party_id=v_party\.id and status in \('queued','moving'\)\)/,'AI must not create duplicate active movement');
assert.match(sql,/values\(md5\(v_party\.id::text\|\|':'\|\|v_route\.id::text\|\|':'\|\|v_state\.simulation_tick::text\)::uuid/,'AI movement identity must replay deterministically');
assert.match(sql,/r\.origin_region_id=p_region and r\.destination_region_id=p_region[\s\S]*expected_arrival_tick>v_state\.simulation_tick\+1/,'only local-region movement may advance directly');
assert.match(sql,/expected_arrival_tick<=v_state\.simulation_tick\+1[\s\S]*status='arrived'[\s\S]*location_id=v_route\.destination_id/,'completed local movement must arrive deterministically');
assert.match(sql,/world_region_states set simulation_tick=simulation_tick\+1/,'a successful call advances exactly one region tick');
assert.match(sql,/revoke all on function public\.living_world_process_region[\s\S]*grant execute[\s\S]*service_role/,'clients must not run faction simulation');
assert.match(sql,/region\.faction_tick/,'each faction tick must be auditable');

console.log('earth faction AI check passed');
