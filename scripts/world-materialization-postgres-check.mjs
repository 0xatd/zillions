import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import EmbeddedPostgres from 'embedded-postgres';
import {earthManifest} from '../src/world-manifest.js';import {buildWorldMaterialization} from '../src/world-materialization.js';
const root=path.resolve(import.meta.dirname,'..'),databaseDir=await mkdtemp(path.join(os.tmpdir(),'zillions-materialize-pg-'));
const postgres=new EmbeddedPostgres({databaseDir,port:30000+Math.floor(Math.random()*1000),user:'postgres',password:'postgres',persistent:false,onLog(){}});let admin;
const expectError=async(promise,marker)=>assert.rejects(promise,error=>String(error?.message||error).includes(marker),`expected ${marker}`);
try{
  await postgres.initialise();await postgres.start();admin=postgres.getPgClient();await admin.connect();
  await admin.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create table public.rooms(id uuid primary key default gen_random_uuid(),max_players integer not null default 2 check(max_players between 1 and 2));create table public.room_players(room_id uuid not null references public.rooms(id),user_id uuid not null references auth.users(id),seat integer not null check(seat between 1 and 2),primary key(room_id,user_id));create table public.match_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),mode text not null,result text not null,summary jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;`);
  for(const name of(await readdir(path.join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort())await admin.query(await readFile(path.join(root,'supabase/migrations',name),'utf8'));
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const manifest=earthManifest(),bundle=buildWorldMaterialization(manifest);
  await admin.query('select public.create_world_manifest_once($1,$2,$3,$4,$5,$6)',[manifest.planetId,manifest.schema,manifest.generatorVersion,manifest.seed,manifest.contentHash,manifest]);
  for(const mutate of [
    value=>{value.routes[0].originId=value.locations.at(-1).id;},value=>{value.regions[0].ownerFactionId='rotmire_host';},value=>{value.markets[0].basePrice=999;},value=>{value.parties[0].combatPower=9999;},value=>{value.startingLocationId=value.locations.at(-1).id;},
  ]){const altered=structuredClone(bundle);mutate(altered);await expectError(admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,altered]),'materialization_template_mismatch');}
  await admin.query(`create function public.fail_materialization_route() returns trigger language plpgsql as $$begin if new.id<>(select id from public.world_routes order by id limit 1) then raise exception 'injected_materialization_failure';end if;return new;end$$;create trigger injected_materialization_failure before insert on public.world_routes for each row execute function public.fail_materialization_route();`);
  await expectError(admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,bundle]),'injected_materialization_failure');
  assert.equal((await admin.query("select count(*) count from public.world_provinces where planet_id='earth'")).rows[0].count,'3');
  assert.equal((await admin.query("select materialization_state from public.world_manifests where planet_id='earth'")).rows[0].materialization_state,'pending');
  await admin.query('drop trigger injected_materialization_failure on public.world_routes;drop function public.fail_materialization_route()');
  const user='90000000-0000-4000-8000-000000000001';await admin.query("insert into auth.users(id,email) values($1,'guard@example.test')",[user]);await admin.query("insert into public.world_parties(shard_id,region_id,owner_user_id,name,kind,location_id) select 'earth-1',p.id,$1,'Guard Player','player',l.id from public.world_provinces p join public.world_locations l on l.province_id=p.id where p.key='greenfall' limit 1",[user]);await expectError(admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,bundle]),'earth_materialization_player_party_conflict');await admin.query('delete from public.world_parties where owner_user_id=$1',[user]);
  const linkedParty='90000000-0000-4000-a000-000000000002';await admin.query("insert into public.world_parties(id,shard_id,region_id,name,kind,location_id) select $1,'earth-1',p.id,'Null Owner Player','player',l.id from public.world_provinces p join public.world_locations l on l.province_id=p.id where p.key='greenfall' limit 1",[linkedParty]);await admin.query("insert into public.world_armies(party_id,commander_user_id,combat_power) values($1,$2,10)",[linkedParty,user]);await expectError(admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,bundle]),'earth_materialization_player_party_conflict');assert.equal((await admin.query('select count(*) count from public.world_parties where id=$1',[linkedParty])).rows[0].count,'1');assert.equal((await admin.query('select count(*) count from public.world_armies where party_id=$1 and commander_user_id=$2',[linkedParty,user])).rows[0].count,'1');await admin.query('delete from public.world_parties where id=$1',[linkedParty]);
  const first=(await admin.query('select public.materialize_world_manifest($1,$2,$3) result',[manifest.planetId,manifest.contentHash,bundle])).rows[0].result;assert.equal(first.duplicate,false);assert.match(first.materializationHash,/^sha256-[0-9a-f]{64}$/);
  for(const [query,count] of [["select count(*) count from public.world_provinces where planet_id='earth'",bundle.regions.length],["select count(*) count from public.world_locations l join public.world_provinces p on p.id=l.province_id where p.planet_id='earth'",bundle.locations.length],["select count(*) count from public.world_routes r join public.world_provinces p on p.id=r.origin_region_id where p.planet_id='earth'",bundle.routes.length],["select count(*) count from public.world_parties where shard_id='earth-1' and kind='garrison'",bundle.parties.length],["select count(*) count from public.world_region_states where status='paused'",bundle.regions.length]])assert.equal((await admin.query(query)).rows[0].count,String(count));
  assert.equal((await admin.query("select count(*) count from public.world_provinces where key in('greenfall','ironwood','rotmire')")).rows[0].count,'0');
  assert.equal((await admin.query("select count(*) count from public.world_routes r join public.world_locations o on o.id=r.origin_id join public.world_locations d on d.id=r.destination_id where o.province_id<>r.origin_region_id or d.province_id<>r.destination_region_id")).rows[0].count,'0');
  assert.equal((await admin.query("select count(*) count from public.world_parties p left join public.world_armies a on a.party_id=p.id where p.kind='garrison' and a.id is null")).rows[0].count,'0');
  const start=bundle.startingLocationId;
  assert.ok(Number((await admin.query('select count(*) count from public.world_recruitment_offers where location_id=$1',[start])).rows[0].count)>0,'pinned starting town must offer recruits');
  assert.ok(Number((await admin.query('select count(*) count from public.world_supply_offers where location_id=$1',[start])).rows[0].count)>=4,'pinned starting town must offer supplies');
  assert.ok(Number((await admin.query('select count(*) count from public.world_town_services where location_id=$1',[start])).rows[0].count)>=3,'pinned starting town must offer town services');
  // Prove the complete economic entry loop against the exact pinned Earth
  // start, rather than relying on the smaller synthetic authority fixture.
  const character='90000000-0000-4000-8000-000000000099';
  await admin.query(`insert into public.game_characters(id,user_id,client_character_id,name,class_key,race_key)
    values($1,$2,'pinned-earth-character','Pinned Earth Player','vanguard','human')`,[character,user]);
  await admin.query("insert into public.match_history(user_id,mode,result,summary) values($1,'campaign','win','{\"level\":1}')",[user]);
  await admin.query('select public.complete_world_tutorial_from_campaign($1,$2)',[user,character]);
  const entry=(await admin.query('select public.enter_living_world($1,$2) result',[user,character])).rows[0].result;
  assert.equal(entry.duplicate,false);assert.equal((await admin.query('select location_id from public.world_parties where id=$1',[entry.partyId])).rows[0].location_id,start);
  let company=(await admin.query('select revision from public.world_companies where party_id=$1',[entry.partyId])).rows[0];
  const recruit=(await admin.query('select recruit_key from public.world_recruitment_offers where location_id=$1 and available>0 order by price,recruit_key limit 1',[start])).rows[0];
  const recruited=(await admin.query("select public.living_world_company_command($1,'pinned-recruit',$2,$3,'recruit',jsonb_build_object('recruitKey',$4::text,'quantity',1)) result",[user,entry.partyId,company.revision,recruit.recruit_key])).rows[0].result;
  assert.ok(Number((await admin.query('select coalesce(sum(healthy),0) count from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id=$1',[entry.partyId])).rows[0].count)>0,'pinned recruit must materialize into the tactical stack');
  assert.ok(Number((await admin.query('select combat_power from public.world_armies where party_id=$1',[entry.partyId])).rows[0].combat_power)>0,'pinned recruit must increase strategic combat power');
  const supply=(await admin.query('select supply_key from public.world_supply_offers where location_id=$1 and stock>0 order by unit_price,supply_key limit 1',[start])).rows[0];
  const supplied=(await admin.query("select public.living_world_company_command($1,'pinned-supply',$2,$3,'buy_supplies',jsonb_build_object('supplyKey',$4::text,'quantity',1)) result",[user,entry.partyId,recruited.companyRevision,supply.supply_key])).rows[0].result;
  assert.ok(Number((await admin.query('select quantity from public.world_supplies where party_id=$1 and supply_key=$2',[entry.partyId,supply.supply_key])).rows[0].quantity)>0);
  await admin.query('update public.world_parties set fatigue=50 where id=$1',[entry.partyId]);
  const service=(await admin.query("select service_key from public.world_town_services where location_id=$1 and service_key='rest' limit 1",[start])).rows[0];
  const serviced=(await admin.query("select public.living_world_company_command($1,'pinned-service',$2,$3,'use_town_service',jsonb_build_object('serviceKey',$4::text)) result",[user,entry.partyId,supplied.companyRevision,service.service_key])).rows[0].result;
  assert.equal(Number((await admin.query('select fatigue from public.world_parties where id=$1',[entry.partyId])).rows[0].fatigue),0);assert.ok(serviced.companyRevision);
  // Prove normal and fast travel enter the real region authority through the
  // same pinned-Earth route, but produce materially different schedules.
  const travelRoute=(await admin.query(`select r.* from public.world_routes r
    join public.world_locations d on d.id=r.destination_id
    where r.origin_id=$1 and r.distance>1 and r.danger<.5 and r.control_state<>'blocked'
      and not coalesce((r.blockade_state->>'closed')::boolean,false)
      and coalesce((d.services->>'fastTravel')::boolean,false)
    order by r.distance desc limit 1`,[start])).rows[0];
  assert.ok(travelRoute,'pinned Earth start must have a safe fast-travel route');
  await admin.query("update public.world_shards set status='active' where id='earth-1'");
  await admin.query("update public.world_region_states set status='active' where region_id=$1",[travelRoute.origin_region_id]);
  const travelLease=(await admin.query("select public.claim_world_region_lease($1,'pinned-travel-worker',300) result",[travelRoute.origin_region_id])).rows[0].result;
  let travelRevision=Number((await admin.query('select revision from public.world_parties where id=$1',[entry.partyId])).rows[0].revision);
  await admin.query("select public.living_world_command($1,'earth-1','pinned-normal-travel','issue_movement',$2,$3,jsonb_build_object('routeId',$4::text,'mode','travel'))",[user,entry.partyId,travelRevision,travelRoute.id]);
  const normalRuntime=(await admin.query("select public.process_world_region_runtime($1,'pinned-travel-worker',$2,100) result",[travelRoute.origin_region_id,travelLease.leaseEpoch])).rows[0].result;
  assert.equal(normalRuntime.commandsApplied,1);
  const normalOrder=(await admin.query("select * from public.world_movement_orders where party_id=$1 and status='moving' order by issued_tick desc,id limit 1",[entry.partyId])).rows[0];
  assert.ok(normalOrder);assert.ok(Number(normalOrder.expected_arrival_tick)>Number(normalOrder.start_tick)+1,'normal travel must take more than one tick on the selected route');
  await admin.query("delete from public.world_region_handoffs where party_id=$1",[entry.partyId]);
  await admin.query("delete from public.world_movement_orders where party_id=$1",[entry.partyId]);
  await admin.query("update public.world_parties set location_id=$2,route_id=null,route_progress=0 where id=$1",[entry.partyId,start]);
  travelRevision=Number((await admin.query('select revision from public.world_parties where id=$1',[entry.partyId])).rows[0].revision);
  await admin.query("select public.living_world_command($1,'earth-1','pinned-fast-travel','issue_movement',$2,$3,jsonb_build_object('routeId',$4::text,'mode','fast'))",[user,entry.partyId,travelRevision,travelRoute.id]);
  const fastRuntime=(await admin.query("select public.process_world_region_runtime($1,'pinned-travel-worker',$2,100) result",[travelRoute.origin_region_id,travelLease.leaseEpoch])).rows[0].result;
  assert.equal(fastRuntime.commandsApplied,1);
  const fastOrder=(await admin.query("select * from public.world_movement_orders where party_id=$1 order by issued_tick desc,id limit 1",[entry.partyId])).rows[0];
  assert.ok(fastOrder);assert.equal(Number(fastOrder.expected_arrival_tick),Number(fastOrder.start_tick)+1,'fast travel must arrive in exactly one tick');
  assert.ok(Number(normalOrder.expected_arrival_tick)-Number(normalOrder.start_tick)>Number(fastOrder.expected_arrival_tick)-Number(fastOrder.start_tick));
  await admin.query("delete from public.world_region_handoffs where party_id=$1",[entry.partyId]);
  await admin.query("delete from public.world_movement_orders where party_id=$1",[entry.partyId]);
  await admin.query("update public.world_parties set location_id=$2,route_id=null,route_progress=0 where id=$1",[entry.partyId,start]);
  await admin.query('insert into public.player_wallets(user_id,salvage_alloy) values($1,1000) on conflict(user_id) do update set salvage_alloy=1000',[user]);
  const market=(await admin.query('select commodity_key from public.world_markets where location_id=$1 and stock>0 order by commodity_key limit 1',[start])).rows[0];
  const tradeRevision=Number((await admin.query('select revision from public.world_parties where id=$1',[entry.partyId])).rows[0].revision),buy={locationId:start,commodityKey:market.commodity_key,side:'buy',quantity:1};
  const bought=(await admin.query("select public.living_world_trade_market($1,'pinned-buy',$2,$3,$4) result",[user,entry.partyId,tradeRevision,buy])).rows[0].result;
  const sold=(await admin.query("select public.living_world_trade_market($1,'pinned-sell',$2,$3,$4) result",[user,entry.partyId,bought.partyRevision,{...buy,side:'sell'}])).rows[0].result;
  assert.equal(bought.side,'buy');assert.equal(sold.side,'sell');assert.equal(Number((await admin.query('select quantity from public.world_cargo where party_id=$1 and commodity_key=$2',[entry.partyId,market.commodity_key])).rows[0].quantity),0);
  const replayBuy=(await admin.query("select public.living_world_trade_market($1,'pinned-buy',$2,$3,$4) result",[user,entry.partyId,tradeRevision,buy])).rows[0].result;assert.equal(replayBuy.duplicate,true);
  await expectError(admin.query("select public.living_world_trade_market($1,'pinned-buy',$2,$3,$4)",[user,entry.partyId,tradeRevision,{...buy,quantity:2}]),'idempotency_conflict');
  await expectError(admin.query("select public.living_world_trade_market($1,'pinned-stale',$2,$3,$4)",[user,entry.partyId,tradeRevision,buy]),'stale_revision');
  await expectError(admin.query("select public.living_world_trade_market('90000000-0000-4000-8000-000000000088','pinned-spoof',$1,$2,$3)",[entry.partyId,sold.partyRevision,buy]),'unauthorized_ownership');
  await expectError(admin.query("select public.living_world_trade_market($1,'pinned-no-cargo',$2,$3,$4)",[user,entry.partyId,sold.partyRevision,{...buy,side:'sell'}]),'insufficient_cargo');
  await admin.query('update public.player_wallets set salvage_alloy=0 where user_id=$1',[user]);
  await expectError(admin.query("select public.living_world_trade_market($1,'pinned-no-funds',$2,$3,$4)",[user,entry.partyId,sold.partyRevision,buy]),'trade_unavailable');
  await admin.query('update public.player_wallets set salvage_alloy=1000 where user_id=$1',[user]);
  await admin.query('update public.world_markets set stock=0 where location_id=$1 and commodity_key=$2',[start,market.commodity_key]);
  await expectError(admin.query("select public.living_world_trade_market($1,'pinned-no-stock',$2,$3,$4)",[user,entry.partyId,sold.partyRevision,buy]),'trade_unavailable');
  for(const role of ['anon','authenticated']){await admin.query(`set role ${role}`);await admin.query("select set_config('request.jwt.claim.role',$1,false)",[role]);await expectError(admin.query("select public.living_world_trade_market($1,'pinned-direct-denied',$2,$3,$4)",[user,entry.partyId,sold.partyRevision,buy]),'permission denied');await admin.query('reset role');await admin.query("select set_config('request.jwt.claim.role','service_role',false)");}
  const replay=(await admin.query('select public.materialize_world_manifest($1,$2,$3) result',[manifest.planetId,manifest.contentHash,bundle])).rows[0].result;assert.equal(replay.duplicate,true);assert.equal(replay.materializationHash,first.materializationHash);
  for(const role of ['anon','authenticated']){await admin.query(`set role ${role}`);await admin.query("select set_config('request.jwt.claim.role',$1,false)",[role]);await expectError(admin.query('select public.materialize_world_manifest($1,$2,$3)',[manifest.planetId,manifest.contentHash,bundle]),'permission denied');await admin.query('reset role');}
  console.log(`world materialization PostgreSQL checks passed (${first.summary.regions} regions)`);
}finally{if(admin)await admin.end().catch(()=>{});await postgres.stop().catch(()=>{});await rm(databaseDir,{recursive:true,force:true});}
