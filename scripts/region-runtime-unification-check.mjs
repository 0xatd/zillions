import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLivingWorldWorkerHandler } from '../api/living-world-worker.js';

const sql=readFileSync(new URL('../supabase/migrations/20260820233000_region_runtime_unification.sql',import.meta.url),'utf8');
assert.match(sql,/living_world_process_shard[\s\S]*shard_worker_retired/,'legacy shard authority must fail closed');
assert.match(sql,/revoke all on function public\.living_world_process_shard[\s\S]*service_role/,'service workers must not retain shard mutation authority');
assert.match(sql,/process_world_region_runtime[\s\S]*world_region_worker_leases[\s\S]*lease_epoch<>p_lease_epoch/,'runtime must fence every region incarnation');
assert.match(sql,/world_commands c join public\.world_parties p[\s\S]*p\.region_id=p_region[\s\S]*for update of c skip locked/,'runtime may drain only commands owned by its region');
assert.match(sql,/living_world_process_region\(p_region,p_worker,p_lease_epoch/,'faction simulation must run inside the region runtime');
assert.match(sql,/process_world_region_logistics\(p_region,v_tick,p_worker,p_lease_epoch/,'logistics must run inside the same leased runtime');
assert.match(sql,/request_world_region_handoff/,'cross-region departure must create a durable handoff');
assert.match(sql,/complete_world_region_handoff/,'the destination region must complete the durable handoff');
assert.doesNotMatch(sql,/random\s*\(/i,'runtime state changes must remain deterministic');

const response=()=>({status:0,writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);},setHeader(){}});
const handler=createLivingWorldWorkerHandler({secret:'cron',config:{url:'https://example.invalid',serviceKey:'test'},workerId:'qa-worker',regions:async()=>[{region_id:'region-a'}],claim:async()=>({ok:true,leaseEpoch:4}),process:async(region,worker,epoch)=>({region,worker,epoch,tick:9})});
let res=response();await handler({method:'GET',headers:{authorization:'Bearer wrong'}},res);assert.equal(res.status,401);
res=response();await handler({method:'GET',headers:{authorization:'Bearer cron'}},res);assert.equal(res.status,200);assert.equal(res.body.regions[0].result.tick,9);
console.log('region runtime unification checks passed');
