import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const names = ['20260820180000_earth_bootstrap_social_parties.sql','20260820203000_earth_region_topology.sql','20260820210100_player_company.sql','20260820214500_encounter_pursuit_authority.sql','20260820230000_siege_governance.sql'];
const contract = (await Promise.all(names.map((name) => readFile(path.join(root, 'supabase/migrations', name), 'utf8')))).join('\n');
for (const marker of ['enter_living_world','world_region_worker_leases','world_companies','world_encounter_decisions','world_sieges']) assert.match(contract, new RegExp(marker), `${marker} must exist in the Greenfall authority stack`);
for (const step of ['movement_complete','town_complete','recruitment_complete','trade_complete','battle_complete']) assert.match(contract, new RegExp(step));
assert.match(await readFile(path.join(root, 'api/living-world-operations.js'), 'utf8'), /x-admin-secret/);
console.log('Greenfall vertical-slice contract checks passed');
