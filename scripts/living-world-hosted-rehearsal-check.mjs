import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const script=path.join(root,'scripts/living-world-hosted-rehearsal.mjs');
const source=await readFile(script,'utf8');
const run=env=>spawnSync(process.execPath,[script],{cwd:root,env:{PATH:process.env.PATH,...env},encoding:'utf8'});

let result=run({});
assert.notEqual(result.status,0);assert.match(result.stderr,/LIVING_WORLD_HOSTED_REHEARSAL=I_UNDERSTAND_ISOLATED_BRANCH_ONLY/);
result=run({LIVING_WORLD_HOSTED_REHEARSAL:'I_UNDERSTAND_ISOLATED_BRANCH_ONLY',EXPECTED_SUPABASE_BRANCH_REF:'skqggyvkblqtyggtcxbc',DATABASE_URL:'postgresql://postgres.skqggyvkblqtyggtcxbc:x@aws-0.pooler.supabase.com/postgres?sslmode=require'});
assert.notEqual(result.status,0);assert.match(result.stderr,/production project ref is permanently denied/);
result=run({LIVING_WORLD_HOSTED_REHEARSAL:'I_UNDERSTAND_ISOLATED_BRANCH_ONLY',EXPECTED_SUPABASE_BRANCH_REF:'branchref123',DATABASE_URL:'postgresql://postgres.branchref123:x@aws-0.pooler.supabase.com/postgres?sslmode=disable'});
assert.notEqual(result.status,0);assert.match(result.stderr,/TLS cannot be disabled/);
for(const marker of ["to_regclass('supabase_migrations.schema_migrations')",'!applied.has(migration.version)','await q(\'begin\')','await q(\'rollback\')','assert.deepEqual(rollbackState,preState','materialize_world_manifest','complete_world_tutorial_from_campaign','enter_living_world','living_world_trade_market','claim_world_region_lease','record_world_region_runtime_health',"regions.length,72",'living_world_issue_battle','autosimBattleAssignment','living_world_commit_battle','battleWriteback:true','postActivationRollbackPlan'])assert.ok(source.includes(marker),`missing hosted rehearsal gate: ${marker}`);
console.log('living-world hosted rehearsal safety checks passed');
