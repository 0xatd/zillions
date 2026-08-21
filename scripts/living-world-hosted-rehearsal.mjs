import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {earthManifest} from '../src/world-manifest.js';
import {buildWorldMaterialization} from '../src/world-materialization.js';
import {autosimBattleAssignment} from '../src/living-world-battle.js';

const {Client}=pg;
const root=path.resolve(import.meta.dirname,'..');
const PRODUCTION_REF='skqggyvkblqtyggtcxbc';
const REQUIRED_GUARD='I_UNDERSTAND_ISOLATED_BRANCH_ONLY';
const guard=process.env.LIVING_WORLD_HOSTED_REHEARSAL;
const databaseUrl=process.env.DATABASE_URL;
const expectedRef=process.env.EXPECTED_SUPABASE_BRANCH_REF;
const databaseCa=process.env.DATABASE_CA_CERT;

function fail(message){throw new Error(`hosted_rehearsal_refused: ${message}`);}
if(guard!==REQUIRED_GUARD)fail(`set LIVING_WORLD_HOSTED_REHEARSAL=${REQUIRED_GUARD}`);
if(!databaseUrl)fail('DATABASE_URL is required');
if(!expectedRef||!/^[a-z0-9-]{8,64}$/.test(expectedRef))fail('EXPECTED_SUPABASE_BRANCH_REF is required');
if(expectedRef===PRODUCTION_REF)fail('the production project ref is permanently denied');
const parsedUrl=new URL(databaseUrl);
const endpointIdentity=`${parsedUrl.hostname}:${decodeURIComponent(parsedUrl.username)}`;
if(endpointIdentity.includes(PRODUCTION_REF))fail('DATABASE_URL resolves to the production project');
if(!endpointIdentity.includes(expectedRef))fail('DATABASE_URL does not match EXPECTED_SUPABASE_BRANCH_REF');
if(parsedUrl.searchParams.get('sslmode')==='disable')fail('TLS cannot be disabled');
parsedUrl.searchParams.delete('sslmode');

const client=new Client({connectionString:parsedUrl.toString(),ssl:{rejectUnauthorized:true,...(databaseCa?{ca:databaseCa}:{})},application_name:'zillions-isolated-living-world-rehearsal'});
const runId=randomUUID();
const shortRun=runId.slice(0,8);
const migrationDir=path.join(root,'supabase/migrations');
const livingWorldNames=(await readdir(migrationDir)).filter(name=>name.endsWith('.sql')&&name>='20260820173000_living_world_authority.sql').sort();
assert.ok(livingWorldNames.length>=15,'living-world migration set is unexpectedly incomplete');
const livingWorldMigrations=await Promise.all(livingWorldNames.map(async name=>({name,version:name.split('_',1)[0],sql:await readFile(path.join(migrationDir,name),'utf8')})));
let migrationNames=[],migrations=[];
const unwrapTransaction=sql=>sql.replace(/^\s*(?:--[^\n]*\n\s*)*begin;\s*/i,match=>match.replace(/begin;\s*$/i,'')).replace(/\s*commit;\s*$/i,'');
const q=(text,values=[])=>client.query(text,values);
let activeStep='startup';
const timed=async(label,fn)=>{const started=performance.now();try{const value=await fn();return{label,ok:true,ms:performance.now()-started,value};}catch(error){throw Object.assign(error,{rehearsalStep:label});}};
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]||0;
const safeError=error=>({step:error?.rehearsalStep||activeStep||'unknown',code:error?.code||'unknown',message:String(error?.message||error).replace(databaseUrl,'[redacted]').slice(0,240)});

async function fingerprint(){
  const result=await q(`select jsonb_build_object(
    'database',current_database(),
    'server',current_setting('server_version_num'),
    'objects',coalesce((select md5(string_agg(n.nspname||'.'||c.relname||':'||c.relkind::text,',' order by n.nspname,c.relname,c.relkind)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth')),'empty')
  ) value`);
  const value=result.rows[0].value;
  value.worldShards=(await q("select to_regclass('public.world_shards') value")).rows[0].value
    ?Number((await q('select count(*) count from public.world_shards')).rows[0].count):null;
  value.earthManifest=(await q("select to_regclass('public.world_manifests') value")).rows[0].value
    ?(await q("select content_hash from public.world_manifests where planet_id='earth'")).rows[0]?.content_hash||null:null;
  return value;
}

