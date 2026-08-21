-- Bounded living-world population, strategic actions, and operational gates.
-- Geography stays immutable. These rows are mutable campaign state and can be
-- deterministically reconciled after worker failure or accidental deletion.
begin;

alter table public.world_parties
  add column strategic_role text
  check(strategic_role is null or strategic_role in('garrison','patrol','caravan','raider','scout','siege_force'));
alter table public.world_parties add column home_region_id uuid references public.world_provinces(id) on delete restrict;

update public.world_parties set strategic_role='garrison' where kind='garrison' and strategic_role is null;

create table public.world_population_targets(
  planet_id text primary key references public.world_planets(id) on delete cascade,
  parties_per_region integer not null check(parties_per_region between 4 and 8),
  minimum_parties integer not null check(minimum_parties between 300 and 500),
  maximum_parties integer not null check(maximum_parties between 300 and 500),
  max_actions_per_region_tick integer not null default 16 check(max_actions_per_region_tick between 4 and 32),
  crowded_present_parties integer not null default 10 check(crowded_present_parties between 8 and 24),
  maximum_present_parties integer not null default 16 check(maximum_present_parties between 12 and 32),
  role_mix jsonb not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check(minimum_parties<=maximum_parties),check(crowded_present_parties<maximum_present_parties)
);

create table public.world_population_observations(
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  world_tick bigint not null check(world_tick>=0),
  observed_parties integer not null check(observed_parties>=0),
  present_parties integer not null check(present_parties>=0),
  target_parties integer not null check(target_parties>=0),
  inserted_parties integer not null check(inserted_parties>=0),
  retired_parties integer not null default 0 check(retired_parties>=0),
  population_state text not null check(population_state in('healthy','under_target','over_target')),
  congestion_state text not null check(congestion_state in('normal','crowded','overloaded')),
  observed_at timestamptz not null default now(),
  primary key(region_id,world_tick)
);

create table public.world_region_runtime_health(
  id bigint generated always as identity primary key,
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  world_tick bigint not null check(world_tick>=0),worker_id text not null check(length(worker_id) between 1 and 96),
  lease_epoch bigint not null check(lease_epoch>=0),duration_ms numeric(12,3) not null check(duration_ms>=0),
  success boolean not null,error_code text,tick_lag integer not null check(tick_lag>=0),handoff_backlog integer not null check(handoff_backlog>=0),
  present_parties integer not null check(present_parties>=0),action_budget integer not null check(action_budget between 0 and 32),
  action_saturated boolean not null,congestion_state text not null check(congestion_state in('normal','crowded','overloaded')),
  threshold_breached boolean not null,recorded_at timestamptz not null default now()
);
create index world_region_runtime_health_region on public.world_region_runtime_health(region_id,recorded_at desc);
create index world_region_runtime_health_breaches on public.world_region_runtime_health(recorded_at desc) where threshold_breached;

create index world_parties_region_role on public.world_parties(region_id,strategic_role,id) where owner_user_id is null;
create index world_parties_home_region_role on public.world_parties(home_region_id,strategic_role,id) where owner_user_id is null;
create index world_population_observations_state on public.world_population_observations(population_state,observed_at desc);
create unique index world_pursuits_one_active_per_party on public.world_pursuits(pursuer_party_id) where state='active';

