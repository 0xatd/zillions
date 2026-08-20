import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20260820203000_earth_region_topology.sql', import.meta.url),
  'utf8',
);

// The world hierarchy must stay content-driven. Earth is the first planet, not
// an authority boundary baked into workers or parties.
for (const marker of [
  'world_universes',
  'world_star_systems',
  'world_planets',
  'world_provinces',
  'world_locations',
  'world_routes',
]) {
  assert.match(sql, new RegExp(`(?:create|alter) table public\\.${marker}`), `${marker} topology is missing`);
}
assert.match(sql, /world_star_systems[\s\S]*universe_id text not null references public\.world_universes\(id\)/, 'systems must belong to a universe');
assert.match(sql, /world_planets[\s\S]*system_id text not null references public\.world_star_systems\(id\)/, 'planets must belong to a system');
assert.match(sql, /world_provinces[\s\S]*add column planet_id text references public\.world_planets\(id\)/, 'regions must belong to a planet');
assert.match(sql, /world_provinces alter column planet_id set not null/, 'region planet identity must fail closed');

// Faction control is authoritative state, not only a map color.
assert.match(sql, /create table public\.world_factions[\s\S]*planet_id text not null references public\.world_planets\(id\)/, 'factions must belong to a planet');
for (const table of ['world_provinces', 'world_locations']) {
  assert.match(sql, new RegExp(`alter table public\\.${table}[\\s\\S]*claimed_by_faction_id[\\s\\S]*garrison_strength[\\s\\S]*unrest[\\s\\S]*control_state[\\s\\S]*siege_state`), `${table} must expose complete faction control state`);
  assert.match(sql, new RegExp(`update public\\.${table} set claimed_by_faction_id=owner_faction_id`), `${table} must preserve existing faction ownership`);
}
assert.match(sql, /alter table public\.world_routes[\s\S]*owner_faction_id[\s\S]*claimed_by_faction_id[\s\S]*control_strength[\s\S]*control_state[\s\S]*blockade_state/, 'routes must expose faction and blockade control');
assert.match(sql, /create table public\.world_region_control_history[\s\S]*previous_owner_faction_id[\s\S]*owner_faction_id[\s\S]*cause text not null[\s\S]*world_tick bigint not null/, 'ownership changes must retain causal world history');

