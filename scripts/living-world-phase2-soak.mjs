import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import EmbeddedPostgres from 'embedded-postgres';
import {earthManifest} from '../src/world-manifest.js';import {buildWorldMaterialization} from '../src/world-materialization.js';

const root=path.resolve(import.meta.dirname,'..');
const databaseDir=await mkdtemp(path.join(os.tmpdir(),'zillions-phase2-soak-'));
const postgres=new EmbeddedPostgres({databaseDir,port:31000+Math.floor(Math.random()*1000),user:'postgres',password:'postgres',persistent:false,onLog(){}});let admin;
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const roleCounts=async()=>Object.fromEntries((await admin.query("select strategic_role,count(*)::integer count from public.world_parties where shard_id='earth-1' and owner_user_id is null group by strategic_role order by strategic_role")).rows.map(row=>[row.strategic_role,Number(row.count)]));
try{
  await postgres.initialise();await postgres.start();admin=postgres.getPgClient();await admin.connect();
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.rooms(id uuid primary key default gen_random_uuid(),max_players integer not null default 2 check(max_players between 1 and 2));create table public.room_players(room_id uuid not null references public.rooms(id),user_id uuid not null references auth.users(id),seat integer not null check(seat between 1 and 2),primary key(room_id,user_id));create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;`);
  for(const name of(await readdir(path.join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort())await admin.query(await readFile(path.join(root,'supabase/migrations',name),'utf8'));
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const manifest=earthManifest(),bundle=buildWorldMaterialization(manifest);
  await admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6)',[manifest.planetId,manifest.schema,manifest.generatorVersion,manifest.seed,manifest.contentHash,manifest]);
  await admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,bundle]);
  assert.equal(Number((await admin.query("select count(*) count from public.world_parties where shard_id='earth-1' and owner_user_id is null")).rows[0].count),432);
  assert.deepEqual(await roleCounts(),{caravan:72,garrison:72,patrol:72,raider:72,scout:72,siege_force:72});
  assert.equal(Number((await admin.query('select count(*) count from public.world_routes where origin_region_id=destination_region_id')).rows[0].count),0,'the soak must prove movement on the cross-region-only Earth graph');

  const regions=(await admin.query("select id from public.world_provinces where planet_id='earth' order by id")).rows.map(row=>row.id);
  await admin.query("update public.world_region_states set status='active' where region_id=any($1::uuid[])",[regions]);
  const leases=new Map();for(const region of regions){const result=(await admin.query("select public.claim_world_region_lease($1,'phase2-soak',300) result",[region])).rows[0].result;leases.set(region,Number(result.leaseEpoch));}

  // Prove deterministic replenishment and retirement before the load run.
  const densityRegion=regions[0];
  const removed=(await admin.query("delete from public.world_parties where region_id=$1 and strategic_role='scout' returning id",[densityRegion])).rows[0].id;
  const replenish=(await admin.query('select public.reconcile_world_region_population($1,1) result',[densityRegion])).rows[0].result;
  assert.equal(Number(replenish.inserted),1);assert.equal(Number(replenish.observed),6);
  assert.equal((await admin.query('select count(*)::integer count from public.world_parties where id=$1',[removed])).rows[0].count,1);
  await admin.query(`insert into public.world_parties(id,shard_id,region_id,home_region_id,owner_faction_id,name,kind,location_id,strategic_role)
    select 'ffffffff-ffff-4fff-8fff-ffffffffffff','earth-1',p.id,p.id,p.owner_faction_id,'Congestion Probe','ai',l.id,'patrol'
    from public.world_provinces p join public.world_locations l on l.province_id=p.id and l.is_region_seat where p.id=$1`,[densityRegion]);
  const retire=(await admin.query('select public.reconcile_world_region_population($1,2) result',[densityRegion])).rows[0].result;
  assert.equal(Number(retire.retired),1);assert.equal(Number(retire.observed),6);

  const latencies=[];let errors=0;const started=performance.now();
  for(let round=0;round<24;round++)for(const region of regions){const tickStart=performance.now();try{
    const result=(await admin.query("select public.process_world_region_runtime($1,'phase2-soak',$2,100) result",[region,leases.get(region)])).rows[0].result;
    assert.ok(Number(result.actionBudget)<=8);assert.equal(result.population.state,'healthy');
  }catch(error){errors++;throw error;}finally{latencies.push(performance.now()-tickStart);}}
  const elapsed=performance.now()-started,p95=percentile(latencies,.95),max=percentile(latencies,1);
  assert.equal(errors,0);assert.ok(p95<250,`region runtime p95 ${p95.toFixed(1)}ms exceeds 250ms`);assert.ok(elapsed<60000,`24-tick soak ${elapsed.toFixed(1)}ms exceeds 60s`);
  const tickSpread=(await admin.query("select min(simulation_tick)::integer min,max(simulation_tick)::integer max from public.world_region_states where region_id=any($1::uuid[])",[regions])).rows[0];
  assert.equal(Number(tickSpread.max)-Number(tickSpread.min),0,'worker lag must remain zero after a complete planet sweep');
  assert.equal(Number((await admin.query("select count(*) count from public.world_population_observations where population_state<>'healthy'")).rows[0].count),0);
  const total=Number((await admin.query("select count(*) count from public.world_parties where shard_id='earth-1' and owner_user_id is null")).rows[0].count);
  assert.ok(total>=300&&total<=500);assert.equal(total,432);
  assert.ok(Number((await admin.query("select count(*) count from public.world_movement_orders where status in('moving','arrived')")).rows[0].count)>0,'AI movement orders missing');
  assert.ok(Number((await admin.query("select count(*) count from public.world_region_handoffs where status='accepted'")).rows[0].count)>0,'cross-region handoffs missing');
  assert.ok(Number((await admin.query('select count(*) count from public.world_pursuits')).rows[0].count)>0,'pursuit actions missing');
  assert.ok(Number((await admin.query('select count(*) count from public.world_sieges')).rows[0].count)>0,'siege actions missing');
  assert.ok(Number((await admin.query('select count(*) count from public.world_raid_orders')).rows[0].count)>0,'raid actions missing');
  assert.ok(Number((await admin.query("select count(*) count from public.world_caravan_plans where state in('outbound','selling','returning','buying')")).rows[0].count)>0,'caravan plans did not run');

  // Expired-lease takeover must fence the old worker even after the load run.
  const takeoverRegion=regions[0],oldEpoch=leases.get(takeoverRegion);await admin.query("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id=$1",[takeoverRegion]);
  const takeover=(await admin.query("select public.claim_world_region_lease($1,'phase2-takeover',300) result",[takeoverRegion])).rows[0].result;
  await assert.rejects(admin.query("select public.process_world_region_runtime($1,'phase2-soak',$2,100)",[takeoverRegion,oldEpoch]),error=>String(error.message).includes('region_lease_required'));
  await admin.query("select public.process_world_region_runtime($1,'phase2-takeover',$2,100)",[takeoverRegion,Number(takeover.leaseEpoch)]);
  console.log(`Phase 2 PostgreSQL soak passed: ${total} parties, 24x72 ticks, p95 ${p95.toFixed(1)}ms, max ${max.toFixed(1)}ms, ${elapsed.toFixed(1)}ms total`);
}finally{if(admin)await admin.end().catch(()=>{});await postgres.stop().catch(()=>{});await rm(databaseDir,{recursive:true,force:true});}
