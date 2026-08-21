-- Lease-fenced siege resolution, occupation, reputation, and holdings.
begin;

alter table public.world_locations
  add column is_region_seat boolean not null default false;
update public.world_locations set is_region_seat=true
where key in ('greenfall-crossing','ironwood','rotmire');
create unique index world_locations_one_region_seat
  on public.world_locations(province_id) where is_region_seat;

create table public.world_sieges (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  location_id uuid not null references public.world_locations(id) on delete restrict,
  attacker_party_id uuid not null references public.world_parties(id) on delete restrict,
  attacker_faction_id text not null references public.world_factions(id) on delete restrict,
  defender_faction_id text references public.world_factions(id) on delete restrict,
  status text not null default 'preparing' check(status in ('preparing','active','breached','resolved','lifted')),
  attacker_stance text not null default 'encircle' check(attacker_stance in ('encircle','assault','starve')),
  blockade_strength numeric(5,4) not null default 0 check(blockade_strength between 0 and 1),
  relief_strength numeric(5,4) not null default 0 check(relief_strength between 0 and 1),
  defender_supply numeric(8,3) not null default 100 check(defender_supply between 0 and 100),
  surrender_status text not null default 'none' check(surrender_status in ('none','offered','accepted','rejected')),
  progress numeric(5,4) not null default 0 check(progress between 0 and 1),
  started_tick bigint not null check(started_tick>=0),
  resolved_tick bigint check(resolved_tick is null or resolved_tick>=started_tick),
  outcome text check(outcome is null or outcome in ('attacker_victory','defender_victory','lifted')),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index world_sieges_one_open_location on public.world_sieges(location_id)
  where status in ('preparing','active','breached');
create index world_sieges_region_status on public.world_sieges(region_id,status);

create table public.world_faction_reputation (
  user_id uuid not null references auth.users(id) on delete cascade,
  faction_id text not null references public.world_factions(id) on delete cascade,
  score integer not null default 0 check(score between -1000 and 1000),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(user_id,faction_id)
);

create table public.world_holdings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.world_locations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_faction_id text not null references public.world_factions(id) on delete restrict,
  holding_type text not null check(holding_type in ('governorship','estate','outpost')),
  status text not null default 'active' check(status in ('active','contested','revoked')),
  granted_by_siege_id uuid references public.world_sieges(id) on delete set null,
  revision bigint not null default 1,
  granted_at timestamptz not null default now()
);
create unique index world_holdings_active_governance on public.world_holdings(location_id)
  where holding_type='governorship' and status in ('active','contested');

create table public.world_holding_permissions (
  holding_id uuid not null references public.world_holdings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check(permission in ('manage','trade','garrison','tax')),
  granted_by uuid not null references auth.users(id) on delete restrict,
  revision bigint not null default 1,
  granted_at timestamptz not null default now(),
  primary key(holding_id,user_id,permission)
);

create table public.world_governance_audit (
  id bigint generated always as identity primary key,
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  world_tick bigint not null check(world_tick>=0),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.world_governance_commands (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check(length(request_id) between 1 and 96),
  party_id uuid not null references public.world_parties(id) on delete cascade,
  action text not null check(action in ('declare_siege','set_siege_stance','offer_surrender','accept_surrender','lift_siege','set_holding_permission')),
  expected_revision bigint not null check(expected_revision>0),
  payload jsonb not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_user_id,request_id)
);

create table public.world_siege_resolutions (
  siege_id uuid not null references public.world_sieges(id) on delete cascade,
  request_id text not null check(length(request_id) between 1 and 96),
  expected_revision bigint not null check(expected_revision>0),
  outcome text not null check(outcome in ('attacker_victory','defender_victory','lifted')),
  worker_id text not null,
  lease_epoch bigint not null check(lease_epoch>0),
  response jsonb not null,
  resolved_at timestamptz not null default now(),
  primary key(siege_id,request_id)
);

create table public.world_siege_advances (
  siege_id uuid not null references public.world_sieges(id) on delete cascade,
  request_id text not null check(length(request_id) between 1 and 96),
  expected_revision bigint not null check(expected_revision>0),
  worker_id text not null,
  lease_epoch bigint not null check(lease_epoch>0),
  world_tick bigint not null check(world_tick>=0),
  blockade numeric(5,4) not null check(blockade between 0 and 1),
  relief numeric(5,4) not null check(relief between 0 and 1),
  response jsonb not null,
  advanced_at timestamptz not null default now(),
  primary key(siege_id,request_id)
);