// A primary key on region_id is the database-level exclusivity guarantee: two
// workers cannot hold independent lease rows for one region.
assert.match(sql, /create table public\.world_region_worker_leases\s*\(\s*region_id uuid primary key/, 'region leases must be exclusive');
assert.match(sql, /world_region_worker_leases[\s\S]*worker_id text not null[\s\S]*lease_epoch bigint not null[\s\S]*lease_until timestamptz not null/, 'region leases must identify and fence workers');
assert.match(sql, /claim_world_region_lease\(p_region uuid,p_worker text,p_lease_seconds integer default 30\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\('world-region:'\|\|p_region::text,0\)\)/, 'lease claims must serialize on the region');
assert.match(sql, /world_region_states where region_id=p_region and status='active' for update[\s\S]*region_not_active/, 'lease claims must lock and require an active region');
assert.match(sql, /v_lease\.worker_id<>p_worker and v_lease\.lease_until>now\(\)[\s\S]*'status','lease_held'/, 'an unexpired foreign lease must be rejected');
assert.match(sql, /lease_epoch=case when world_region_worker_leases\.worker_id=excluded\.worker_id then world_region_worker_leases\.lease_epoch else world_region_worker_leases\.lease_epoch\+1 end/, 'worker changes must advance the fencing epoch');
assert.match(sql, /revoke all on function public\.claim_world_region_lease\(uuid,text,integer\) from public,anon,authenticated/, 'clients must not claim region leases');
assert.match(sql, /grant execute on function public\.claim_world_region_lease\(uuid,text,integer\) to service_role/, 'only service workers may claim region leases');

// Handoffs must be unique, serialized, replay-safe, and applied in one database
// function so a party cannot disappear or exist in both regions.
assert.match(sql, /unique \(party_id,request_id\)/, 'handoff requests need an idempotency key');
assert.match(sql, /create unique index world_region_handoff_one_pending on public\.world_region_handoffs\(party_id\) where status='pending'/, 'a party may have only one pending handoff');
assert.match(sql, /request_world_region_handoff\(p_party uuid,p_route uuid,p_request_id text,p_expected_revision bigint,p_payload jsonb default '\{\}'\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\('world-region-handoff:'\|\|p_party::text,0\)\)/, 'handoff creation must serialize requests for each party');
assert.match(sql, /v_existing\.route_id<>p_route or v_existing\.expected_party_revision<>p_expected_revision or v_existing\.payload<>p_payload[\s\S]*idempotency_conflict/, 'request-key reuse with different input must fail closed');
assert.match(sql, /request_world_region_handoff[\s\S]*world_parties where id=p_party for update/, 'handoff creation must lock the party');
assert.match(sql, /v_route\.origin_region_id<>v_party\.region_id or v_party\.route_id<>v_route\.id[\s\S]*invalid_cross_region_route/, 'handoff creation must validate authoritative route state');
assert.match(sql, /complete_world_region_handoff\(p_handoff uuid,p_worker text\)[\s\S]*where id=p_handoff for update/, 'handoff completion must lock its request');
assert.match(sql, /v_handoff\.status='accepted'[\s\S]*'duplicate',true/, 'accepted handoff replay must be harmless');
assert.match(sql, /world_region_worker_leases where region_id=v_handoff\.destination_region_id for update/, 'handoff completion must lock the destination lease');
assert.match(sql, /world_parties where id=v_handoff\.party_id for update/, 'handoff completion must lock the party');
assert.match(sql, /v_party\.region_id<>v_handoff\.source_region_id or v_party\.revision<>v_handoff\.expected_party_revision[\s\S]*stale_handoff/, 'handoffs must reject stale party state');
assert.match(sql, /update public\.world_parties set region_id=v_handoff\.destination_region_id[\s\S]*update public\.world_region_handoffs set status='accepted'/, 'party transfer and handoff acceptance must share one transaction');

for (const failure of ['service_role_required', 'invalid_handoff_request', 'idempotency_conflict', 'stale_party', 'invalid_cross_region_route', 'handoff_not_found', 'handoff_not_pending', 'destination_lease_required', 'stale_handoff', 'invalid_destination']) {
  assert.match(sql, new RegExp(`raise exception '${failure}'`), `handoff must fail closed with ${failure}`);
}
assert.match(sql, /security definer set search_path=public,pg_temp/, 'privileged handoff must use a fixed search path');
assert.match(sql, /revoke all on function public\.request_world_region_handoff\(uuid,uuid,text,bigint,jsonb\) from public,anon,authenticated/, 'clients must not request worker handoffs directly');
assert.match(sql, /revoke all on function public\.complete_world_region_handoff\(uuid,text\) from public,anon,authenticated/, 'clients must not execute handoffs');
assert.match(sql, /grant execute on function public\.complete_world_region_handoff\(uuid,text\) to service_role/, 'only service workers may complete handoffs');

for (const table of ['world_universes', 'world_star_systems', 'world_planets', 'world_factions', 'world_region_states', 'world_region_worker_leases', 'world_region_control_history', 'world_region_handoffs']) {
  assert.match(sql, new RegExp(`alter table public\\.%I enable row level security[\\s\\S]*${table}|array\\[.*'${table}'`), `${table} must be covered by RLS`);
}
assert.match(sql, /world_region_handoffs_owner_read[\s\S]*p\.owner_user_id=auth\.uid\(\)/, 'players may read only handoffs for their own parties');

console.log('earth region authority check passed');
