import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260820180000_earth_bootstrap_social_parties.sql', import.meta.url), 'utf8');
for (const marker of ['social_parties','social_party_members','social_party_invites','social_party_requests','social_party_command','world_tutorial_progress','record_world_tutorial_step','enter_living_world']) {
  assert.match(sql,new RegExp(marker),`${marker} missing`);
}
assert.match(sql,/coalesce\(auth\.role\(\),'\'\)<>'service_role'/,'write RPCs must require service role');
assert.match(sql,/movement_complete and town_complete and recruitment_complete and trade_complete and battle_complete/,'all tutorial evidence must be required');
assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('world-entry:'/,'world entry must serialize retries');
assert.match(sql,/if v_progress\.world_party_id is not null then[\s\S]*'duplicate',true/,'world entry must be idempotent');
assert.match(sql,/revoke all on function public\.enter_living_world\(uuid,uuid\) from public,anon,authenticated/,'clients must not call world entry directly');
assert.match(sql,/create policy social_parties_member_read/);
assert.match(sql,/create policy world_tutorial_progress_self_read/);
for (const id of ['earth-1','greenfall-crossing','ironwood','rotmire-watch','reedwater','Greenfall Road Wardens','Ironwood Caravan','Rotmire Reavers']) assert.match(sql,new RegExp(id));
assert.match(sql,/on conflict\(location_id,commodity_key\) do nothing/,'replay must not reset live markets');
assert.match(sql,/Rotmire Reavers[\s\S]*on conflict\(id\) do nothing/,'replay must not reset moving AI parties');
assert.match(sql,/idempotency_conflict/,'social party commands must bind retries');
assert.match(sql,/unique \(user_id\)/,'a player must have at most one active social party membership');
assert.doesNotMatch(sql,/grant (insert|update|delete)/i,'clients must not receive direct write grants');
console.log('earth bootstrap and party model check passed');