create or replace function public.living_world_governance_command(
  p_actor uuid,p_request_id text,p_party uuid,p_expected_revision bigint,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.world_governance_commands%rowtype; v_party public.world_parties%rowtype;
  v_location public.world_locations%rowtype; v_siege public.world_sieges%rowtype; v_faction text; v_tick bigint; v_result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96
    or p_action not in ('declare_siege','set_siege_stance','offer_surrender','accept_surrender','lift_siege','set_holding_permission')
    or coalesce(jsonb_typeof(p_payload),'null')<>'object' then raise exception 'invalid_governance_command'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-governance:'||p_actor::text||':'||p_request_id,0));
  select * into v_old from public.world_governance_commands where actor_user_id=p_actor and request_id=p_request_id;
  if found then
    if v_old.party_id<>p_party or v_old.action<>p_action or v_old.expected_revision<>p_expected_revision or v_old.payload<>p_payload then raise exception 'idempotency_conflict'; end if;
    return v_old.response||jsonb_build_object('duplicate',true);
  end if;
  select * into v_party from public.world_parties where id=p_party for update;
  if not found or v_party.owner_user_id<>p_actor then raise exception 'unauthorized_party'; end if;
  if v_party.revision<>p_expected_revision then raise exception 'stale_party'; end if;
  insert into public.world_governance_commands(actor_user_id,request_id,party_id,action,expected_revision,payload)
    values(p_actor,p_request_id,p_party,p_action,p_expected_revision,p_payload);
  if p_action='declare_siege' then
    select * into v_location from public.world_locations where id=(p_payload->>'locationId')::uuid for update;
    if not found or v_location.province_id<>v_party.region_id or v_party.location_id<>v_location.id then raise exception 'siege_location_required'; end if;
    v_faction:=coalesce(v_party.owner_faction_id,p_payload->>'attackerFactionId');
    if v_faction is null or v_faction is not distinct from v_location.owner_faction_id then raise exception 'hostile_faction_required'; end if;
    if not exists(select 1 from public.world_factions f join public.world_provinces r on r.planet_id=f.planet_id where f.id=v_faction and r.id=v_party.region_id) then raise exception 'invalid_attacker_faction'; end if;
    select simulation_tick into v_tick from public.world_region_states where region_id=v_party.region_id;
    insert into public.world_sieges(region_id,location_id,attacker_party_id,attacker_faction_id,defender_faction_id,started_tick)
      values(v_party.region_id,v_location.id,v_party.id,v_faction,v_location.owner_faction_id,coalesce(v_tick,0)) returning * into v_siege;
    update public.world_locations set control_state='besieged',siege_state=jsonb_build_object('siegeId',v_siege.id,'attackerFactionId',v_faction),revision=revision+1 where id=v_location.id;
    update public.world_provinces set control_state='besieged',siege_state=jsonb_build_object('siegeId',v_siege.id,'locationId',v_location.id),revision=revision+1,control_updated_at=now() where id=v_party.region_id;
  elsif p_action in ('set_siege_stance','offer_surrender','accept_surrender','lift_siege') then
    select * into v_siege from public.world_sieges where id=(p_payload->>'siegeId')::uuid for update;
    if not found or v_siege.status not in ('preparing','active','breached') then raise exception 'active_siege_required'; end if;
    if p_action in ('set_siege_stance','lift_siege') and v_siege.attacker_party_id<>p_party then raise exception 'attacker_command_required'; end if;
    if p_action='set_siege_stance' then
      if p_payload->>'stance' not in ('encircle','assault','starve') then raise exception 'invalid_siege_stance'; end if;
      update public.world_sieges set attacker_stance=p_payload->>'stance',revision=revision+1,updated_at=now() where id=v_siege.id returning * into v_siege;
    elsif p_action='offer_surrender' then
      if v_party.owner_faction_id is distinct from v_siege.defender_faction_id or v_party.location_id is distinct from v_siege.location_id then raise exception 'defender_command_required'; end if;
      update public.world_sieges set surrender_status='offered',revision=revision+1,updated_at=now() where id=v_siege.id returning * into v_siege;
    elsif p_action='accept_surrender' then
      if v_siege.attacker_party_id<>p_party or v_siege.surrender_status<>'offered' then raise exception 'surrender_offer_required'; end if;
      update public.world_sieges set surrender_status='accepted',revision=revision+1,updated_at=now() where id=v_siege.id returning * into v_siege;
    else
      update public.world_sieges set status='lifted',outcome='lifted',resolved_tick=coalesce((select simulation_tick from public.world_region_states where region_id=v_siege.region_id),v_siege.started_tick),revision=revision+1,updated_at=now() where id=v_siege.id returning * into v_siege;
      update public.world_locations set control_state='controlled',siege_state='{}',revision=revision+1 where id=v_siege.location_id;
      update public.world_provinces set control_state=case when owner_faction_id is null then 'unclaimed' else 'controlled' end,siege_state='{}',revision=revision+1,control_updated_at=now() where id=v_siege.region_id;
    end if;
  else
    declare
      v_holding public.world_holdings%rowtype;
      v_target uuid;
      v_permission text;
      v_enabled boolean;
    begin
      select * into v_holding from public.world_holdings where id=(p_payload->>'holdingId')::uuid for update;
      if not found or v_holding.owner_user_id<>p_actor or v_holding.status<>'active' then raise exception 'holding_owner_required'; end if;
      v_target:=(p_payload->>'userId')::uuid; v_permission:=p_payload->>'permission'; v_enabled:=coalesce((p_payload->>'enabled')::boolean,false);
      if v_permission not in ('manage','trade','garrison','tax') or v_target=p_actor then raise exception 'invalid_holding_permission'; end if;
      if v_enabled then insert into public.world_holding_permissions(holding_id,user_id,permission,granted_by) values(v_holding.id,v_target,v_permission,p_actor) on conflict(holding_id,user_id,permission) do update set granted_by=excluded.granted_by,revision=world_holding_permissions.revision+1,granted_at=now();
      else delete from public.world_holding_permissions where holding_id=v_holding.id and user_id=v_target and permission=v_permission; end if;
      v_siege.id:=v_holding.granted_by_siege_id;
    end;
  end if;
  v_result:=jsonb_build_object('ok',true,'duplicate',false,'action',p_action,'siegeId',v_siege.id,'siegeRevision',v_siege.revision);
  update public.world_governance_commands set response=v_result where actor_user_id=p_actor and request_id=p_request_id;
  return v_result;
end $$;

create or replace function public.advance_world_siege(
  p_siege uuid,p_request_id text,p_expected_revision bigint,p_worker text,p_lease_epoch bigint,
  p_world_tick bigint,p_blockade numeric,p_relief numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_siege public.world_sieges%rowtype; v_lease public.world_region_worker_leases%rowtype;
  v_old public.world_siege_advances%rowtype;
  v_delta numeric; v_result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_blockade not between 0 and 1 or p_relief not between 0 and 1 or p_world_tick<0 then raise exception 'invalid_siege_tick'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-siege:'||p_siege::text,0));
  select * into v_old from public.world_siege_advances where siege_id=p_siege and request_id=p_request_id;
  if found then
    if v_old.expected_revision<>p_expected_revision or v_old.worker_id<>p_worker or v_old.lease_epoch<>p_lease_epoch
      or v_old.world_tick<>p_world_tick or v_old.blockade<>p_blockade or v_old.relief<>p_relief then raise exception 'idempotency_conflict'; end if;
    return v_old.response||jsonb_build_object('duplicate',true);
  end if;
  select * into v_siege from public.world_sieges where id=p_siege for update;
  if not found or v_siege.revision<>p_expected_revision or v_siege.status not in ('preparing','active','breached') then raise exception 'stale_siege'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=v_siege.region_id for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch or v_lease.lease_until<=now() then raise exception 'region_lease_required'; end if;
  if p_world_tick<=v_siege.started_tick then raise exception 'non_monotonic_siege_tick'; end if;
  v_delta:=greatest(-.08,least(.12,(p_blockade-p_relief)*.08 + case v_siege.attacker_stance when 'assault' then .04 when 'starve' then .025 else .015 end));
  update public.world_sieges set status=case when progress+v_delta>=.75 then 'breached' else 'active' end,
    progress=greatest(0,least(1,progress+v_delta)),blockade_strength=p_blockade,relief_strength=p_relief,
    defender_supply=greatest(0,defender_supply-case when p_blockade>p_relief then (p_blockade-p_relief)*8 else 0 end),
    revision=revision+1,updated_at=now() where id=p_siege returning * into v_siege;
  v_result:=jsonb_build_object('ok',true,'siegeId',v_siege.id,'status',v_siege.status,'progress',v_siege.progress,'defenderSupply',v_siege.defender_supply,'siegeRevision',v_siege.revision,'reliefSucceeded',p_relief>=.8 and v_siege.progress=0);
  insert into public.world_siege_advances(siege_id,request_id,expected_revision,worker_id,lease_epoch,world_tick,blockade,relief,response)
    values(p_siege,p_request_id,p_expected_revision,p_worker,p_lease_epoch,p_world_tick,p_blockade,p_relief,v_result);
  insert into public.world_governance_audit(region_id,action,aggregate_type,aggregate_id,world_tick,details) values(v_siege.region_id,'siege_advanced','world_siege',v_siege.id,p_world_tick,v_result||jsonb_build_object('requestId',p_request_id,'workerId',p_worker,'leaseEpoch',p_lease_epoch));
  return v_result;
end $$;

create or replace function public.resolve_world_siege(
  p_siege uuid,p_request_id text,p_expected_revision bigint,p_outcome text,
  p_worker text,p_lease_epoch bigint,p_world_tick bigint
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_siege public.world_sieges%rowtype; v_old public.world_siege_resolutions%rowtype;
  v_lease public.world_region_worker_leases%rowtype; v_location public.world_locations%rowtype;
  v_party public.world_parties%rowtype; v_region public.world_provinces%rowtype; v_result jsonb; v_sequence bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_expected_revision<1
    or p_outcome not in ('attacker_victory','defender_victory','lifted') or p_worker is null
    or length(p_worker) not between 1 and 96 or p_lease_epoch<1 or p_world_tick<0 then raise exception 'invalid_siege_resolution'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-siege:'||p_siege::text,0));
  select * into v_old from public.world_siege_resolutions where siege_id=p_siege and request_id=p_request_id;
  if found then
    if v_old.expected_revision<>p_expected_revision or v_old.outcome<>p_outcome or v_old.worker_id<>p_worker or v_old.lease_epoch<>p_lease_epoch then raise exception 'idempotency_conflict'; end if;
    return v_old.response||jsonb_build_object('duplicate',true);
  end if;
  select * into v_siege from public.world_sieges where id=p_siege for update;
  if not found or v_siege.revision<>p_expected_revision or v_siege.status not in ('preparing','active','breached') then raise exception 'stale_siege'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=v_siege.region_id for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch or v_lease.lease_until<=now() then raise exception 'region_lease_required'; end if;
  select * into v_region from public.world_provinces where id=v_siege.region_id for update;
  select * into v_location from public.world_locations where id=v_siege.location_id for update;
  select * into v_party from public.world_parties where id=v_siege.attacker_party_id for update;
  if p_outcome='attacker_victory' then
    update public.world_holdings set status='revoked',revision=revision+1 where location_id=v_location.id and holding_type='governorship' and status in ('active','contested');
    update public.world_locations set owner_faction_id=v_siege.attacker_faction_id,claimed_by_faction_id=v_siege.attacker_faction_id,control_state='occupied',control_strength=.55,unrest=greatest(unrest,.35),siege_state='{}',revision=revision+1 where id=v_location.id;
    if v_location.is_region_seat then
      perform set_config('app.world_control_context',jsonb_build_object('cause','siege_occupation','worldTick',p_world_tick,'metadata',jsonb_build_object('siegeId',v_siege.id,'locationId',v_location.id))::text,true);
      update public.world_provinces set owner_faction_id=v_siege.attacker_faction_id,claimed_by_faction_id=v_siege.attacker_faction_id,control_state='occupied',control_strength=.55,unrest=greatest(unrest,.35),siege_state='{}',revision=revision+1,control_updated_at=now() where id=v_region.id;
    else
      update public.world_provinces set control_state='contested',claimed_by_faction_id=v_siege.attacker_faction_id,siege_state='{}',revision=revision+1,control_updated_at=now() where id=v_region.id;
    end if;
    insert into public.world_holdings(location_id,owner_user_id,owner_faction_id,holding_type,granted_by_siege_id)
      values(v_location.id,v_party.owner_user_id,v_siege.attacker_faction_id,'governorship',v_siege.id);
    if v_party.owner_user_id is not null then
      insert into public.world_faction_reputation(user_id,faction_id,score) values(v_party.owner_user_id,v_siege.attacker_faction_id,25)
      on conflict(user_id,faction_id) do update set score=least(1000,world_faction_reputation.score+25),revision=world_faction_reputation.revision+1,updated_at=now();
      if v_siege.defender_faction_id is not null then insert into public.world_faction_reputation(user_id,faction_id,score) values(v_party.owner_user_id,v_siege.defender_faction_id,-20)
      on conflict(user_id,faction_id) do update set score=greatest(-1000,world_faction_reputation.score-20),revision=world_faction_reputation.revision+1,updated_at=now(); end if;
    end if;
  else
    update public.world_locations set control_state='controlled',siege_state='{}',revision=revision+1 where id=v_location.id;
    update public.world_provinces set control_state=case when owner_faction_id is null then 'unclaimed' else 'controlled' end,siege_state='{}',revision=revision+1,control_updated_at=now() where id=v_region.id;
  end if;
  update public.world_sieges set status=case when p_outcome='lifted' then 'lifted' else 'resolved' end,outcome=p_outcome,resolved_tick=p_world_tick,progress=case when p_outcome='attacker_victory' then 1 else progress end,revision=revision+1,updated_at=now() where id=v_siege.id returning * into v_siege;
  v_result:=jsonb_build_object('ok',true,'duplicate',false,'siegeId',v_siege.id,'outcome',p_outcome,'siegeRevision',v_siege.revision,'locationId',v_location.id,'regionId',v_region.id);
  insert into public.world_siege_resolutions(siege_id,request_id,expected_revision,outcome,worker_id,lease_epoch,response) values(p_siege,p_request_id,p_expected_revision,p_outcome,p_worker,p_lease_epoch,v_result);
  insert into public.world_governance_audit(region_id,actor_user_id,action,aggregate_type,aggregate_id,world_tick,details) values(v_region.id,v_party.owner_user_id,'siege_resolved','world_siege',v_siege.id,p_world_tick,v_result||jsonb_build_object('workerId',p_worker,'leaseEpoch',p_lease_epoch));
  perform pg_advisory_xact_lock(hashtextextended('world-events:'||v_region.shard_id,0));
  select coalesce(max(sequence),0)+1 into v_sequence from public.world_events where shard_id=v_region.shard_id;
  insert into public.world_events(shard_id,sequence,tick,event_type,actor_user_id,aggregate_type,aggregate_id,aggregate_revision,payload,command_request_id)
    values(v_region.shard_id,v_sequence,p_world_tick,'siege.resolved',v_party.owner_user_id,'world_siege',v_siege.id::text,v_siege.revision,v_result||jsonb_build_object('regionId',v_region.id),p_request_id);
  return v_result;
end $$;

revoke all on function public.living_world_governance_command(uuid,text,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.living_world_governance_command(uuid,text,uuid,bigint,text,jsonb) to service_role;
revoke all on function public.resolve_world_siege(uuid,text,bigint,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.resolve_world_siege(uuid,text,bigint,text,text,bigint,bigint) to service_role;
revoke all on function public.advance_world_siege(uuid,text,bigint,text,bigint,bigint,numeric,numeric) from public,anon,authenticated;
grant execute on function public.advance_world_siege(uuid,text,bigint,text,bigint,bigint,numeric,numeric) to service_role;

do $$ declare t text; begin foreach t in array array['world_sieges','world_faction_reputation','world_holdings','world_holding_permissions','world_governance_audit','world_governance_commands','world_siege_advances','world_siege_resolutions'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy world_sieges_region_participant_read on public.world_sieges for select to authenticated using(
  exists(select 1 from public.world_parties p where p.owner_user_id=auth.uid() and p.region_id=world_sieges.region_id)
);
create policy world_reputation_owner_read on public.world_faction_reputation for select to authenticated using(user_id=auth.uid());
create policy world_holdings_owner_read on public.world_holdings for select to authenticated using(owner_user_id=auth.uid());
create policy world_holding_permissions_member_read on public.world_holding_permissions for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.world_holdings h where h.id=holding_id and h.owner_user_id=auth.uid()));
create policy world_governance_commands_owner_read on public.world_governance_commands for select to authenticated using(actor_user_id=auth.uid());
create policy world_siege_resolutions_participant_read on public.world_siege_resolutions for select to authenticated using(exists(select 1 from public.world_sieges s join public.world_parties p on p.id=s.attacker_party_id where s.id=siege_id and p.owner_user_id=auth.uid()));
create policy world_siege_advances_participant_read on public.world_siege_advances for select to authenticated using(exists(select 1 from public.world_sieges s join public.world_parties p on p.region_id=s.region_id where s.id=siege_id and p.owner_user_id=auth.uid()));

commit;
