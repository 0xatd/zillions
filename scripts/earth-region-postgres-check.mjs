import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { createServer } from 'node:http';
import { createLivingWorldPartyHandler } from '../api/living-world-party.js';
import { createLivingWorldBattleHandler } from '../api/living-world-battle.js';
import { createLivingWorldEntryHandler } from '../api/living-world-entry.js';
import { verifyLivingWorldBattleReplay } from '../src/living-world-battle-replay.js';
import { autosimBattleAssignment } from '../src/living-world-battle.js';
import { Game } from '../src/game.js';
import { TerrainField } from '../src/terrain.js';
import { levelById } from '../src/config.js';

const root = path.resolve(import.meta.dirname, '..');
const databaseDir = await mkdtemp(path.join(os.tmpdir(), 'zillions-region-pg-'));
const port = 26000 + Math.floor(Math.random() * 2000);
const postgres = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: 'postgres', persistent: false, onLog() {} });

const expectError = async (promise, message) => {
  await assert.rejects(promise, (error) => String(error?.message || error).includes(message), `expected ${message}`);
};

let admin;
try {
  await postgres.initialise();
  await postgres.start();
  admin = postgres.getPgClient();
  await admin.connect();
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create table public.rooms(id uuid primary key default gen_random_uuid(), max_players integer not null default 2 check(max_players between 1 and 2));
    create table public.room_players(room_id uuid not null references public.rooms(id), user_id uuid not null references auth.users(id), seat integer not null check(seat between 1 and 2), primary key(room_id,user_id));
    create table public.match_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),mode text not null,result text not null,summary jsonb not null default '{}'::jsonb);
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  `);
  const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
  for (const migration of migrations) {
    await admin.query(await readFile(path.join(root, 'supabase/migrations', migration), 'utf8'));
  }

  const userId = '10000000-0000-4000-8000-000000000001';
  const otherUserId = '10000000-0000-4000-8000-000000000002';
  await admin.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [userId, 'owner@example.test', otherUserId, 'other@example.test']);
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  for(let attempt=1;attempt<=4;attempt++){
    const limited=(await admin.query("select public.consume_world_api_rate_limit($1,'qa:limit',3,60) result",[userId])).rows[0].result;
    assert.equal(limited.allowed,attempt<=3,'fresh request IDs must still share the same durable quota');
  }
  await admin.query(`insert into public.game_characters(id,user_id,client_character_id,name,class_key,race_key)
    values('20000000-0000-4000-8000-000000000001',$1,'owner-char','Owner','vanguard','human')`, [userId]);
  await admin.query("insert into public.match_history(user_id,mode,result,summary) values($1,'campaign','win','{\"level\":1}')",[userId]);

  const authenticateHttp=async(value)=>value==='Bearer owner'?{id:userId}:value==='Bearer other'?{id:otherUserId}:null;
  const rateLimitHttp=async(actor,scope,limit,windowSeconds)=>(await admin.query('select public.consume_world_api_rate_limit($1,$2,$3,$4) result',[actor,scope,limit,windowSeconds])).rows[0].result;
  const entryHandler=createLivingWorldEntryHandler({config:{url:'http://local',anonKey:'anon',serviceKey:'service'},authenticate:authenticateHttp,rateLimit:rateLimitHttp,complete:async(actor,characterId)=>(await admin.query('select public.complete_world_tutorial_from_campaign($1,$2) result',[actor,characterId])).rows[0].result,enter:async(actor,characterId)=>(await admin.query('select public.enter_living_world($1,$2) result',[actor,characterId])).rows[0].result});
  const entryServer=createServer(entryHandler);await new Promise((resolve,reject)=>entryServer.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const entryBase=`http://127.0.0.1:${entryServer.address().port}`;
  const postEntry=async(token,characterId)=>{const response=await fetch(entryBase,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({characterId})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};

  // World entry must cross the authenticated HTTP boundary, succeed after
  // region_id is NOT NULL, and remain idempotent on retry.
  const firstEntry=await postEntry('owner','20000000-0000-4000-8000-000000000001');
  assert.equal(firstEntry.ok, true);
  assert.equal(firstEntry.duplicate, false);
  const enteredParty = (await admin.query('select id,region_id,revision from public.world_parties where id=$1', [firstEntry.partyId])).rows[0];
  assert.ok(enteredParty.region_id);
  const secondEntry=await postEntry('owner','20000000-0000-4000-8000-000000000001');
  assert.equal(secondEntry.duplicate, true);
  assert.equal(Number((await admin.query('select count(*) count from public.world_parties where owner_user_id=$1', [userId])).rows[0].count), 1);

  // Company creation, recruitment, supplies, and services are atomic and revision-fenced.
  const company = (await admin.query('select treasury,revision from public.world_companies where party_id=$1', [firstEntry.partyId])).rows[0];
  assert.equal(Number(company.treasury), 250);
  const recruited = (await admin.query("select public.living_world_company_command($1,'recruit-1',$2,$3,'recruit','{\"recruitKey\":\"greenfall_militia\",\"quantity\":2}') result", [userId, firstEntry.partyId, company.revision])).rows[0].result;
  assert.equal(recruited.cost, 120);
  assert.equal(Number((await admin.query('select count(*) count from public.world_company_members where party_id=$1', [firstEntry.partyId])).rows[0].count), 2);
  const replayRecruit = (await admin.query("select public.living_world_company_command($1,'recruit-1',$2,$3,'recruit','{\"recruitKey\":\"greenfall_militia\",\"quantity\":2}') result", [userId, firstEntry.partyId, company.revision])).rows[0].result;
  assert.equal(replayRecruit.duplicate, true);
  assert.equal(Number((await admin.query('select count(*) count from public.world_company_members where party_id=$1', [firstEntry.partyId])).rows[0].count), 2);
  await expectError(admin.query("select public.living_world_company_command($1,'stale-1',$2,$3,'buy_supplies','{\"supplyKey\":\"food\",\"quantity\":5}')", [userId, firstEntry.partyId, company.revision]), 'stale_company');
  const supplied = (await admin.query("select public.living_world_company_command($1,'supply-1',$2,$3,'buy_supplies','{\"supplyKey\":\"food\",\"quantity\":5}') result", [userId, firstEntry.partyId, recruited.companyRevision])).rows[0].result;
  assert.equal(supplied.cost, 10);
  assert.equal(Number((await admin.query("select quantity from public.world_supplies where party_id=$1 and supply_key='food'", [firstEntry.partyId])).rows[0].quantity), 25);
  await admin.query('update public.world_parties set fatigue=50 where id=$1', [firstEntry.partyId]);
  const rested = (await admin.query("select public.living_world_company_command($1,'rest-1',$2,$3,'use_town_service','{\"serviceKey\":\"rest\"}') result", [userId, firstEntry.partyId, supplied.companyRevision])).rows[0].result;
  assert.equal(rested.cost, 15);
  assert.equal(Number((await admin.query('select fatigue from public.world_parties where id=$1', [firstEntry.partyId])).rows[0].fatigue), 0);
  // Player trade uses the active direct domain authority, not the retired shard worker.
  await admin.query('insert into public.player_wallets(user_id,salvage_alloy) values($1,1000) on conflict(user_id) do update set salvage_alloy=1000',[userId]);
  const tradeOffer=(await admin.query('select location_id,commodity_key from public.world_markets where location_id=(select location_id from public.world_parties where id=$1) order by commodity_key limit 1',[firstEntry.partyId])).rows[0];
  const tradeRevision=Number((await admin.query('select revision from public.world_parties where id=$1',[firstEntry.partyId])).rows[0].revision);
  const tradePayload={locationId:tradeOffer.location_id,commodityKey:tradeOffer.commodity_key,side:'buy',quantity:1};
  const traded=(await admin.query("select public.living_world_trade_market($1,'trade-live-1',$2,$3,$4) result",[userId,firstEntry.partyId,tradeRevision,tradePayload])).rows[0].result;
  assert.equal(traded.side,'buy');
  const tradeReplay=(await admin.query("select public.living_world_trade_market($1,'trade-live-1',$2,$3,$4) result",[userId,firstEntry.partyId,tradeRevision,tradePayload])).rows[0].result;
  assert.equal(tradeReplay.duplicate,true);
  assert.equal(Number((await admin.query('select quantity from public.world_cargo where party_id=$1 and commodity_key=$2',[firstEntry.partyId,tradeOffer.commodity_key])).rows[0].quantity),1);
  // Two independent accounts keep their own companies while one durable social
  // party coordinates an atomic grouped move. Accepting an invite safely
  // replaces the invitee's automatically-created solo party.
  await admin.query(`insert into public.game_characters(id,user_id,client_character_id,name,class_key,race_key)
    values('20000000-0000-4000-8000-000000000002',$1,'other-char','Other','vanguard','human')`, [otherUserId]);
  await admin.query("insert into public.match_history(user_id,mode,result,summary) values($1,'campaign','win','{\"level\":1}')",[otherUserId]);
  const otherEntry=await postEntry('other','20000000-0000-4000-8000-000000000002');
  await new Promise((resolve)=>entryServer.close(resolve));
  const partyHandler=createLivingWorldPartyHandler({config:{url:'http://local',anonKey:'anon',serviceKey:'service'},authenticate:authenticateHttp,rateLimit:rateLimitHttp,command:async(actor,command)=>(await admin.query("select public.social_party_command($1,$2,$3,$4,$5,$6,$7) result",[actor,command.requestId,command.action,command.partyId,command.targetId,command.inviteId,command.payload])).rows[0].result,snapshot:async(actor)=>(await admin.query('select public.social_party_snapshot($1) result',[actor])).rows[0].result});
  const server=createServer(partyHandler);await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const base=`http://127.0.0.1:${server.address().port}`;
  const postParty=async(token,payload)=>{const response=await fetch(base,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  const invite=await postParty('owner',{requestId:'invite-two',action:'invite',partyId:firstEntry.socialPartyId,targetId:otherUserId,payload:{}});
  const accepted=await postParty('other',{requestId:'accept-two',action:'accept',partyId:firstEntry.socialPartyId,inviteId:invite.inviteId,payload:{}});
  assert.equal(accepted.status, 'accepted');
  assert.equal(Number((await admin.query('select count(*) count from public.social_party_members where party_id=$1', [firstEntry.socialPartyId])).rows[0].count), 2);
  const groupRoute = '12000000-0000-4000-8000-000000000099';
  await admin.query(`insert into public.world_routes(id,province_id,origin_id,destination_id,distance,terrain,danger,origin_region_id,destination_region_id)
    select $1,l.province_id,l.id,d.id,12,'{"type":"road"}',0.05,l.province_id,d.province_id
    from public.world_locations l join public.world_locations d on d.key='reedwater'
    where l.key='greenfall-crossing'`, [groupRoute]);
  const revisions = Object.fromEntries((await admin.query('select id,revision from public.world_parties where owner_user_id in($1,$2) order by id', [userId, otherUserId])).rows.map((party) => [party.id, Number(party.revision)]));
  const grouped=await postParty('owner',{requestId:'group-two',action:'group_travel',partyId:firstEntry.socialPartyId,payload:{routeId:groupRoute,expectedRevisions:revisions}});
  assert.equal(grouped.memberCount, 2);
  const groupedReplay = (await admin.query("select public.social_party_command($1,'group-two','group_travel',$2,null,null,jsonb_build_object('routeId',$3::text,'expectedRevisions',$4::jsonb)) result", [userId, firstEntry.socialPartyId, groupRoute, JSON.stringify(revisions)])).rows[0].result;
  assert.equal(groupedReplay.duplicate, true);
  assert.equal(Number((await admin.query("select count(*) count from public.world_movement_orders where party_id in($1,$2) and status='moving'", [firstEntry.partyId, otherEntry.partyId])).rows[0].count), 2);
  const groupRegionId=(await admin.query('select region_id from public.world_parties where id=$1',[firstEntry.partyId])).rows[0].region_id;
  const groupLease=(await admin.query("select public.claim_world_region_lease($1,'group-worker',300) result",[groupRegionId])).rows[0].result;
  for(let tick=0;tick<20;tick++){
    if(Number((await admin.query("select count(*) count from public.world_movement_orders where party_id in($1,$2) and status='moving'",[firstEntry.partyId,otherEntry.partyId])).rows[0].count)===0)break;
    await admin.query("select public.process_world_region_runtime($1,'group-worker',$2,100)",[groupRegionId,groupLease.leaseEpoch]);
  }
  assert.equal(Number((await admin.query("select count(*) count from public.world_movement_orders where party_id in($1,$2) and status='arrived'",[firstEntry.partyId,otherEntry.partyId])).rows[0].count),2,'grouped parties must actually arrive');
  assert.equal(Number((await admin.query('select count(distinct location_id) count from public.world_parties where id in($1,$2)',[firstEntry.partyId,otherEntry.partyId])).rows[0].count),1,'grouped parties must arrive together');
  await admin.query("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id=$1",[groupRegionId]);
  await admin.query("select public.social_party_command($1,'split-two','travel_mode',$2,null,null,'{\"mode\":\"split\"}')", [otherUserId, firstEntry.socialPartyId]);
  assert.equal((await admin.query('select travel_mode from public.social_party_members where party_id=$1 and user_id=$2', [firstEntry.socialPartyId, otherUserId])).rows[0].travel_mode, 'split');
  const crossRoute='12000000-0000-4000-8000-000000000098';
  await admin.query(`insert into public.world_routes(id,province_id,origin_id,destination_id,distance,terrain,danger,origin_region_id,destination_region_id)
    select $1,o.province_id,o.id,d.id,10,'{"type":"road"}',0.05,o.province_id,d.province_id from public.world_locations o join public.world_locations d on d.key='ironwood' where o.key='reedwater'`,[crossRoute]);
  const splitRevisions=Object.fromEntries((await admin.query('select id,revision from public.world_parties where owner_user_id in($1,$2)',[userId,otherUserId])).rows.map(row=>[row.id,Number(row.revision)]));
  const splitMove=await postParty('owner',{requestId:'split-cross-region',action:'group_travel',partyId:firstEntry.socialPartyId,payload:{routeId:crossRoute,expectedRevisions:splitRevisions}});
  assert.equal(splitMove.memberCount,1,'split member must be excluded from group travel');
  assert.equal((await admin.query('select location_id from public.world_parties where id=$1',[otherEntry.partyId])).rows[0].location_id,(await admin.query("select id from public.world_locations where key='reedwater'")).rows[0].id);
  const crossSourceLease=(await admin.query("select public.claim_world_region_lease($1,'cross-source',300) result",[groupRegionId])).rows[0].result;
  for(let tick=0;tick<20;tick++){
    await admin.query("select public.process_world_region_runtime($1,'cross-source',$2,100)",[groupRegionId,crossSourceLease.leaseEpoch]);
    if(Number((await admin.query("select count(*) count from public.world_region_handoffs where party_id=$1 and status='pending'",[firstEntry.partyId])).rows[0].count)>0)break;
  }
  const destinationRegion=(await admin.query("select province_id from public.world_locations where key='ironwood'")).rows[0].province_id;
  const crossDestinationLease=(await admin.query("select public.claim_world_region_lease($1,'cross-destination',300) result",[destinationRegion])).rows[0].result;
  await admin.query("select public.process_world_region_runtime($1,'cross-destination',$2,100)",[destinationRegion,crossDestinationLease.leaseEpoch]);
  assert.equal((await admin.query('select location_id from public.world_parties where id=$1',[firstEntry.partyId])).rows[0].location_id,(await admin.query("select id from public.world_locations where key='ironwood'")).rows[0].id,'grouped cross-region traveler must complete destination handoff');
  assert.equal((await admin.query('select location_id from public.world_parties where id=$1',[otherEntry.partyId])).rows[0].location_id,(await admin.query("select id from public.world_locations where key='reedwater'")).rows[0].id,'split member must remain behind');
  await admin.query("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id in($1,$2)",[groupRegionId,destinationRegion]);
  await new Promise((resolve)=>server.close(resolve));

  const regions = (await admin.query("select id,key,revision from public.world_provinces where key in ('greenfall','ironwood') order by key")).rows;
  const greenfall = regions.find((region) => region.key === 'greenfall');
  const ironwood = regions.find((region) => region.key === 'ironwood');
  const rotmire = (await admin.query("select id from public.world_provinces where key='rotmire'")).rows[0];
  assert.ok(greenfall && ironwood);

  // A resolved strategic encounter must create one tactical engagement. The
  // assignment snapshot is immutable, and its result commits exactly once.
  const locationId='61000000-0000-4000-8000-000000000099';
  await admin.query("insert into public.world_locations(id,province_id,key,name,kind,position) values($1,$2,'qa-contact-ground','QA Contact Ground','ruin','{\"x\":77,\"z\":77}')",[locationId,greenfall.id]);
  const defenderPartyId = '30000000-0000-4000-8000-000000000002';
  const attackerArmyId = (await admin.query('select id from public.world_armies where party_id=$1', [firstEntry.partyId])).rows[0].id;
  const defenderArmyId = '40000000-0000-4000-8000-000000000002';
  const attackerStackId = '50000000-0000-4000-8000-000000000001';
  const defenderStackId = '50000000-0000-4000-8000-000000000002';
  await admin.query("update public.world_movement_orders set status='cancelled' where party_id=$1 and status in('queued','moving')",[firstEntry.partyId]);
  await admin.query("update public.world_parties set region_id=(select province_id from public.world_locations where id=$1),location_id=$1,route_id=null,route_progress=0,stance='neutral' where id=$2",[locationId,firstEntry.partyId]);
  await admin.query(`insert into public.world_parties(id,shard_id,region_id,name,kind,location_id,morale,stance)
    values($1,'earth-1',$2,'Rival Company','ai',$3,60,'hostile')`, [defenderPartyId, greenfall.id, locationId]);
  await admin.query(`insert into public.world_armies(id,party_id,combat_power)
    values($1,$2,45)`, [defenderArmyId, defenderPartyId]);
  await admin.query(`insert into public.world_unit_stacks(id,army_id,unit_key,tier,healthy)
    values($1,$2,'greenfall_guard',2,8),($3,$4,'rival_raider',1,6)`, [attackerStackId, attackerArmyId, defenderStackId, defenderArmyId]);
  await admin.query("insert into public.world_cargo(party_id,commodity_key,quantity) values($1,'grain',20) on conflict(party_id,commodity_key) do update set quantity=20",[defenderPartyId]);
  const contactLease=(await admin.query("select public.claim_world_region_lease($1,'worker-a',300) result",[greenfall.id])).rows[0].result;
  const contactRuntime=(await admin.query("select public.process_world_region_runtime($1,'worker-a',$2,100) result",[greenfall.id,contactLease.leaseEpoch])).rows[0].result;
  assert.ok(Number(contactRuntime.encountersCreated)>=1,'the scheduled region runtime must create hostile contact');
  const encounterRow=(await admin.query("select * from public.world_encounters where attacker_party_id in($1,$2) and defender_party_id in($1,$2) order by created_tick desc limit 1",[firstEntry.partyId,defenderPartyId])).rows[0];
  assert.ok(encounterRow?.id,'runtime-created encounter missing');
  const encounterId=encounterRow.id;
  assert.equal((await admin.query('select choice from public.world_encounter_decisions where encounter_id=$1 and party_id=$2',[encounterId,defenderPartyId])).rows[0].choice,'fight','AI contact must seed its deterministic decision');
  const firstDecision=(await admin.query("select public.submit_world_encounter_decision($1,$2,$3,'runtime-fight-owner',$4,'fight',null,'worker-a',$5) result",[userId,encounterId,firstEntry.partyId,Number(encounterRow.revision),contactLease.leaseEpoch])).rows[0].result;
  assert.equal(firstDecision.outcome,'battle');
  const engagement = (await admin.query('select id,mode,state from public.world_engagements where encounter_id=$1', [encounterId])).rows[0];
  assert.equal(engagement.mode, 'live_command');
  assert.equal(engagement.state, 'active');
  await admin.query('update public.world_engagements set seed=$1 where id=$2', [991, engagement.id]);
  const encounterRevision = Number((await admin.query('select revision from public.world_encounters where id=$1', [encounterId])).rows[0].revision);
  const expiredAssignment=(await admin.query("select public.living_world_issue_battle($1,$2,$3,'expired-proof') result",[userId,engagement.id,encounterRevision])).rows[0].result;
  await admin.query("update public.world_battle_assignments set expires_at=now()-interval '1 second' where id=$1",[expiredAssignment.id]);
  await admin.query('update public.world_parties set morale=morale where id=$1',[firstEntry.partyId]);
  const battleHandler=createLivingWorldBattleHandler({
    config:{url:'http://local',anonKey:'anon',serviceKey:'service',signingSecret:'embedded-postgres-battle-signing-secret-0001'},
    authenticate:authenticateHttp,
    rateLimit:rateLimitHttp,
    issue:async(actor,input)=>(await admin.query('select public.living_world_issue_battle($1,$2,$3,$4) result',[actor,input.engagementId,input.encounterRevision,input.requestId])).rows[0].result,
    assignment:async(actor,claim)=>(await admin.query('select public.living_world_get_battle_assignment($1,$2,$3) result',[actor,claim.assignmentId,claim.nonce])).rows[0].result,
    commit:async(claim,result)=>(await admin.query('select public.living_world_commit_battle($1,$2,$3,$4) result',[claim.assignmentId,claim.nonce,claim.encounterRevision,result])).rows[0].result,
  });
  const battleServer=createServer(battleHandler);await new Promise((resolve,reject)=>battleServer.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const battleBase=`http://127.0.0.1:${battleServer.address().port}`;
  const postBattle=async(token,payload)=>{const response=await fetch(battleBase,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  const launched=await postBattle('owner',{action:'launch',engagementId:engagement.id,encounterRevision,requestId:'postgres-live-command'});
  const assignment=launched.assignment;
  assert.notEqual(assignment.id,expiredAssignment.id,'an expired assignment must be replaced');
  assert.equal((await admin.query('select state from public.world_battle_assignments where id=$1',[expiredAssignment.id])).rows[0].state,'expired');
  assert.equal(assignment.force_snapshot.attackerPartyId, encounterRow.attacker_party_id);
  assert.equal(assignment.force_snapshot.defenderPartyId, encounterRow.defender_party_id);
  assert.equal(assignment.force_snapshot.engagementMode, 'live_command');
  assert.ok(Number(assignment.force_snapshot.startedTick)>=1);
  assert.ok(assignment.force_snapshot.stacks.length >= 3, 'recruited company members must join the authoritative battle force');
  assert.ok(assignment.force_snapshot.stacks.some((stack) => stack.unit_key === 'greenfall_militia' && Number(stack.healthy) >= 2));
  assert.ok(assignment.force_snapshot.supplies.length>=1,'supply state must be part of the immutable assignment');
  await expectError(admin.query('update public.world_parties set morale=morale-1 where id=$1',[firstEntry.partyId]),'battle_force_locked');
  await expectError(admin.query('update public.world_unit_stacks set healthy=healthy-1 where id=$1',[attackerStackId]),'battle_force_locked');
  await expectError(admin.query("update public.world_supplies set quantity=quantity-1 where party_id=$1 and supply_key='food'",[firstEntry.partyId]),'battle_force_locked');
  await admin.query("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id=$1",[greenfall.id]);
  const battleTakeover=(await admin.query("select public.claim_world_region_lease($1,'worker-b',300) result",[greenfall.id])).rows[0].result;
  const level=levelById(1),tacticalGame=new Game(new TerrainField(Number(assignment.force_snapshot.seed),level.theme,{size:level.size,nests:level.nests}),'normal','alexander',null,1,'living_world_battle');
  tacticalGame.configureLivingWorldBattle(assignment);let tacticalTick=0;while(!tacticalGame.over&&tacticalTick<216000){tacticalGame.update(1/30);tacticalTick++;}
  assert.equal(tacticalGame.over,true);
  const battleReplayPayload={version:1,completedTick:tacticalTick,commands:[]};
  const expectedBattleResult=verifyLivingWorldBattleReplay(assignment,battleReplayPayload);
  assert.ok(expectedBattleResult.cargoTransfers.length>=1,'verified battle must produce reachable cargo consequences when the loser has cargo');
  assert.ok(expectedBattleResult.prisoners.length>=1,'verified battle must produce reachable prisoner consequences when the loser has survivors');
  const controlBefore=(await admin.query('select p.owner_faction_id province_owner,l.owner_faction_id location_owner from public.world_provinces p join public.world_locations l on l.province_id=p.id where l.id=$1',[locationId])).rows[0];
  const cargoBefore=Number((await admin.query("select quantity from public.world_cargo where party_id=$1 and commodity_key='grain'",[defenderPartyId])).rows[0].quantity);
  const battleCompleted=await postBattle('owner',{action:'result',assignmentToken:launched.token,replay:battleReplayPayload});
  const battleResult=battleCompleted.result;
  assert.deepEqual(battleResult,expectedBattleResult,'HTTP result must be derived by the server replay verifier');
  const committed=battleCompleted;
  assert.equal(committed.ok, true);
  assert.equal(committed.duplicate, false);
  assert.equal(Number((await admin.query('select region_lease_epoch from public.world_battle_assignments where id=$1',[assignment.id])).rows[0].region_lease_epoch),Number(battleTakeover.leaseEpoch),'verified result must rebind to the current live region lease after takeover');
  await new Promise((resolve)=>battleServer.close(resolve));
  const consequenceSnapshot=await admin.query(`select
    (select jsonb_agg(to_jsonb(s) order by s.id) from public.world_unit_stacks s where s.army_id in($1,$2)) stacks,
    (select jsonb_agg(to_jsonb(p) order by p.id) from public.world_parties p where p.id in($3,$4)) parties,
    (select jsonb_agg(to_jsonb(c) order by c.party_id,c.commodity_key) from public.world_cargo c where c.party_id in($3,$4)) cargo,
    (select jsonb_agg(to_jsonb(w) order by w.captor_party_id,w.source_party_id,w.unit_key,w.tier) from public.world_prisoners w where w.captor_party_id in($3,$4)) prisoners`,[attackerArmyId,defenderArmyId,firstEntry.partyId,defenderPartyId]);
  const reorderedBattleResult=Object.fromEntries(Object.entries(battleResult).reverse());
  const battleReplay = (await admin.query('select public.living_world_commit_battle($1,$2,$3,$4) result', [assignment.id, assignment.nonce, encounterRevision, reorderedBattleResult])).rows[0].result;
  assert.equal(battleReplay.duplicate, true);
  const consequenceAfterReplay=await admin.query(`select
    (select jsonb_agg(to_jsonb(s) order by s.id) from public.world_unit_stacks s where s.army_id in($1,$2)) stacks,
    (select jsonb_agg(to_jsonb(p) order by p.id) from public.world_parties p where p.id in($3,$4)) parties,
    (select jsonb_agg(to_jsonb(c) order by c.party_id,c.commodity_key) from public.world_cargo c where c.party_id in($3,$4)) cargo,
    (select jsonb_agg(to_jsonb(w) order by w.captor_party_id,w.source_party_id,w.unit_key,w.tier) from public.world_prisoners w where w.captor_party_id in($3,$4)) prisoners`,[attackerArmyId,defenderArmyId,firstEntry.partyId,defenderPartyId]);
  assert.deepEqual(consequenceAfterReplay.rows[0],consequenceSnapshot.rows[0],'duplicate/reordered commit must not apply consequences twice');
  const attackerLoss=battleResult.casualties.find(row=>row.stackId===attackerStackId);const defenderLoss=battleResult.casualties.find(row=>row.stackId===defenderStackId);
  const capturedFrom=(partyId,unitKey)=>battleResult.prisoners.filter(row=>row.sourcePartyId===partyId&&row.unitKey===unitKey).reduce((sum,row)=>sum+row.quantity,0);
  assert.equal(Number((await admin.query('select healthy from public.world_unit_stacks where id=$1', [attackerStackId])).rows[0].healthy),8-(attackerLoss?.killed||0)-(attackerLoss?.wounded||0)-capturedFrom(firstEntry.partyId,'greenfall_guard'));
  assert.equal(Number((await admin.query('select healthy from public.world_unit_stacks where id=$1', [defenderStackId])).rows[0].healthy),6-(defenderLoss?.killed||0)-(defenderLoss?.wounded||0)-capturedFrom(defenderPartyId,'rival_raider'));
  assert.ok(Number((await admin.query('select count(*) count from public.world_prisoners where captor_party_id=$1',[battleResult.winnerPartyId])).rows[0].count)>=1);
  assert.equal(Number((await admin.query("select quantity from public.world_cargo where party_id=$1 and commodity_key='grain'",[defenderPartyId])).rows[0].quantity),cargoBefore-battleResult.cargoTransfers.filter(row=>row.fromPartyId===defenderPartyId&&row.commodityKey==='grain').reduce((sum,row)=>sum+row.quantity,0),'verified cargo transfer must debit the loser');
  assert.equal(Number((await admin.query('select morale from public.world_parties where id=$1',[firstEntry.partyId])).rows[0].morale),Number(assignment.force_snapshot.attackerPartyId===firstEntry.partyId?battleResult.morale.attacker:battleResult.morale.defender));
  assert.equal(Number((await admin.query('select morale from public.world_parties where id=$1',[defenderPartyId])).rows[0].morale),Number(assignment.force_snapshot.attackerPartyId===defenderPartyId?battleResult.morale.attacker:battleResult.morale.defender));
  for(const armyId of [attackerArmyId,defenderArmyId])assert.equal(Number((await admin.query('select combat_power from public.world_armies where id=$1',[armyId])).rows[0].combat_power),Number((await admin.query('select coalesce(sum(healthy*tier),0) power from public.world_unit_stacks where army_id=$1',[armyId])).rows[0].power),'combat power must be recomputed from surviving stacks');
  const companyConsequences=(await admin.query("select status,count(*)::integer count from public.world_company_members where party_id=$1 and status in('dead','wounded','captured') group by status",[firstEntry.partyId])).rows;
  const expectedCompanyLosses=battleResult.casualties.filter(row=>assignment.force_snapshot.armies.find(army=>army.party_id===firstEntry.partyId)?.id===assignment.force_snapshot.stacks.find(stack=>stack.id===row.stackId)?.army_id).reduce((sum,row)=>sum+row.killed+row.wounded,0)+battleResult.prisoners.filter(row=>row.sourcePartyId===firstEntry.partyId).reduce((sum,row)=>sum+row.quantity,0);
  if(expectedCompanyLosses>0)assert.ok(companyConsequences.reduce((sum,row)=>sum+row.count,0)>0,'verified company casualties must produce dead, wounded, or captured roster members where applicable');
  const controlAfter=(await admin.query('select p.owner_faction_id province_owner,l.owner_faction_id location_owner from public.world_provinces p join public.world_locations l on l.province_id=p.id where l.id=$1',[locationId])).rows[0];
  assert.deepEqual(controlAfter,controlBefore,'a field battle must not transfer province or location ownership; siege authority owns conquest');
  // Autosim uses the same immutable assignment and PostgreSQL consequence
  // transaction as live command. Prove that path independently after the live
  // battle instead of treating deterministic JS output as sufficient evidence.
  await admin.query('update public.world_unit_stacks set healthy=greatest(healthy,20),revision=revision+1 where army_id in($1,$2)',[attackerArmyId,defenderArmyId]);
  await admin.query('update public.world_parties set morale=case when id=$1 then 70 else 65 end,revision=revision+1 where id in($1,$2)',[firstEntry.partyId,defenderPartyId]);
  await admin.query("insert into public.world_cargo(party_id,commodity_key,quantity) values($1,'grain',16) on conflict(party_id,commodity_key) do update set quantity=16,reserved_quantity=0,revision=world_cargo.revision+1",[defenderPartyId]);
  const autosimEncounterId='70000000-0000-4000-8000-000000000099';
  await admin.query(`insert into public.world_encounters(id,shard_id,attacker_party_id,defender_party_id,created_tick,state,attacker_choice,defender_choice,terrain,scouting_snapshot)
    values($1,'earth-1',$2,$3,(select simulation_tick from public.world_shards where id='earth-1'),'choosing','auto-command','auto-command','{"kind":"plains"}','{}')`,[autosimEncounterId,firstEntry.partyId,defenderPartyId]);
  await admin.query("update public.world_encounters set state='battle',revision=revision+1 where id=$1",[autosimEncounterId]);
  const autosimEncounter=(await admin.query('select revision from public.world_encounters where id=$1',[autosimEncounterId])).rows[0];
  const autosimEngagement=(await admin.query('select id,mode from public.world_engagements where encounter_id=$1',[autosimEncounterId])).rows[0];
  assert.equal(autosimEngagement.mode,'autosim');
  const autosimAssignment=(await admin.query("select public.living_world_issue_battle($1,$2,$3,'postgres-autosim-proof') result",[userId,autosimEngagement.id,autosimEncounter.revision])).rows[0].result;
  const autosimResult=autosimBattleAssignment(autosimAssignment);
  assert.ok(autosimResult.casualties.some(row=>row.killed>0||row.wounded>0),'autosim must generate nonempty strategic casualties');
  assert.ok(autosimResult.prisoners.length>0&&autosimResult.cargoTransfers.length>0,'autosim must produce prisoner and cargo consequences when the loser has survivors and cargo');
  const autosimCommit=(await admin.query('select public.living_world_commit_battle($1,$2,$3,$4) result',[autosimAssignment.id,autosimAssignment.nonce,autosimEncounter.revision,autosimResult])).rows[0].result;
  assert.equal(autosimCommit.duplicate,false);
  assert.equal((await admin.query('select state from public.world_encounters where id=$1',[autosimEncounterId])).rows[0].state,'resolved');
  for(const armyId of [attackerArmyId,defenderArmyId])assert.equal(Number((await admin.query('select combat_power from public.world_armies where id=$1',[armyId])).rows[0].combat_power),Number((await admin.query('select coalesce(sum(healthy*tier),0) power from public.world_unit_stacks where army_id=$1',[armyId])).rows[0].power),'autosim must recompute combat power');
  assert.equal((await admin.query('select state from public.world_encounters where id=$1', [encounterId])).rows[0].state, 'resolved');
  await admin.query("update public.world_region_worker_leases set lease_until=now()-interval '1 second' where region_id=$1",[greenfall.id]);

  // Two independent connections racing for an unleased region serialize to one winner.
  const racerA = postgres.getPgClient();
  const racerB = postgres.getPgClient();
  await Promise.all([racerA.connect(), racerB.connect()]);
  await Promise.all([
    racerA.query("select set_config('request.jwt.claim.role','service_role',false)"),
    racerB.query("select set_config('request.jwt.claim.role','service_role',false)"),
  ]);
  const raceResults = await Promise.all([
    racerA.query("select public.claim_world_region_lease($1,'racer-a',300) result", [rotmire.id]),
    racerB.query("select public.claim_world_region_lease($1,'racer-b',300) result", [rotmire.id]),
  ]);
  assert.deepEqual(raceResults.map((result) => result.rows[0].result.ok).sort(), [false, true]);
  await Promise.all([racerA.end(), racerB.end()]);

  // An active lease excludes competitors. Reacquisition after expiry advances the epoch,
  // even if a process reuses the same worker ID.
  const sourceLease = (await admin.query("select public.claim_world_region_lease($1,'worker-a',5) result", [greenfall.id])).rows[0].result;
  const deniedLease = (await admin.query("select public.claim_world_region_lease($1,'worker-b',5) result", [greenfall.id])).rows[0].result;
  assert.equal(deniedLease.ok, false);
  assert.equal(deniedLease.leaseEpoch, sourceLease.leaseEpoch);
  await admin.query('update public.world_region_worker_leases set lease_until=now()-interval \'1 second\' where region_id=$1', [greenfall.id]);
  const renewedLease = (await admin.query("select public.claim_world_region_lease($1,'worker-a',300) result", [greenfall.id])).rows[0].result;
  assert.equal(renewedLease.leaseEpoch, sourceLease.leaseEpoch + 1);

  // Ownership is referentially valid and constrained to the region's planet.
  await admin.query("insert into public.world_planets(id,system_id,key,name) values('mars','sol','mars','Mars')");
  await admin.query("insert into public.world_factions(id,planet_id,name) values('mars_faction','mars','Mars Faction')");
  await expectError(admin.query("update public.world_provinces set owner_faction_id='missing_faction' where id=$1", [greenfall.id]), 'owner_faction_wrong_planet');
  assert.equal((await admin.query("select count(*) count from pg_constraint where conname='world_provinces_owner_faction_fk'")).rows[0].count, '1');
  await expectError(admin.query("update public.world_provinces set owner_faction_id='mars_faction' where id=$1", [greenfall.id]), 'owner_faction_wrong_planet');

  // Control mutation records the locked before-state in the same transaction.
  const before = (await admin.query('select revision,owner_faction_id,control_state from public.world_provinces where id=$1', [greenfall.id])).rows[0];
  const changed = (await admin.query("select public.mutate_world_region_control($1,$2,'ironwood_compact','ironwood_compact',0.4,'contested','harness battle',9,'worker-a',$3,'{}') result", [greenfall.id, before.revision, renewedLease.leaseEpoch])).rows[0].result;
  assert.equal(changed.revision, Number(before.revision) + 1);
  const history = (await admin.query('select previous_owner_faction_id,owner_faction_id,previous_state,control_state from public.world_region_control_history where region_id=$1 order by id desc limit 1', [greenfall.id])).rows[0];
  assert.equal(history.previous_owner_faction_id, before.owner_faction_id);
  assert.equal(history.previous_state, before.control_state);
  assert.equal(history.owner_faction_id, 'ironwood_compact');
  assert.equal(history.control_state, 'contested');
  await expectError(admin.query("select public.mutate_world_region_control($1,$2,'greenfall_freeholds','greenfall_freeholds',1,'controlled','stale',10,'worker-a',$3,'{}')", [greenfall.id, before.revision, renewedLease.leaseEpoch]), 'stale_region');
  const historyCount = Number((await admin.query('select count(*) count from public.world_region_control_history where region_id=$1', [greenfall.id])).rows[0].count);
  await admin.query(`create function public.reject_test_history() returns trigger language plpgsql as $$ begin raise exception 'forced_history_failure'; end $$;
    create trigger reject_test_history before insert on public.world_region_control_history for each row execute function public.reject_test_history()`);
  await expectError(admin.query("select public.mutate_world_region_control($1,$2,'greenfall_freeholds','greenfall_freeholds',1,'controlled','rollback',11,'worker-a',$3,'{}')", [greenfall.id, changed.revision, renewedLease.leaseEpoch]), 'forced_history_failure');
  await admin.query('drop trigger reject_test_history on public.world_region_control_history; drop function public.reject_test_history()');
  assert.equal(Number((await admin.query('select count(*) count from public.world_region_control_history where region_id=$1', [greenfall.id])).rows[0].count), historyCount);
  assert.equal((await admin.query('select owner_faction_id from public.world_provinces where id=$1', [greenfall.id])).rows[0].owner_faction_id, 'ironwood_compact');
  await admin.query("update public.world_provinces set control_state='occupied' where id=$1", [greenfall.id]);
  assert.equal((await admin.query('select cause from public.world_region_control_history where region_id=$1 order by id desc limit 1', [greenfall.id])).rows[0].cause, 'direct_control_change');

  // Build a cross-region route and prove source/destination epoch fencing and replay safety.
  const routeId = (await admin.query('select id from public.world_routes where origin_region_id=$1 and destination_region_id=$2 limit 1', [greenfall.id, ironwood.id])).rows[0].id;
  await admin.query('update public.world_parties set location_id=null,route_id=$1,region_id=$2 where id=$3', [routeId, greenfall.id, firstEntry.partyId]);
  await admin.query("insert into public.world_movement_orders(party_id,route_id,issued_tick,start_tick,expected_arrival_tick,status) values($1,$2,0,0,1,'moving')",[firstEntry.partyId,routeId]);
  const partyRevision = Number((await admin.query('select revision from public.world_parties where id=$1', [firstEntry.partyId])).rows[0].revision);
  const destinationLease = (await admin.query("select public.claim_world_region_lease($1,'worker-d',300) result", [ironwood.id])).rows[0].result;
  const handoff = (await admin.query("select public.request_world_region_handoff($1,$2,'handoff-1',$3,'worker-a',$4,'{}') result", [firstEntry.partyId, routeId, partyRevision, renewedLease.leaseEpoch])).rows[0].result;
  const replay = (await admin.query("select public.request_world_region_handoff($1,$2,'handoff-1',$3,'worker-a',$4,'{}') result", [firstEntry.partyId, routeId, partyRevision, renewedLease.leaseEpoch])).rows[0].result;
  assert.equal(replay.duplicate, true);
  await admin.query('update public.world_region_worker_leases set lease_until=now()-interval \'1 second\' where region_id=$1', [greenfall.id]);
  await admin.query("select public.claim_world_region_lease($1,'worker-a',300)", [greenfall.id]);
  await expectError(admin.query("select public.request_world_region_handoff($1,$2,'handoff-1',$3,'worker-a',$4,'{}')", [firstEntry.partyId, routeId, partyRevision, renewedLease.leaseEpoch]), 'source_lease_required');
  await admin.query('update public.world_region_worker_leases set lease_until=now()-interval \'1 second\' where region_id=$1', [ironwood.id]);
  const destinationTakeover = (await admin.query("select public.claim_world_region_lease($1,'worker-e',300) result", [ironwood.id])).rows[0].result;
  await expectError(admin.query("select public.complete_world_region_handoff($1,'worker-d',$2)", [handoff.handoffId, destinationLease.leaseEpoch]), 'destination_lease_required');
  const completed = (await admin.query("select public.complete_world_region_handoff($1,'worker-e',$2) result", [handoff.handoffId, destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(completed.regionId, ironwood.id);
  const completeReplay = (await admin.query("select public.complete_world_region_handoff($1,'worker-e',$2) result", [handoff.handoffId, destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(completeReplay.duplicate, true);
  assert.equal(Number((await admin.query("select count(*) count from public.world_region_handoffs where party_id=$1 and request_id='handoff-1' and status='accepted'", [firstEntry.partyId])).rows[0].count), 1);

  // Siege declaration is player-owned and idempotent. Only the current region
  // lease may resolve it, and occupation writes control, reputation, holding,
  // history, and the public world event in one transaction.
  const siegeParty = (await admin.query('select location_id,revision from public.world_parties where id=$1', [firstEntry.partyId])).rows[0];
  const declared = (await admin.query("select public.living_world_governance_command($1,'siege-declare-1',$2,$3,'declare_siege',jsonb_build_object('locationId',$4::text,'attackerFactionId','greenfall_freeholds')) result", [userId, firstEntry.partyId, siegeParty.revision, siegeParty.location_id])).rows[0].result;
  assert.equal(declared.duplicate, false);
  const declareReplay = (await admin.query("select public.living_world_governance_command($1,'siege-declare-1',$2,$3,'declare_siege',jsonb_build_object('locationId',$4::text,'attackerFactionId','greenfall_freeholds')) result", [userId, firstEntry.partyId, siegeParty.revision, siegeParty.location_id])).rows[0].result;
  assert.equal(declareReplay.duplicate, true);
  await admin.query('update public.world_sieges set progress=.99,defender_supply=.1 where id=$1',[declared.siegeId]);
  await admin.query('update public.world_region_states set simulation_tick=48 where region_id=$1',[ironwood.id]);
  const siegeRuntime=(await admin.query("select public.process_world_region_runtime($1,'worker-e',$2,100) result",[ironwood.id,destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(Number(siegeRuntime.siegesAdvanced),1,'scheduled region runtime must advance active sieges');
  const advanced=(await admin.query('select status,outcome,progress,defender_supply "defenderSupply",revision "siegeRevision" from public.world_sieges where id=$1',[declared.siegeId])).rows[0];
  assert.equal(advanced.status,'resolved');
  assert.equal(advanced.outcome,'attacker_victory','scheduled runtime must resolve a terminal siege');
  assert.ok(Number(advanced.progress) > 0);
  assert.ok(Number(advanced.defenderSupply) <= 100);
  const runtimeResolution=(await admin.query('select * from public.world_siege_resolutions where siege_id=$1',[declared.siegeId])).rows[0];
  const resolutionReplay = (await admin.query("select public.resolve_world_siege($1,$2,$3,'attacker_victory','worker-e',$4,49) result", [declared.siegeId,runtimeResolution.request_id,runtimeResolution.expected_revision,destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(resolutionReplay.duplicate, true);
  assert.equal((await admin.query('select owner_faction_id from public.world_locations where id=$1', [siegeParty.location_id])).rows[0].owner_faction_id, 'greenfall_freeholds');
  assert.equal((await admin.query('select owner_faction_id from public.world_provinces where id=$1', [ironwood.id])).rows[0].owner_faction_id, 'greenfall_freeholds');
  assert.equal((await admin.query('select owner_user_id from public.world_holdings where granted_by_siege_id=$1', [declared.siegeId])).rows[0].owner_user_id, userId);
  assert.equal(Number((await admin.query("select score from public.world_faction_reputation where user_id=$1 and faction_id='greenfall_freeholds'", [userId])).rows[0].score), 25);
  assert.equal(Number((await admin.query("select count(*) count from public.world_events where event_type='siege.resolved' and payload->>'siegeId'=$1", [declared.siegeId])).rows[0].count), 1);
  assert.equal(Number((await admin.query("select count(*) count from public.world_governance_audit where aggregate_id=$1", [declared.siegeId])).rows[0].count), 2);
  const holdingId = (await admin.query('select id from public.world_holdings where granted_by_siege_id=$1', [declared.siegeId])).rows[0].id;
  const partyAfterSiege = (await admin.query('select revision from public.world_parties where id=$1', [firstEntry.partyId])).rows[0];
  const permission = (await admin.query("select public.living_world_governance_command($1,'holding-permission-1',$2,$3,'set_holding_permission',jsonb_build_object('holdingId',$4::text,'userId',$5::text,'permission','garrison','enabled',true)) result", [userId, firstEntry.partyId, partyAfterSiege.revision, holdingId, otherUserId])).rows[0].result;
  assert.equal(permission.ok, true);
  assert.equal(Number((await admin.query("select count(*) count from public.world_holding_permissions where holding_id=$1 and user_id=$2 and permission='garrison'", [holdingId, otherUserId])).rows[0].count), 1);

  // Logistics ticks are lease-fenced and replay-safe. A retry cannot consume
  // supplies or reprice markets twice.
  await admin.query('update public.world_region_states set simulation_tick=50 where region_id=$1', [ironwood.id]);
  const foodBefore = Number((await admin.query("select quantity from public.world_supplies where party_id=$1 and supply_key='food'", [firstEntry.partyId])).rows[0].quantity);
  const treasuryBeforeLogistics = Number((await admin.query('select treasury from public.world_companies where party_id=$1', [firstEntry.partyId])).rows[0].treasury);
  const logistics = (await admin.query("select public.process_world_region_logistics($1,50,'worker-e',$2) result", [ironwood.id, destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(logistics.duplicate, false);
  const foodAfter = Number((await admin.query("select quantity from public.world_supplies where party_id=$1 and supply_key='food'", [firstEntry.partyId])).rows[0].quantity);
  const treasuryAfterLogistics = Number((await admin.query('select treasury from public.world_companies where party_id=$1', [firstEntry.partyId])).rows[0].treasury);
  assert.ok(treasuryAfterLogistics < treasuryBeforeLogistics, 'company wages must settle during the logistics tick');
  assert.ok(Number((await admin.query("select coalesce(sum(quantity),0) quantity from public.world_cargo where party_id='13000000-0000-4000-8000-000000000002' and commodity_key='iron'")).rows[0].quantity) > 0, 'caravan must move market stock into physical cargo');
  const logisticsReplay = (await admin.query("select public.process_world_region_logistics($1,50,'worker-e',$2) result", [ironwood.id, destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(logisticsReplay.duplicate, true);
  assert.equal(Number((await admin.query("select quantity from public.world_supplies where party_id=$1 and supply_key='food'", [firstEntry.partyId])).rows[0].quantity), foodAfter);
  assert.ok(foodAfter <= foodBefore);
  await expectError(admin.query("select public.process_world_region_logistics($1,51,'worker-e',$2)", [ironwood.id, destinationTakeover.leaseEpoch]), 'future_logistics_tick');
  await expectError(admin.query("select public.process_world_region_logistics($1,1,'worker-d',$2)", [ironwood.id, destinationLease.leaseEpoch]), 'region_lease_required');

  // The combined release has one authority path. The region runtime advances
  // faction and logistics state under the same lease; shard mutation is gone.
  const runtime = (await admin.query("select public.process_world_region_runtime($1,'worker-e',$2,100) result", [ironwood.id, destinationTakeover.leaseEpoch])).rows[0].result;
  assert.equal(runtime.ok, true);
  assert.equal(runtime.regionId, ironwood.id);
  assert.ok(Number(runtime.tick) >= 2);
  assert.equal(Number((await admin.query('select count(*) count from public.world_region_runtime_ticks where region_id=$1 and world_tick=$2', [ironwood.id, runtime.tick])).rows[0].count), 1);
  await expectError(admin.query("select public.living_world_process_shard('earth-1','legacy-worker',30,100)"), 'shard_worker_retired');

  // RLS: an authenticated user can see their handoff, but not another user's.
  await admin.query('grant usage on schema public to authenticated; grant select on public.world_region_handoffs,public.world_parties to authenticated');
  const client = postgres.getPgClient();
  await client.connect();
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [otherUserId]);
  assert.equal((await client.query('select count(*) count from public.world_region_handoffs')).rows[0].count, '0');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  assert.equal((await client.query('select count(*) count from public.world_region_handoffs')).rows[0].count, '2');
  await client.end();

  console.log(`Earth region PostgreSQL authority checks passed (${migrations.length} migrations, PostgreSQL ${postgres.version || 'embedded'}).`);
} finally {
  if (admin) await admin.end().catch(() => {});
  await postgres.stop().catch(() => {});
  await rm(databaseDir, { recursive: true, force: true });
}
