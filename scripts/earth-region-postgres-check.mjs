import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

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
  await admin.query(`insert into public.game_characters(id,user_id,client_character_id,name,class_key,race_key)
    values('20000000-0000-4000-8000-000000000001',$1,'owner-char','Owner','vanguard','human')`, [userId]);
  await admin.query(`insert into public.world_tutorial_progress(user_id,character_id,movement_complete,town_complete,recruitment_complete,trade_complete,battle_complete,completed_at)
    values($1,'20000000-0000-4000-8000-000000000001',true,true,true,true,true,now())`, [userId]);

  // World entry must succeed after region_id is NOT NULL and retries must not duplicate state.
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const firstEntry = (await admin.query("select public.enter_living_world($1,'20000000-0000-4000-8000-000000000001') result", [userId])).rows[0].result;
  assert.equal(firstEntry.ok, true);
  assert.equal(firstEntry.duplicate, false);
  const enteredParty = (await admin.query('select id,region_id,revision from public.world_parties where id=$1', [firstEntry.partyId])).rows[0];
  assert.ok(enteredParty.region_id);
  const secondEntry = (await admin.query("select public.enter_living_world($1,'20000000-0000-4000-8000-000000000001') result", [userId])).rows[0].result;
  assert.equal(secondEntry.duplicate, true);
  assert.equal(Number((await admin.query('select count(*) count from public.world_parties where owner_user_id=$1', [userId])).rows[0].count), 1);

  const regions = (await admin.query("select id,key,revision from public.world_provinces where key in ('greenfall','ironwood') order by key")).rows;
  const greenfall = regions.find((region) => region.key === 'greenfall');
  const ironwood = regions.find((region) => region.key === 'ironwood');
  const rotmire = (await admin.query("select id from public.world_provinces where key='rotmire'")).rows[0];
  assert.ok(greenfall && ironwood);

  // A resolved strategic encounter must create one tactical engagement. The
  // assignment snapshot is immutable, and its result commits exactly once.
  const locationId = (await admin.query('select id from public.world_locations where province_id=$1 order by id limit 1', [greenfall.id])).rows[0].id;
  const defenderPartyId = '30000000-0000-4000-8000-000000000002';
  const attackerArmyId = (await admin.query('select id from public.world_armies where party_id=$1', [firstEntry.partyId])).rows[0].id;
  const defenderArmyId = '40000000-0000-4000-8000-000000000002';
  const attackerStackId = '50000000-0000-4000-8000-000000000001';
  const defenderStackId = '50000000-0000-4000-8000-000000000002';
  await admin.query(`insert into public.world_parties(id,shard_id,region_id,owner_user_id,name,kind,location_id,morale)
    values($1,'earth-1',$2,$3,'Rival Company','player',$4,60)`, [defenderPartyId, greenfall.id, otherUserId, locationId]);
  await admin.query(`insert into public.world_armies(id,party_id,commander_user_id,combat_power)
    values($1,$2,$3,45)`, [defenderArmyId, defenderPartyId, otherUserId]);
  await admin.query(`insert into public.world_unit_stacks(id,army_id,unit_key,tier,healthy)
    values($1,$2,'greenfall_guard',2,40),($3,$4,'rival_raider',1,35)`, [attackerStackId, attackerArmyId, defenderStackId, defenderArmyId]);
  const encounterId = '60000000-0000-4000-8000-000000000001';
  await admin.query(`insert into public.world_encounters(id,shard_id,attacker_party_id,defender_party_id,created_tick,state,attacker_choice,defender_choice,terrain,scouting_snapshot)
    values($1,'earth-1',$2,$3,0,'choosing','auto-command','auto-command','{"kind":"plains"}','{}')`, [encounterId, firstEntry.partyId, defenderPartyId]);
  await admin.query("update public.world_encounters set state='battle',revision=revision+1 where id=$1", [encounterId]);
  const engagement = (await admin.query('select id,mode,state from public.world_engagements where encounter_id=$1', [encounterId])).rows[0];
  assert.equal(engagement.mode, 'autosim');
  assert.equal(engagement.state, 'active');
  const encounterRevision = Number((await admin.query('select revision from public.world_encounters where id=$1', [encounterId])).rows[0].revision);
  const assignment = (await admin.query("select public.living_world_issue_battle($1,$2,$3,'postgres-autosim') result", [userId, engagement.id, encounterRevision])).rows[0].result;
  assert.equal(assignment.force_snapshot.attackerPartyId, firstEntry.partyId);
  assert.equal(assignment.force_snapshot.defenderPartyId, defenderPartyId);
  assert.equal(assignment.force_snapshot.engagementMode, 'autosim');
  assert.equal(assignment.force_snapshot.startedTick, 0);
  assert.equal(assignment.force_snapshot.stacks.length, 2);
  const battleResult = { outcome: 'attacker_victory', winnerPartyId: firstEntry.partyId, casualties: [
    { stackId: attackerStackId, killed: 1, wounded: 2 },
    { stackId: defenderStackId, killed: 4, wounded: 3 },
  ], morale: { attacker: 72, defender: 25 }, cargoTransfers: [], prisoners: [], retreatRoutes: [], stateHash: 'a'.repeat(64), completedTick: 4 };
  const committed = (await admin.query('select public.living_world_commit_battle($1,$2,$3,$4) result', [assignment.id, assignment.nonce, encounterRevision, battleResult])).rows[0].result;
  assert.equal(committed.ok, true);
  assert.equal(committed.duplicate, false);
  const battleReplay = (await admin.query('select public.living_world_commit_battle($1,$2,$3,$4) result', [assignment.id, assignment.nonce, encounterRevision, battleResult])).rows[0].result;
  assert.equal(battleReplay.duplicate, true);
  assert.equal(Number((await admin.query('select healthy from public.world_unit_stacks where id=$1', [attackerStackId])).rows[0].healthy), 37);
  assert.equal(Number((await admin.query('select healthy from public.world_unit_stacks where id=$1', [defenderStackId])).rows[0].healthy), 28);
  assert.equal((await admin.query('select state from public.world_encounters where id=$1', [encounterId])).rows[0].state, 'resolved');

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
  assert.equal(Number((await admin.query('select count(*) count from public.world_region_handoffs where party_id=$1 and status=\'accepted\'', [firstEntry.partyId])).rows[0].count), 1);

  // RLS: an authenticated user can see their handoff, but not another user's.
  await admin.query('grant usage on schema public to authenticated; grant select on public.world_region_handoffs,public.world_parties to authenticated');
  const client = postgres.getPgClient();
  await client.connect();
  await client.query('set role authenticated');
  await client.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [otherUserId]);
  assert.equal((await client.query('select count(*) count from public.world_region_handoffs')).rows[0].count, '0');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  assert.equal((await client.query('select count(*) count from public.world_region_handoffs')).rows[0].count, '1');
  await client.end();

  console.log(`Earth region PostgreSQL authority checks passed (${migrations.length} migrations, PostgreSQL ${postgres.version || 'embedded'}).`);
} finally {
  if (admin) await admin.end().catch(() => {});
  await postgres.stop().catch(() => {});
  await rm(databaseDir, { recursive: true, force: true });
}
