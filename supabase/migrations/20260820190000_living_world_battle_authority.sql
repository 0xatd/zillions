-- Tactical clients receive immutable assignments. Only the battle authority can
-- submit a result, and this transaction validates and applies the full outcome.
begin;
create extension if not exists pgcrypto;

create table public.world_battle_assignments (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.world_engagements(id) on delete cascade,
  encounter_id uuid not null references public.world_encounters(id) on delete cascade,
  encounter_revision bigint not null check (encounter_revision > 0),
  requested_by uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 96),
  nonce uuid not null default gen_random_uuid(),
  force_snapshot jsonb not null,
  state text not null default 'issued' check (state in ('issued','committed','expired','cancelled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  result_hash text,
  unique(requested_by, request_id),
  unique(nonce)
);
create unique index world_battle_one_open_assignment on public.world_battle_assignments(engagement_id) where state='issued';
alter table public.world_battle_assignments enable row level security;
create policy world_battle_assignment_requester_read on public.world_battle_assignments for select to authenticated using(requested_by=auth.uid());
create table public.world_prisoners (
  captor_party_id uuid not null references public.world_parties(id) on delete cascade,
  source_party_id uuid not null references public.world_parties(id) on delete cascade,
  unit_key text not null,
  tier smallint not null check(tier between 1 and 10),
  quantity integer not null check(quantity>=0),
  revision bigint not null default 1,
  primary key(captor_party_id,source_party_id,unit_key,tier),
  check(captor_party_id<>source_party_id)
);
alter table public.world_prisoners enable row level security;
create policy world_prisoner_captor_read on public.world_prisoners for select to authenticated using(exists(select 1 from public.world_parties p where p.id=captor_party_id and p.owner_user_id=auth.uid()));

create or replace function public.living_world_issue_battle(p_actor uuid,p_engagement uuid,p_encounter_revision bigint,p_request_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_eng public.world_engagements%rowtype; v_enc public.world_encounters%rowtype; v_assignment public.world_battle_assignments%rowtype; v_snapshot jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_actor is null or p_request_id is null or length(p_request_id) not between 1 and 96 then raise exception 'invalid_request'; end if;
  select * into v_assignment from public.world_battle_assignments where requested_by=p_actor and request_id=p_request_id;
  if found then
    if v_assignment.engagement_id<>p_engagement or v_assignment.encounter_revision<>p_encounter_revision then raise exception 'idempotency_conflict'; end if;
    return to_jsonb(v_assignment);
  end if;
  select * into v_eng from public.world_engagements where id=p_engagement for update;
  if not found or v_eng.state not in('active','retreat') then raise exception 'engagement_not_active'; end if;
  select * into v_enc from public.world_encounters where id=v_eng.encounter_id for update;
  if v_enc.revision<>p_encounter_revision or v_enc.state<>'battle' then raise exception 'stale_encounter_revision'; end if;
  if not exists(select 1 from public.world_parties p where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id) and p.owner_user_id=p_actor) then raise exception 'not_encounter_commander'; end if;
  select jsonb_build_object(
    'engagementId',v_eng.id,'encounterId',v_enc.id,'encounterRevision',v_enc.revision,'seed',v_eng.seed,'terrain',v_enc.terrain,
    'parties',(select jsonb_agg(to_jsonb(p) order by p.id) from public.world_parties p where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'armies',(select jsonb_agg(to_jsonb(a) order by a.id) from public.world_armies a join public.world_parties p on p.id=a.party_id where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'stacks',(select jsonb_agg(to_jsonb(s) order by s.id) from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'cargo',(select coalesce(jsonb_agg(to_jsonb(c) order by c.party_id,c.commodity_key),'[]'::jsonb) from public.world_cargo c where c.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id))
  ) into v_snapshot;
  insert into public.world_battle_assignments(engagement_id,encounter_id,encounter_revision,requested_by,request_id,force_snapshot,expires_at)
    values(v_eng.id,v_enc.id,v_enc.revision,p_actor,p_request_id,v_snapshot,now()+interval '2 hours') returning * into v_assignment;
  return to_jsonb(v_assignment);
end $$;

create or replace function public.living_world_commit_battle(p_assignment uuid,p_nonce text,p_encounter_revision bigint,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_a public.world_battle_assignments%rowtype; v_eng public.world_engagements%rowtype; v_enc public.world_encounters%rowtype; v_row jsonb; v_stack public.world_unit_stacks%rowtype; v_from uuid; v_to uuid; v_key text; v_qty numeric; v_hash text; v_winner uuid; v_tick bigint; v_sequence bigint; v_route uuid; v_shard text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' then raise exception 'invalid_result'; end if;
  -- Discover the shard without a row lock, then use the same shard-first lock
  -- order as commands and the simulation worker.
  select e.shard_id into v_shard from public.world_battle_assignments a join public.world_encounters e on e.id=a.encounter_id where a.id=p_assignment;
  if not found then raise exception 'invalid_assignment'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-shard:'||v_shard,0));
  perform 1 from public.world_shards where id=v_shard for update;
  select * into v_a from public.world_battle_assignments where id=p_assignment for update;
  if not found or v_a.nonce::text<>p_nonce or v_a.encounter_revision<>p_encounter_revision then raise exception 'invalid_assignment'; end if;
  v_hash:=encode(digest(p_result::text,'sha256'),'hex');
  if v_a.state='committed' then
    if v_a.result_hash<>v_hash then raise exception 'battle_result_replay_conflict'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'assignmentId',v_a.id,'resultHash',v_hash);
  end if;
  if v_a.state<>'issued' or v_a.expires_at<=now() then raise exception 'battle_assignment_not_active'; end if;
  select * into v_eng from public.world_engagements where id=v_a.engagement_id for update;
  select * into v_enc from public.world_encounters where id=v_a.encounter_id for update;
  if v_enc.revision<>p_encounter_revision or v_enc.state<>'battle' or v_eng.state not in('active','retreat') then raise exception 'stale_encounter_revision'; end if;
  v_winner:=nullif(p_result->>'winnerPartyId','')::uuid;
  if v_winner is not null and v_winner not in(v_enc.attacker_party_id,v_enc.defender_party_id) then raise exception 'invalid_winner'; end if;
  if (p_result->>'outcome'='attacker_victory' and v_winner is distinct from v_enc.attacker_party_id)
    or (p_result->>'outcome'='defender_victory' and v_winner is distinct from v_enc.defender_party_id)
    or (p_result->>'outcome' in('draw','retreat') and v_winner is not null) then raise exception 'winner_outcome_mismatch'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_result->'casualties','[]'::jsonb)) loop
    select * into v_stack from public.world_unit_stacks where id=(v_row->>'stackId')::uuid for update;
    if not found or not exists(select 1 from public.world_armies a where a.id=v_stack.army_id and a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id)) then raise exception 'invalid_casualty_stack'; end if;
    if (v_row->>'killed')::integer<0 or (v_row->>'wounded')::integer<0 or (v_row->>'killed')::integer+(v_row->>'wounded')::integer>v_stack.healthy then raise exception 'impossible_casualties'; end if;
    update public.world_unit_stacks set healthy=healthy-(v_row->>'killed')::integer-(v_row->>'wounded')::integer,wounded=wounded+(v_row->>'wounded')::integer,revision=revision+1 where id=v_stack.id;
  end loop;
  update public.world_parties set morale=case when id=v_enc.attacker_party_id then greatest(0,least(100,(p_result->'morale'->>'attacker')::numeric)) else greatest(0,least(100,(p_result->'morale'->>'defender')::numeric)) end,stance='neutral',revision=revision+1,updated_at=now() where id in(v_enc.attacker_party_id,v_enc.defender_party_id);
  for v_row in select value from jsonb_array_elements(coalesce(p_result->'cargoTransfers','[]'::jsonb)) loop
    v_from:=(v_row->>'fromPartyId')::uuid; v_to:=(v_row->>'toPartyId')::uuid; v_key:=v_row->>'commodityKey'; v_qty:=(v_row->>'quantity')::numeric;
    if v_from not in(v_enc.attacker_party_id,v_enc.defender_party_id) or v_to not in(v_enc.attacker_party_id,v_enc.defender_party_id) or v_from=v_to or v_qty<0 then raise exception 'invalid_cargo_transfer'; end if;
    perform 1 from public.world_cargo where party_id=v_from and commodity_key=v_key and quantity-reserved_quantity>=v_qty for update;
    if not found then raise exception 'insufficient_battle_cargo'; end if;
    update public.world_cargo set quantity=quantity-v_qty,revision=revision+1 where party_id=v_from and commodity_key=v_key;
    insert into public.world_cargo(party_id,commodity_key,quantity) values(v_to,v_key,v_qty) on conflict(party_id,commodity_key) do update set quantity=world_cargo.quantity+excluded.quantity,revision=world_cargo.revision+1;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_result->'prisoners','[]'::jsonb)) loop
    v_to:=(v_row->>'captorPartyId')::uuid; v_from:=(v_row->>'sourcePartyId')::uuid; v_key:=v_row->>'unitKey';
    if v_to not in(v_enc.attacker_party_id,v_enc.defender_party_id) or v_from not in(v_enc.attacker_party_id,v_enc.defender_party_id) or v_to=v_from or (v_row->>'quantity')::integer<0 then raise exception 'invalid_prisoners'; end if;
    select s.* into v_stack from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id=v_from and s.unit_key=v_key and s.tier=(v_row->>'tier')::smallint for update of s;
    if not found or v_stack.healthy<(v_row->>'quantity')::integer then raise exception 'impossible_prisoners'; end if;
    update public.world_unit_stacks set healthy=healthy-(v_row->>'quantity')::integer,revision=revision+1 where id=v_stack.id;
    insert into public.world_prisoners(captor_party_id,source_party_id,unit_key,tier,quantity) values(v_to,v_from,v_key,(v_row->>'tier')::smallint,(v_row->>'quantity')::integer)
      on conflict(captor_party_id,source_party_id,unit_key,tier) do update set quantity=world_prisoners.quantity+excluded.quantity,revision=world_prisoners.revision+1;
  end loop;
  for v_row in select value from jsonb_array_elements(coalesce(p_result->'retreatRoutes','[]'::jsonb)) loop
    v_from:=(v_row->>'partyId')::uuid; v_route:=(v_row->>'routeId')::uuid;
    if v_from not in(v_enc.attacker_party_id,v_enc.defender_party_id) or not exists(select 1 from public.world_routes r join public.world_provinces p on p.id=r.province_id where r.id=v_route and p.shard_id=v_enc.shard_id) then raise exception 'invalid_retreat_route'; end if;
    update public.world_parties set location_id=null,route_id=v_route,route_progress=0,stance='fleeing',revision=revision+1,updated_at=now() where id=v_from;
  end loop;
  select simulation_tick into v_tick from public.world_shards where id=v_enc.shard_id;
  insert into public.world_battle_results(engagement_id,winner_party_id,outcome,casualties,prisoners,cargo_transfers,retreat_routes,state_hash,committed_tick)
    values(v_eng.id,v_winner,p_result->>'outcome',p_result->'casualties',coalesce(p_result->'prisoners','{}'),p_result->'cargoTransfers',coalesce(p_result->'retreatRoutes','{}'),p_result->>'stateHash',v_tick);
  update public.world_engagements set state='complete',completed_tick=v_tick,revision=revision+1 where id=v_eng.id;
  update public.world_encounters set state='resolved',revision=revision+1 where id=v_enc.id;
  update public.world_battle_assignments set state='committed',committed_at=now(),result_hash=v_hash where id=v_a.id;
  select coalesce(max(sequence),0)+1 into v_sequence from public.world_events where shard_id=v_enc.shard_id;
  insert into public.world_events(shard_id,sequence,tick,event_type,aggregate_type,aggregate_id,aggregate_revision,payload)
    values(v_enc.shard_id,v_sequence,v_tick,'battle.committed','encounter',v_enc.id::text,v_enc.revision+1,jsonb_build_object('assignmentId',v_a.id,'resultHash',v_hash,'outcome',p_result->>'outcome'));
  return jsonb_build_object('ok',true,'duplicate',false,'assignmentId',v_a.id,'resultHash',v_hash,'encounterRevision',v_enc.revision+1);
end $$;

revoke all on function public.living_world_issue_battle(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.living_world_issue_battle(uuid,uuid,bigint,text) to service_role;
revoke all on function public.living_world_commit_battle(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.living_world_commit_battle(uuid,text,bigint,jsonb) to service_role;
commit;
