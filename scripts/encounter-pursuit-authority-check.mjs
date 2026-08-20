import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENCOUNTER_CHOICES } from '../src/living-world.js';

const sql = readFileSync(new URL('../supabase/migrations/20260820214500_encounter_pursuit_authority.sql', import.meta.url), 'utf8');
for (const choice of ['fight','auto-command','surrender','parley','escape','diversion','rearguard','fortify','call-allies','scatter']) {
  assert(ENCOUNTER_CHOICES.includes(choice), `${choice} must cross the API boundary`);
  assert(sql.includes(`'${choice}'`), `${choice} must be enforced by authority`);
}
for (const response of ['press-attack','demand-surrender','accept-payment','grant-safe-passage','pursue-main-force','engage-rearguard','take-prisoners-and-release','disengage']) assert(sql.includes(`'${response}'`), `${response} response must be enforced`);
for (const marker of ['world_encounter_decisions','submit_world_encounter_decision','stale_encounter','idempotency_conflict','region_lease_required','choice_unavailable','tacticalPending']) assert(sql.includes(marker), `${marker} missing`);
assert.match(sql, /world_encounters where id=p_encounter for update/, 'decision must lock encounter');
assert.match(sql, /world_region_worker_leases where region_id=me\.region_id for update/, 'decision must fence the region worker');
assert.match(sql, /hashtextextended\(p_encounter::text\|\|':'\|\|e\.attacker_choice/, 'resolution must derive its roll from durable identity and choices');
assert.match(sql, /revoke all on function public\.submit_world_encounter_decision[\s\S]*from public,anon,authenticated/, 'clients must not call authority RPC');
console.log('encounter pursuit authority checks passed');