async function insertQaUser(userId,index){
  await q(`insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,[userId,`living-world-${shortRun}-${index}@example.invalid`]);
  await q(`insert into public.profiles(id,handle,display_name)
    values($1,$2,$3) on conflict(id) do nothing`,[userId,`lw_${shortRun}_${index}`,`Living World QA ${index}`]);
}

async function createQaPlayer(index,startLocation){
  const userId=randomUUID(),characterId=randomUUID();
  await insertQaUser(userId,index);
  await q(`insert into public.game_characters(id,user_id,client_character_id,name,class_key,race_key)
    values($1,$2,$3,$4,'vanguard','human')`,[characterId,userId,`hosted-${runId}-${index}`,`Hosted QA ${index}`]);
  await q(`insert into public.match_history(user_id,mode,result,summary) values($1,'campaign','win','{"level":1}')`,[userId]);
  await q('select public.complete_world_tutorial_from_campaign($1,$2)',[userId,characterId]);
  const entry=(await q('select public.enter_living_world($1,$2) result',[userId,characterId])).rows[0].result;
  assert.equal(entry.duplicate,false);
  assert.equal((await q('select location_id from public.world_parties where id=$1',[entry.partyId])).rows[0].location_id,startLocation);
  return{userId,characterId,partyId:entry.partyId};
}

async function exercisePlayer(player,startLocation,index){
  let revision=Number((await q('select revision from public.world_companies where party_id=$1',[player.partyId])).rows[0].revision);
  const recruit=(await q('select recruit_key from public.world_recruitment_offers where location_id=$1 and available>0 order by recruit_key limit 1',[startLocation])).rows[0];
  const recruited=(await q("select public.living_world_company_command($1,$2,$3,$4,'recruit',jsonb_build_object('recruitKey',$5::text,'quantity',1)) result",[player.userId,`hosted-${runId}-${index}-recruit`,player.partyId,revision,recruit.recruit_key])).rows[0].result;
  revision=Number(recruited.companyRevision);
  const supply=(await q('select supply_key from public.world_supply_offers where location_id=$1 and stock>0 order by supply_key limit 1',[startLocation])).rows[0];
  const supplied=(await q("select public.living_world_company_command($1,$2,$3,$4,'buy_supplies',jsonb_build_object('supplyKey',$5::text,'quantity',1)) result",[player.userId,`hosted-${runId}-${index}-supply`,player.partyId,revision,supply.supply_key])).rows[0].result;
  await q('insert into public.player_wallets(user_id,salvage_alloy) values($1,1000) on conflict(user_id) do update set salvage_alloy=1000',[player.userId]);
  const market=(await q('select commodity_key from public.world_markets where location_id=$1 and stock>0 order by commodity_key limit 1',[startLocation])).rows[0];
  const partyRevision=Number((await q('select revision from public.world_parties where id=$1',[player.partyId])).rows[0].revision);
  const trade=(await q('select public.living_world_trade_market($1,$2,$3,$4,$5) result',[player.userId,`hosted-${runId}-${index}-buy`,player.partyId,partyRevision,{locationId:startLocation,commodityKey:market.commodity_key,side:'buy',quantity:1}])).rows[0].result;
  assert.equal(trade.side,'buy');
  return{companyRevision:Number(supplied.companyRevision),tradeCommodity:market.commodity_key};
}

let preState,rollbackState,postState,summary;
const latencies=[];
try{
  await client.connect();
  const tls=client.connection?.stream?.encrypted===true;
  if(!tls)fail('PostgreSQL connection is not using TLS');
  const identity=(await q("select current_user, current_database(), inet_server_addr()::text server_addr")).rows[0];
  if(!(await q("select to_regclass('supabase_migrations.schema_migrations') value")).rows[0].value)fail('expected a Supabase branch cloned from the production schema');
  const applied=new Set((await q('select version::text from supabase_migrations.schema_migrations')).rows.map(row=>row.version));
  migrations=livingWorldMigrations.filter(migration=>!applied.has(migration.version));
  migrationNames=migrations.map(migration=>migration.name);
  if(!migrations.length)fail('no pending living-world migrations were found');
  preState=await fingerprint();

  await q('begin');
  try{
    for(const migration of migrations){
      activeStep=`transactional-migration:${migration.name}`;
      try{await q(unwrapTransaction(migration.sql));}
      catch(error){error.rehearsalStep=`transactional-migration:${migration.name}`;throw error;}
    }
    assert.equal((await q("select to_regclass('public.world_region_runtime_ticks') value")).rows[0].value,'world_region_runtime_ticks');
  }finally{await q('rollback');}
  rollbackState=await fingerprint();
  assert.deepEqual(rollbackState,preState,'transactional migration rollback changed the branch');

  for(const migration of migrations){
    activeStep=`apply-migration:${migration.name}`;
    await q('begin');
    try{
      await q(unwrapTransaction(migration.sql));
      await q('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3::text[])',
        [migration.version,migration.name.replace(/^\d+_|\.sql$/g,''),[migration.sql]]);
      await q('commit');
    }catch(error){await q('rollback');error.rehearsalStep=`apply-migration:${migration.name}`;throw error;}
  }
  await q("select set_config('request.jwt.claim.role','service_role',false)");
  const manifest=earthManifest(),bundle=buildWorldMaterialization(manifest);
  await q('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6)',[manifest.planetId,manifest.schema,manifest.generatorVersion,manifest.seed,manifest.contentHash,manifest]);
  const materialized=(await q('select public.materialize_world_manifest($1,$2,$3) result',[manifest.planetId,manifest.contentHash,bundle])).rows[0].result;
  assert.equal(materialized.duplicate,false);
  assert.equal(Number(materialized.summary.regions),72);
  const players=[await createQaPlayer(1,bundle.startingLocationId),await createQaPlayer(2,bundle.startingLocationId)];
  await exercisePlayer(players[0],bundle.startingLocationId,1);
  await exercisePlayer(players[1],bundle.startingLocationId,2);

  await q("update public.world_shards set status='active' where id='earth-1'");
  const route=(await q(`select r.* from public.world_routes r where r.origin_id=$1 and r.control_state<>'blocked'
    and not coalesce((r.blockade_state->>'closed')::boolean,false) order by r.distance limit 1`,[bundle.startingLocationId])).rows[0];
  assert.ok(route,'the immutable Earth start has no usable route');
  for(const [index,player] of players.entries()){
    const revision=Number((await q('select revision from public.world_parties where id=$1',[player.partyId])).rows[0].revision);
    await q("select public.living_world_command($1,'earth-1',$2,'issue_movement',$3,$4,jsonb_build_object('routeId',$5::text,'mode',$6::text))",
      [player.userId,`hosted-${runId}-${index}-move`,player.partyId,revision,route.id,index===0?'travel':'fast']);
  }
  const regions=(await q("select id from public.world_provinces where planet_id='earth' order by (id=$1) desc,id limit 72",[route.origin_region_id])).rows.map(row=>row.id);
  assert.equal(regions.length,72,'hosted scheduler proof must cover every Earth region');
  await q("update public.world_region_states set status='active' where region_id=any($1::uuid[])",[regions]);
  const leases=new Map();
  for(const region of regions){const lease=(await q("select public.claim_world_region_lease($1,$2,300) result",[region,`hosted-${shortRun}-a`])).rows[0].result;leases.set(region,Number(lease.leaseEpoch));}
  for(let round=0;round<4;round++)for(const region of regions){const result=await timed(`bounded-region-runtime:${region}:round:${round}`,async()=>{
    const tick=(await q('select public.process_world_region_runtime($1,$2,$3,16) result',[region,`hosted-${shortRun}-a`,leases.get(region)])).rows[0].result;
    assert.ok(Number(tick.actionBudget)<=16);return tick;
  });latencies.push(result.ms);await q('select public.record_world_region_runtime_health($1,$2,$3,$4,$5,true,null,$6,$7)',
    [region,result.value.tick,`hosted-${shortRun}-a`,leases.get(region),result.ms,result.value.actionBudget,result.value.population?.congestion==='overloaded']);}
  const takeoverRegion=regions[0],oldEpoch=leases.get(takeoverRegion);
  await q("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id=$1",[takeoverRegion]);
  const takeover=(await q("select public.claim_world_region_lease($1,$2,300) result",[takeoverRegion,`hosted-${shortRun}-b`])).rows[0].result;
  await assert.rejects(q('select public.process_world_region_runtime($1,$2,$3,16)',[takeoverRegion,`hosted-${shortRun}-a`,oldEpoch]),error=>String(error.message).includes('region_lease_required'));
  const takeoverTick=await timed('lease-takeover',async()=>(await q('select public.process_world_region_runtime($1,$2,$3,16) result',[takeoverRegion,`hosted-${shortRun}-b`,Number(takeover.leaseEpoch)])).rows[0].result);latencies.push(takeoverTick.ms);
  await q('select public.record_world_region_runtime_health($1,$2,$3,$4,$5,true,null,$6,$7)',[takeoverRegion,takeoverTick.value.tick,`hosted-${shortRun}-b`,Number(takeover.leaseEpoch),takeoverTick.ms,takeoverTick.value.actionBudget,takeoverTick.value.population?.congestion==='overloaded']);
  assert.ok(Number((await q("select count(*) count from public.world_movement_orders where party_id=any($1::uuid[]) and status in('moving','arrived')",[players.map(player=>player.partyId)])).rows[0].count)>=2,'both QA accounts must enter authoritative travel');

  // Prove the hosted encounter -> assignment -> deterministic autosim ->
  // persistent consequence transaction instead of stopping at movement.
  const battlePlayer=players[0];
  await q('delete from public.world_region_handoffs where party_id=$1',[battlePlayer.partyId]);
  await q('delete from public.world_movement_orders where party_id=$1',[battlePlayer.partyId]);
  const defender=(await q(`select p.id,p.region_id,p.location_id from public.world_parties p
    where p.owner_user_id is null and p.location_id is not null and exists(
      select 1 from public.world_armies a join public.world_unit_stacks s on s.army_id=a.id where a.party_id=p.id and s.healthy>0)
      and p.region_id<>$1 order by p.id limit 1`,[takeoverRegion])).rows[0];
  assert.ok(defender,'hosted battle proof needs a materialized AI force');
  await q('update public.world_parties set region_id=$2,location_id=$3,route_id=null,route_progress=0,revision=revision+1 where id=$1',[battlePlayer.partyId,defender.region_id,defender.location_id]);
  await q("update public.world_parties set stance=case when id=$1 then 'hostile' else 'friendly' end,revision=revision+1 where id in($1,$2)",[defender.id,battlePlayer.partyId]);
  await q("insert into public.world_cargo(party_id,commodity_key,quantity) values($1,'grain',8),($2,'grain',8) on conflict(party_id,commodity_key) do update set quantity=8,reserved_quantity=0",[defender.id,battlePlayer.partyId]);
  const organicTick=(await q('select public.process_world_region_runtime($1,$2,$3,16) result',[defender.region_id,`hosted-${shortRun}-a`,leases.get(defender.region_id)])).rows[0].result;
  assert.ok(Number(organicTick.encountersCreated)>0,'hosted region runtime must create the encounter organically');
  const encounterId=(await q(`select id from public.world_encounters where state='choosing' and attacker_party_id in($1,$2) and defender_party_id in($1,$2) order by created_tick desc,id limit 1`,[battlePlayer.partyId,defender.id])).rows[0]?.id;
  assert.ok(encounterId,'organic hosted encounter must be persisted');
  await q("update public.world_encounters set attacker_choice='auto-command',defender_choice='auto-command' where id=$1",[encounterId]);
  await q("update public.world_encounters set state='battle',revision=revision+1 where id=$1",[encounterId]);
  const battleEncounter=(await q('select revision from public.world_encounters where id=$1',[encounterId])).rows[0];
  const engagement=(await q('select id from public.world_engagements where encounter_id=$1',[encounterId])).rows[0];
  assert.ok(engagement,'battle engagement must be created');
  const assignment=(await q("select public.living_world_issue_battle($1,$2,$3,$4) result",[battlePlayer.userId,engagement.id,battleEncounter.revision,`hosted-${runId}-autosim`])).rows[0].result;
  activeStep='hosted-battle-writeback';
  const battleResult=autosimBattleAssignment(assignment);
  const casualtyTotal=battleResult.casualties.reduce((sum,row)=>sum+Number(row.killed||0)+Number(row.wounded||0),0);
  const prisonerTotal=battleResult.prisoners.reduce((sum,row)=>sum+Number(row.quantity||0),0);
  assert.ok(casualtyTotal+prisonerTotal>0,'hosted autosim must remove combatants through casualties or capture');
  assert.ok(prisonerTotal>0,'hosted autosim must produce prisoners');
  assert.ok(battleResult.cargoTransfers.length>0,'hosted autosim must produce cargo transfers');
  const cargoTransfer=battleResult.cargoTransfers[0];
  const cargoBefore=(await q(`select
    (select quantity from public.world_cargo where party_id=$1 and commodity_key=$3) source,
    (select quantity from public.world_cargo where party_id=$2 and commodity_key=$3) destination`,
    [cargoTransfer.fromPartyId,cargoTransfer.toPartyId,cargoTransfer.commodityKey])).rows[0];
  const beforeBattle=(await q(`select jsonb_build_object(
    'healthy',(select coalesce(sum(s.healthy),0) from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in($1,$2)),
    'prisoners',(select coalesce(sum(quantity),0) from public.world_prisoners where captor_party_id in($1,$2)),
    'companyConsequences',(select count(*) from public.world_company_members where party_id=$1 and status in('dead','wounded','captured'))) value`,[battlePlayer.partyId,defender.id])).rows[0].value;
  const battleCommit=(await q('select public.living_world_commit_battle($1,$2,$3,$4) result',[assignment.id,assignment.nonce,battleEncounter.revision,battleResult])).rows[0].result;
  assert.equal(battleCommit.duplicate,false);
  assert.equal((await q('select state from public.world_encounters where id=$1',[encounterId])).rows[0].state,'resolved');
  const afterBattle=(await q(`select jsonb_build_object(
    'healthy',(select coalesce(sum(s.healthy),0) from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in($1,$2)),
    'prisoners',(select coalesce(sum(quantity),0) from public.world_prisoners where captor_party_id in($1,$2)),
    'companyConsequences',(select count(*) from public.world_company_members where party_id=$1 and status in('dead','wounded','captured'))) value`,[battlePlayer.partyId,defender.id])).rows[0].value;
  const cargoAfter=(await q(`select
    (select quantity from public.world_cargo where party_id=$1 and commodity_key=$3) source,
    (select quantity from public.world_cargo where party_id=$2 and commodity_key=$3) destination`,
    [cargoTransfer.fromPartyId,cargoTransfer.toPartyId,cargoTransfer.commodityKey])).rows[0];
  assert.ok(Number(afterBattle.healthy)<Number(beforeBattle.healthy),'battle commit must persist stack casualties');
  assert.ok(Number(afterBattle.prisoners)>Number(beforeBattle.prisoners),'battle commit must persist prisoners');
  assert.ok(Number(afterBattle.companyConsequences)>Number(beforeBattle.companyConsequences),'battle commit must persist player company consequences');
  assert.equal(Number(cargoAfter.source),Number(cargoBefore.source)-Number(cargoTransfer.quantity),'battle commit must debit the exact loser cargo row');
  assert.equal(Number(cargoAfter.destination),Number(cargoBefore.destination||0)+Number(cargoTransfer.quantity),'battle commit must credit the exact winner cargo row');

  const telemetry=(await q(`select
    coalesce(max(simulation_tick)-min(simulation_tick),0)::integer lag,
    count(*) filter(where status='error')::integer errors
    from public.world_region_states where region_id=any($1::uuid[])`,[regions])).rows[0];
  const health=(await q(`select count(*) filter(where threshold_breached)::integer saturation,
    count(*) filter(where not success)::integer errors from public.world_region_runtime_health
    where worker_id like $1`,[`hosted-${shortRun}-%`])).rows[0];
  const p95=percentile(latencies,.95),max=percentile(latencies,1);
  assert.ok(p95<500,`hosted runtime p95 ${p95.toFixed(1)}ms exceeds 500ms`);
  assert.ok(Number(telemetry.lag)<=8,'hosted worker lag exceeds eight ticks');
  assert.equal(Number(telemetry.errors)+Number(health.errors),0,'hosted runtime recorded errors');
  assert.equal(Number(health.saturation),0,'hosted runtime saturated during bounded rehearsal');
  postState=await fingerprint();
  summary={ok:true,runId,branchRef:expectedRef,database:identity.current_database,tls:true,
    migrations:{count:migrations.length,first:migrationNames[0],last:migrationNames.at(-1),digest:createHash('sha256').update(migrations.map(x=>`${x.name}\n${x.sql}`).join('\n')).digest('hex')},
    rollback:{transactionalProof:true,preState,rolledBackState:rollbackState,postActivationRollbackPlan:'delete the isolated Supabase branch; do not down-migrate the successful rehearsal'},
    earth:{contentHash:manifest.contentHash,materializationHash:materialized.materializationHash,regions:Number(materialized.summary.regions),parties:Number((await q("select count(*) count from public.world_parties where shard_id='earth-1'")).rows[0].count)},
    qa:{accounts:players.length,entry:true,recruit:true,supply:true,trade:true,encounter:true,battleAutosim:true,battleWriteback:true},workers:{regions:regions.length,ticks:latencies.length,takeover:true,batchLimit:72,p95Ms:Number(p95.toFixed(1)),maxMs:Number(max.toFixed(1)),lag:Number(telemetry.lag),errors:0,saturation:0},postState};
  console.log(JSON.stringify(summary));
}catch(error){
  console.error(JSON.stringify({ok:false,runId,branchRef:expectedRef,error:safeError(error),preState,rollbackState,postState}));
  process.exitCode=1;
}finally{await client.end().catch(()=>{});}