create function public.reconcile_world_region_population(p_region uuid,p_world_tick bigint default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_region public.world_provinces%rowtype;v_target public.world_population_targets%rowtype;
  v_location uuid;v_role text;v_party uuid;v_kind text;v_power numeric;v_route public.world_routes%rowtype;
  v_observed integer;v_present integer;v_inserted integer:=0;v_retired integer:=0;v_state text;v_congestion text;v_retire uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required';end if;
  if p_region is null or p_world_tick<0 then raise exception 'invalid_population_reconcile';end if;
  perform pg_advisory_xact_lock(hashtextextended('world-population:'||p_region::text,0));
  select * into v_region from public.world_provinces where id=p_region for update;
  if not found then raise exception 'population_region_not_found';end if;
  select * into v_target from public.world_population_targets where planet_id=v_region.planet_id;
  if not found or not v_target.enabled then return jsonb_build_object('ok',true,'status','disabled','regionId',p_region);end if;
  if v_target.role_mix<>'{"garrison":1,"patrol":1,"caravan":1,"raider":1,"scout":1,"siege_force":1}'::jsonb then raise exception 'unsupported_population_role_mix';end if;
  select id into v_location from public.world_locations where province_id=p_region and is_region_seat order by id limit 1;
  if v_location is null then raise exception 'population_region_seat_missing';end if;
  update public.world_parties set strategic_role='garrison',home_region_id=coalesce(home_region_id,p_region),updated_at=now()
    where kind='garrison' and owner_user_id is null and (home_region_id=p_region or (home_region_id is null and region_id=p_region));

  foreach v_role in array array['patrol','caravan','raider','scout','siege_force'] loop
    v_party:=md5(v_region.planet_id||':living-party:'||p_region::text||':'||v_role)::uuid;
    v_kind:=case v_role when 'patrol' then 'patrol' when 'caravan' then 'caravan' else 'ai' end;
    v_power:=case v_role when 'siege_force' then 260 when 'raider' then 150 when 'patrol' then 120 when 'scout' then 70 else 55 end;
    if exists(select 1 from public.world_parties where id=v_party) then
      update public.world_parties set home_region_id=p_region,strategic_role=v_role,
        owner_faction_id=case v_role when 'raider' then 'rotmire_host' when 'caravan' then 'earth_wayfarers' else v_region.owner_faction_id end,
        kind=v_kind,updated_at=now() where id=v_party;
    else
      insert into public.world_parties(id,shard_id,region_id,home_region_id,owner_faction_id,name,kind,location_id,speed,morale,stance,strategic_role)
        values(v_party,v_region.shard_id,p_region,p_region,
          case v_role when 'raider' then 'rotmire_host' when 'caravan' then 'earth_wayfarers' else v_region.owner_faction_id end,
          v_region.name||' '||replace(initcap(v_role),'_',' '),v_kind,v_location,
          case v_role when 'scout' then 1.5 when 'caravan' then .9 when 'siege_force' then .65 else 1.1 end,75,
          case when v_role='raider' then 'hostile' else 'friendly' end,v_role);
      v_inserted:=v_inserted+1;
      insert into public.world_armies(party_id,combat_power,formation)
        values(v_party,v_power,jsonb_build_object('doctrine',v_role)) on conflict(party_id) do nothing;
      insert into public.world_supplies(party_id,supply_key,quantity,consumption_per_tick)
        values(v_party,'food',greatest(20,v_power/2),greatest(.05,v_power/2000)),(v_party,'medicine',10,.01),(v_party,'parts',10,.01)
        on conflict(party_id,supply_key) do nothing;
      if v_role='caravan' then
        select * into v_route from public.world_routes where origin_region_id=p_region and origin_id=v_location
          and control_state<>'blocked' and not coalesce((blockade_state->>'closed')::boolean,false) order by id limit 1;
        if found then
          insert into public.world_caravan_plans(party_id,origin_location_id,destination_location_id,commodity_key,target_quantity)
            values(v_party,v_location,v_route.destination_id,'food',20) on conflict(party_id) do nothing;
        end if;
      end if;
    end if;
  end loop;

  select count(*) into v_observed from public.world_parties where home_region_id=p_region and owner_user_id is null;
  select count(*) into v_present from public.world_parties where region_id=p_region and owner_user_id is null;
  while v_observed>v_target.parties_per_region loop
    select p.id into v_retire from public.world_parties p
      where p.home_region_id=p_region and p.owner_user_id is null and p.strategic_role is not null and p.strategic_role<>'garrison'
        and not exists(select 1 from public.world_sieges s where s.attacker_party_id=p.id and s.status in('preparing','active','breached'))
        and not exists(select 1 from public.world_encounters e where e.state in('choosing','negotiating','battle') and p.id in(e.attacker_party_id,e.defender_party_id))
        and not exists(select 1 from public.world_pursuits po where p.id in(po.pursuer_party_id,po.target_party_id))
      order by p.updated_at desc,p.id desc limit 1 for update skip locked;
    exit when v_retire is null;
    delete from public.world_parties where id=v_retire;
    v_retired:=v_retired+1;v_observed:=v_observed-1;v_retire:=null;
  end loop;
  v_state:=case when v_observed<v_target.parties_per_region then 'under_target' when v_observed>v_target.parties_per_region then 'over_target' else 'healthy' end;
  v_congestion:=case when v_present>v_target.maximum_present_parties then 'overloaded' when v_present>v_target.crowded_present_parties then 'crowded' else 'normal' end;
  insert into public.world_population_observations(region_id,world_tick,observed_parties,present_parties,target_parties,inserted_parties,retired_parties,population_state,congestion_state)
    values(p_region,p_world_tick,v_observed,v_present,v_target.parties_per_region,v_inserted,v_retired,v_state,v_congestion)
  on conflict(region_id,world_tick) do update set observed_parties=excluded.observed_parties,present_parties=excluded.present_parties,target_parties=excluded.target_parties,
    inserted_parties=world_population_observations.inserted_parties+excluded.inserted_parties,
    retired_parties=world_population_observations.retired_parties+excluded.retired_parties,population_state=excluded.population_state,
    congestion_state=excluded.congestion_state,observed_at=now();
  return jsonb_build_object('ok',true,'regionId',p_region,'tick',p_world_tick,'observed',v_observed,'present',v_present,'target',v_target.parties_per_region,'inserted',v_inserted,'retired',v_retired,'state',v_state,'congestion',v_congestion);
end $$;

create function public.process_world_phase2_actions(p_region uuid,p_world_tick bigint,p_worker text,p_lease_epoch bigint,p_max_actions integer default 8)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_lease public.world_region_worker_leases%rowtype;v_party public.world_parties%rowtype;v_target public.world_parties%rowtype;
  v_location public.world_locations%rowtype;v_created_raids integer:=0;v_created_pursuits integer:=0;v_created_sieges integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required';end if;
  if p_max_actions not between 1 and 32 then raise exception 'invalid_phase2_action_budget';end if;
  select * into v_lease from public.world_region_worker_leases where region_id=p_region for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch or v_lease.lease_until<=now() then raise exception 'region_lease_required';end if;
  for v_party in select * from public.world_parties where region_id=p_region and owner_user_id is null and stance<>'engaged'
    and strategic_intent in('raid','pursue','siege_prepare') order by id limit p_max_actions for update
  loop
    if v_party.strategic_intent='pursue' then
      select * into v_target from public.world_parties t where t.region_id=p_region and t.id<>v_party.id and t.owner_faction_id is distinct from v_party.owner_faction_id
        and t.stance<>'engaged' order by case when t.route_id is not distinct from v_party.route_id then 0 else 1 end,t.id limit 1;
      if found then
        insert into public.world_pursuits(id,shard_id,pursuer_party_id,target_party_id,started_tick,seed)
          values(md5(v_party.id::text||':'||v_target.id::text||':'||p_world_tick::text)::uuid,v_party.shard_id,v_party.id,v_target.id,p_world_tick,
            hashtextextended(v_party.id::text||':'||v_target.id::text||':'||p_world_tick::text,0))
        on conflict do nothing;
        if found then v_created_pursuits:=v_created_pursuits+1;end if;
        update public.world_parties set strategic_target_location_id=coalesce(v_target.location_id,strategic_target_location_id),updated_at=now() where id=v_party.id;
      end if;
    elsif v_party.strategic_intent='raid' then
      select * into v_target from public.world_parties t where t.region_id=p_region and t.kind='caravan' and t.id<>v_party.id
        and t.owner_faction_id is distinct from v_party.owner_faction_id and t.route_id is not null and t.route_id=v_party.route_id
        and not exists(select 1 from public.world_raid_orders ro where ro.attacker_party_id=v_party.id and ro.state='pending') order by t.id limit 1;
      if found then
        insert into public.world_raid_orders(request_id,region_id,attacker_party_id,target_party_id,resolve_tick)
          values('ai:'||p_world_tick::text,p_region,v_party.id,v_target.id,p_world_tick+1) on conflict do nothing;
        if found then v_created_raids:=v_created_raids+1;end if;
      end if;
    else
      select * into v_location from public.world_locations where id=v_party.location_id and province_id=p_region
        and owner_faction_id is distinct from v_party.owner_faction_id and kind in('town','fort') order by id limit 1;
      if found and not exists(select 1 from public.world_sieges where location_id=v_location.id and status in('preparing','active','breached')) then
        insert into public.world_sieges(region_id,location_id,attacker_party_id,attacker_faction_id,defender_faction_id,started_tick)
          values(p_region,v_location.id,v_party.id,v_party.owner_faction_id,v_location.owner_faction_id,p_world_tick);
        v_created_sieges:=v_created_sieges+1;
      end if;
    end if;
  end loop;
  update public.world_pursuits po set state='caught',resolved_tick=p_world_tick,result=coalesce(po.result,'{}'::jsonb)||jsonb_build_object('reason','world_encounter') where po.state='active'
    and exists(select 1 from public.world_parties p where p.id=po.pursuer_party_id and p.region_id=p_region)
    and exists(select 1 from public.world_encounters e where e.state in('choosing','negotiating','battle')
      and e.attacker_party_id in(po.pursuer_party_id,po.target_party_id) and e.defender_party_id in(po.pursuer_party_id,po.target_party_id));
  update public.world_pursuits po set state='escaped',resolved_tick=p_world_tick,result=coalesce(po.result,'{}'::jsonb)||jsonb_build_object('reason','pursuit_timeout')
    where po.state='active' and p_world_tick-po.started_tick>=24
      and exists(select 1 from public.world_parties p where p.id=po.pursuer_party_id and p.region_id=p_region);
  return jsonb_build_object('ok',true,'raidsCreated',v_created_raids,'pursuitsCreated',v_created_pursuits,'siegesCreated',v_created_sieges);
end $$;

create function public.reconcile_world_planet_population(p_planet text,p_world_tick bigint default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region uuid;v_result jsonb;v_total integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required';end if;
  for v_region in select id from public.world_provinces where planet_id=p_planet order by id loop
    perform public.reconcile_world_region_population(v_region,p_world_tick);
  end loop;
  select count(*) into v_total from public.world_parties p join public.world_provinces r on r.id=p.region_id where r.planet_id=p_planet and p.owner_user_id is null;
  if exists(select 1 from public.world_population_targets where planet_id=p_planet and enabled and (v_total<minimum_parties or v_total>maximum_parties)) then
    raise exception 'planet_population_out_of_bounds';
  end if;
  return jsonb_build_object('ok',true,'planetId',p_planet,'parties',v_total);
end $$;

create function public.record_world_region_runtime_health(p_region uuid,p_world_tick bigint,p_worker text,p_lease_epoch bigint,
  p_duration_ms numeric,p_success boolean,p_error_code text,p_action_budget integer,p_action_saturated boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tick bigint;v_shard_tick bigint;v_lag integer;v_backlog integer;v_present integer;v_congestion text;v_breached boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required';end if;
  if p_region is null or p_world_tick<0 or p_worker is null or length(p_worker) not between 1 and 96 or p_lease_epoch<0
    or p_duration_ms<0 or p_success is null or p_action_budget not between 0 and 32 or p_action_saturated is null
    or (p_error_code is not null and length(p_error_code) not between 1 and 64) then raise exception 'invalid_runtime_health';end if;
  select s.simulation_tick,sh.simulation_tick into v_tick,v_shard_tick from public.world_region_states s
    join public.world_provinces p on p.id=s.region_id join public.world_shards sh on sh.id=p.shard_id where s.region_id=p_region;
  if not found then raise exception 'runtime_health_region_not_found';end if;
  v_lag:=greatest(0,v_shard_tick-v_tick);
  select count(*) into v_backlog from public.world_region_handoffs where status='pending' and (source_region_id=p_region or destination_region_id=p_region);
  select count(*) into v_present from public.world_parties where region_id=p_region and owner_user_id is null;
  select case when v_present>t.maximum_present_parties then 'overloaded' when v_present>t.crowded_present_parties then 'crowded' else 'normal' end into v_congestion
    from public.world_population_targets t join public.world_provinces p on p.planet_id=t.planet_id where p.id=p_region;
  v_congestion:=coalesce(v_congestion,'normal');
  v_breached:=not p_success or p_duration_ms>250 or v_lag>2 or v_backlog>32 or v_congestion='overloaded' or p_action_saturated;
  insert into public.world_region_runtime_health(region_id,world_tick,worker_id,lease_epoch,duration_ms,success,error_code,tick_lag,handoff_backlog,present_parties,action_budget,action_saturated,congestion_state,threshold_breached)
    values(p_region,p_world_tick,p_worker,p_lease_epoch,p_duration_ms,p_success,p_error_code,v_lag,v_backlog,v_present,p_action_budget,p_action_saturated,v_congestion,v_breached);
  return jsonb_build_object('ok',true,'tickLag',v_lag,'handoffBacklog',v_backlog,'presentParties',v_present,'congestion',v_congestion,'thresholdBreached',v_breached);
end $$;

create function public.world_manifest_population_ready()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.materialization_state='ready' and old.materialization_state is distinct from 'ready' then
    insert into public.world_population_targets(planet_id,parties_per_region,minimum_parties,maximum_parties,role_mix,enabled)
      values(new.planet_id,6,300,500,'{"garrison":1,"patrol":1,"caravan":1,"raider":1,"scout":1,"siege_force":1}',true)
    on conflict(planet_id) do update set enabled=true,updated_at=now();
    perform public.reconcile_world_planet_population(new.planet_id,0);
  end if;
  return new;
end $$;
create trigger world_manifest_population_ready after update of materialization_state on public.world_manifests
for each row execute function public.world_manifest_population_ready();

alter table public.world_population_targets enable row level security;
alter table public.world_population_observations enable row level security;
alter table public.world_region_runtime_health enable row level security;

revoke all on function public.reconcile_world_region_population(uuid,bigint) from public,anon,authenticated;
revoke all on function public.reconcile_world_planet_population(text,bigint) from public,anon,authenticated;
revoke all on function public.process_world_phase2_actions(uuid,bigint,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.record_world_region_runtime_health(uuid,bigint,text,bigint,numeric,boolean,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_world_region_population(uuid,bigint) to service_role;
grant execute on function public.reconcile_world_planet_population(text,bigint) to service_role;
grant execute on function public.process_world_phase2_actions(uuid,bigint,text,bigint,integer) to service_role;
grant execute on function public.record_world_region_runtime_health(uuid,bigint,text,bigint,numeric,boolean,text,integer,boolean) to service_role;
commit;
