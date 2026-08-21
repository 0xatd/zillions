-- Canonical universe topology and region-scoped authority.
-- Keep earth-1 as the compatibility shard while workers move to region leases.
begin;

create table public.world_universes (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','archived')),
  revision bigint not null default 1,
  created_at timestamptz not null default now()
);

create table public.world_star_systems (
  id text primary key,
  universe_id text not null references public.world_universes(id) on delete cascade,
  key text not null,
  name text not null,
  position jsonb not null default '{}',
  revision bigint not null default 1,
  unique (universe_id,key)
);

create table public.world_planets (
  id text primary key,
  system_id text not null references public.world_star_systems(id) on delete cascade,
  shard_id text unique references public.world_shards(id) on delete restrict,
  key text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','archived')),
  world_state jsonb not null default '{}',
  revision bigint not null default 1,
  unique (system_id,key)
);

create table public.world_factions (
  id text primary key,
  planet_id text not null references public.world_planets(id) on delete cascade,
  name text not null,
  kind text not null default 'state' check (kind in ('state','clan','hostile','neutral')),
  status text not null default 'active' check (status in ('active','defeated','dormant')),
  diplomacy jsonb not null default '{}',
  strategic_goals jsonb not null default '[]',
  resources jsonb not null default '{}',
  revision bigint not null default 1
);

alter table public.world_provinces
  add column planet_id text references public.world_planets(id) on delete cascade,
  add column control_strength numeric(5,4) not null default 1 check (control_strength between 0 and 1),
  add column claimed_by_faction_id text,
  add column garrison_strength numeric(16,3) not null default 0 check (garrison_strength >= 0),
  add column unrest numeric(5,4) not null default 0 check (unrest between 0 and 1),
  add column control_state text not null default 'controlled' check (control_state in ('controlled','contested','besieged','occupied','unclaimed')),
  add column siege_state jsonb not null default '{}',
  add column control_updated_at timestamptz not null default now();

alter table public.world_locations
  add column control_strength numeric(5,4) not null default 1 check (control_strength between 0 and 1),
  add column claimed_by_faction_id text,
  add column garrison_strength numeric(16,3) not null default 0 check (garrison_strength >= 0),
  add column unrest numeric(5,4) not null default 0 check (unrest between 0 and 1),
  add column control_state text not null default 'controlled' check (control_state in ('controlled','contested','besieged','occupied','unclaimed')),
  add column siege_state jsonb not null default '{}';

alter table public.world_routes
  add column origin_region_id uuid references public.world_provinces(id) on delete cascade,
  add column destination_region_id uuid references public.world_provinces(id) on delete cascade,
  add column owner_faction_id text,
  add column claimed_by_faction_id text,
  add column control_strength numeric(5,4) not null default 1 check (control_strength between 0 and 1),
  add column control_state text not null default 'controlled' check (control_state in ('controlled','contested','blocked','unclaimed')),
  add column blockade_state jsonb not null default '{}';

alter table public.world_parties
  add column region_id uuid references public.world_provinces(id) on delete restrict;

insert into public.world_universes(id,name) values ('universe-1','Zillions Universe');
insert into public.world_star_systems(id,universe_id,key,name,position)
  values ('sol','universe-1','sol','Sol','{"x":0,"y":0,"z":0}');
insert into public.world_planets(id,system_id,shard_id,key,name)
  values ('earth','sol','earth-1','earth','Earth');
insert into public.world_factions(id,planet_id,name,kind) values
  ('greenfall_freeholds','earth','Greenfall Freeholds','state'),
  ('ironwood_compact','earth','Ironwood Compact','state'),
  ('rotmire_host','earth','Rotmire Host','hostile');

update public.world_provinces set planet_id='earth' where shard_id='earth-1';
insert into public.world_provinces(id,shard_id,key,name,bounds,owner_faction_id,planet_id)
values
  ('10000000-0000-4000-8000-000000000002','earth-1','ironwood','Ironwood Reach','{"minX":34,"minY":0,"maxX":72,"maxY":52}','ironwood_compact','earth'),
  ('10000000-0000-4000-8000-000000000003','earth-1','rotmire','Rotmire March','{"minX":60,"minY":45,"maxX":100,"maxY":100}','rotmire_host','earth');
update public.world_locations set province_id='10000000-0000-4000-8000-000000000002'
where id='11000000-0000-4000-8000-000000000002';
update public.world_locations set province_id='10000000-0000-4000-8000-000000000003'
where id='11000000-0000-4000-8000-000000000003';
-- Preserve legacy control only when the faction is part of this planet. Unknown
-- legacy labels become unclaimed instead of preventing the FK from activating.
update public.world_provinces p set owner_faction_id=null
where owner_faction_id is not null and not exists (
  select 1 from public.world_factions f where f.id=p.owner_faction_id and f.planet_id=p.planet_id
);
update public.world_locations l set owner_faction_id=null
where owner_faction_id is not null and not exists (
  select 1 from public.world_factions f join public.world_provinces p on p.id=l.province_id
  where f.id=l.owner_faction_id and f.planet_id=p.planet_id
);
update public.world_provinces set claimed_by_faction_id=owner_faction_id where claimed_by_faction_id is null;
update public.world_locations set claimed_by_faction_id=owner_faction_id where claimed_by_faction_id is null;
update public.world_routes r set
  origin_region_id=ol.province_id,
  destination_region_id=dl.province_id,
  owner_faction_id=coalesce(ol.owner_faction_id,dl.owner_faction_id),
  claimed_by_faction_id=coalesce(ol.owner_faction_id,dl.owner_faction_id)
from public.world_locations ol,public.world_locations dl
where ol.id=r.origin_id and dl.id=r.destination_id;
update public.world_routes r set owner_faction_id=null,claimed_by_faction_id=null
where owner_faction_id is not null and not exists (
  select 1 from public.world_factions f join public.world_provinces p on p.id=r.origin_region_id
  where f.id=r.owner_faction_id and f.planet_id=p.planet_id
);
update public.world_parties p set region_id=l.province_id
from public.world_locations l where p.location_id=l.id and p.region_id is null;
update public.world_parties p set region_id=r.origin_region_id
from public.world_routes r where p.route_id=r.id and p.region_id is null;

alter table public.world_provinces alter column planet_id set not null;
alter table public.world_routes alter column origin_region_id set not null;
alter table public.world_routes alter column destination_region_id set not null;
alter table public.world_parties alter column region_id set not null;
alter table public.world_provinces
  add constraint world_provinces_owner_faction_fk foreign key(owner_faction_id) references public.world_factions(id) on delete restrict,
  add constraint world_provinces_claimed_faction_fk foreign key(claimed_by_faction_id) references public.world_factions(id) on delete restrict;
alter table public.world_locations
  add constraint world_locations_owner_faction_fk foreign key(owner_faction_id) references public.world_factions(id) on delete restrict,
  add constraint world_locations_claimed_faction_fk foreign key(claimed_by_faction_id) references public.world_factions(id) on delete restrict;
alter table public.world_routes
  add constraint world_routes_owner_faction_fk foreign key(owner_faction_id) references public.world_factions(id) on delete restrict,
  add constraint world_routes_claimed_faction_fk foreign key(claimed_by_faction_id) references public.world_factions(id) on delete restrict;

create or replace function public.validate_world_control_faction_planet()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_planet text;
begin
  if tg_table_name='world_provinces' then
    v_planet:=new.planet_id;
    if tg_op='UPDATE' and new.planet_id is distinct from old.planet_id and exists(
      select 1 from public.world_locations l join public.world_factions f
        on f.id in (l.owner_faction_id,l.claimed_by_faction_id)
      where l.province_id=new.id and f.planet_id<>new.planet_id
    ) then raise exception 'region_children_faction_wrong_planet'; end if;
    if tg_op='UPDATE' and new.planet_id is distinct from old.planet_id and exists(
      select 1 from public.world_routes r join public.world_factions f
        on f.id in (r.owner_faction_id,r.claimed_by_faction_id)
      where (r.origin_region_id=new.id or r.destination_region_id=new.id) and f.planet_id<>new.planet_id
    ) then raise exception 'region_routes_faction_wrong_planet'; end if;
  elsif tg_table_name='world_locations' then
    select planet_id into v_planet from public.world_provinces where id=new.province_id;
  else
    select p.planet_id into v_planet from public.world_provinces p where p.id=new.origin_region_id;
    if not exists(select 1 from public.world_provinces p where p.id=new.destination_region_id and p.planet_id=v_planet)
      then raise exception 'cross_planet_route_control'; end if;
  end if;
  if new.owner_faction_id is not null and not exists(
    select 1 from public.world_factions f where f.id=new.owner_faction_id and f.planet_id=v_planet
  ) then raise exception 'owner_faction_wrong_planet'; end if;
  if new.claimed_by_faction_id is not null and not exists(
    select 1 from public.world_factions f where f.id=new.claimed_by_faction_id and f.planet_id=v_planet
  ) then raise exception 'claimed_faction_wrong_planet'; end if;
  return new;
end $$;
create trigger world_provinces_control_faction_planet before insert or update of planet_id,owner_faction_id,claimed_by_faction_id on public.world_provinces for each row execute function public.validate_world_control_faction_planet();
create trigger world_locations_control_faction_planet before insert or update of province_id,owner_faction_id,claimed_by_faction_id on public.world_locations for each row execute function public.validate_world_control_faction_planet();
create trigger world_routes_control_faction_planet before insert or update of origin_region_id,destination_region_id,owner_faction_id,claimed_by_faction_id on public.world_routes for each row execute function public.validate_world_control_faction_planet();
create index world_provinces_planet on public.world_provinces(planet_id,key);
create index world_parties_region on public.world_parties(region_id,id);
create index world_routes_regions on public.world_routes(origin_region_id,destination_region_id);

-- The earlier world-entry function predates region authority. Replace it after
-- region_id becomes required so new player parties enter Greenfall atomically.
create or replace function public.enter_living_world(p_actor uuid,p_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_progress public.world_tutorial_progress%rowtype; v_character public.game_characters%rowtype;
  v_region uuid; v_location uuid; v_party uuid; v_social uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-entry:'||p_actor::text,0));
  select * into v_character from public.game_characters where id=p_character and user_id=p_actor for update;
  if not found then raise exception 'character_not_found'; end if;
  select * into v_progress from public.world_tutorial_progress where user_id=p_actor and character_id=p_character for update;
  if not found or v_progress.completed_at is null then raise exception 'tutorial_incomplete'; end if;
  if v_progress.world_party_id is not null then
    return jsonb_build_object('ok',true,'duplicate',true,'partyId',v_progress.world_party_id,'shardId','earth-1');
  end if;
  select p.id,l.id into v_region,v_location
  from public.world_provinces p
  join public.world_locations l on l.province_id=p.id
  where p.shard_id='earth-1' and p.key='greenfall' and l.key='greenfall-crossing';
  if v_region is null or v_location is null then raise exception 'earth_bootstrap_missing'; end if;
  insert into public.world_parties(shard_id,region_id,owner_user_id,leader_character_id,name,kind,location_id,speed,morale,stance)
    values('earth-1',v_region,p_actor,p_character,v_character.name||'''s Company','player',v_location,1.2,60,'friendly') returning id into v_party;
  insert into public.world_armies(party_id,commander_user_id,combat_power,formation) values(v_party,p_actor,0,'{}');
  insert into public.social_parties(shard_id,leader_user_id,name) values('earth-1',p_actor,v_character.name||'''s Party') returning id into v_social;
  insert into public.social_party_members(party_id,user_id,role) values(v_social,p_actor,'leader');
  update public.world_tutorial_progress set entered_world_at=now(),world_party_id=v_party,revision=revision+1,updated_at=now() where user_id=p_actor;
  return jsonb_build_object('ok',true,'duplicate',false,'partyId',v_party,'socialPartyId',v_social,'shardId','earth-1');
end $$;
revoke all on function public.enter_living_world(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enter_living_world(uuid,uuid) to service_role;

create table public.world_region_states (
  region_id uuid primary key references public.world_provinces(id) on delete cascade,
  simulation_tick bigint not null default 0 check (simulation_tick >= 0),
  status text not null default 'active' check (status in ('active','paused','migrating','archived')),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table public.world_region_worker_leases (
  region_id uuid primary key references public.world_provinces(id) on delete cascade,
  worker_id text not null check (length(worker_id) between 1 and 96),
  lease_epoch bigint not null default 1 check (lease_epoch > 0),
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null default now()
);

create or replace function public.claim_world_region_lease(p_region uuid,p_worker text,p_lease_seconds integer default 30)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lease public.world_region_worker_leases%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_worker is null or length(p_worker) not between 1 and 96 or p_lease_seconds not between 5 and 300 then raise exception 'invalid_region_worker'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-region:'||p_region::text,0));
  perform 1 from public.world_region_states where region_id=p_region and status='active' for update;
  if not found then raise exception 'region_not_active'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=p_region for update;
  if found and v_lease.worker_id<>p_worker and v_lease.lease_until>now() then
    return jsonb_build_object('ok',false,'status','lease_held','worker',v_lease.worker_id,'leaseUntil',v_lease.lease_until,'leaseEpoch',v_lease.lease_epoch);
  end if;
  insert into public.world_region_worker_leases(region_id,worker_id,lease_until)
    values(p_region,p_worker,now()+make_interval(secs=>p_lease_seconds))
  on conflict(region_id) do update set
    worker_id=excluded.worker_id,
    lease_epoch=case
      when world_region_worker_leases.worker_id=excluded.worker_id and world_region_worker_leases.lease_until>now()
        then world_region_worker_leases.lease_epoch
      else world_region_worker_leases.lease_epoch+1
    end,
    lease_until=excluded.lease_until,
    heartbeat_at=now()
  returning * into v_lease;
  return jsonb_build_object('ok',true,'status','leased','regionId',p_region,'worker',p_worker,'leaseUntil',v_lease.lease_until,'leaseEpoch',v_lease.lease_epoch);
end $$;
revoke all on function public.claim_world_region_lease(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_world_region_lease(uuid,text,integer) to service_role;

insert into public.world_region_states(region_id,simulation_tick)
select p.id,s.simulation_tick from public.world_provinces p join public.world_shards s on s.id=p.shard_id;

create table public.world_region_control_history (
  id bigint generated always as identity primary key,
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  previous_owner_faction_id text references public.world_factions(id) on delete restrict,
  owner_faction_id text references public.world_factions(id) on delete restrict,
  previous_state text,
  control_state text not null,
  cause text not null,
  world_tick bigint not null check (world_tick >= 0),
  metadata jsonb not null default '{}',
  changed_at timestamptz not null default now()
);

create or replace function public.record_world_region_control_history()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_context jsonb;
begin
  if new.owner_faction_id is not distinct from old.owner_faction_id
    and new.claimed_by_faction_id is not distinct from old.claimed_by_faction_id
    and new.control_strength is not distinct from old.control_strength
    and new.control_state is not distinct from old.control_state then return new; end if;
  begin v_context:=coalesce(nullif(current_setting('app.world_control_context',true),''),'{}')::jsonb;
  exception when others then v_context:='{}'::jsonb; end;
  insert into public.world_region_control_history(
    region_id,previous_owner_faction_id,owner_faction_id,previous_state,control_state,cause,world_tick,metadata
  ) values(new.id,old.owner_faction_id,new.owner_faction_id,old.control_state,new.control_state,
    coalesce(nullif(v_context->>'cause',''),'direct_control_change'),
    coalesce((v_context->>'worldTick')::bigint,0),coalesce(v_context->'metadata','{}'::jsonb));
  return new;
end $$;
create trigger world_provinces_control_history after update of owner_faction_id,claimed_by_faction_id,control_strength,control_state
on public.world_provinces for each row execute function public.record_world_region_control_history();

create or replace function public.mutate_world_region_control(
  p_region uuid,p_expected_revision bigint,p_owner_faction text,p_claimed_faction text,
  p_control_strength numeric,p_control_state text,p_cause text,p_world_tick bigint,
  p_worker text,p_lease_epoch bigint,p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region public.world_provinces%rowtype; v_lease public.world_region_worker_leases%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_expected_revision is null or p_expected_revision < 1
    or p_control_strength is null or p_control_strength not between 0 and 1
    or p_control_state is null or p_control_state not in ('controlled','contested','besieged','occupied','unclaimed')
    or p_cause is null or length(trim(p_cause)) not between 1 and 160
    or p_world_tick is null or p_world_tick < 0
    or p_worker is null or length(p_worker) not between 1 and 96 or p_lease_epoch is null or p_lease_epoch<1
    or coalesce(jsonb_typeof(p_metadata),'null') <> 'object' then raise exception 'invalid_region_control'; end if;
  select * into v_region from public.world_provinces where id=p_region for update;
  if not found then raise exception 'region_not_found'; end if;
  if v_region.revision <> p_expected_revision then raise exception 'stale_region'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=p_region for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch or v_lease.lease_until<=now()
    then raise exception 'region_lease_required'; end if;
  if p_owner_faction is not null and not exists (
    select 1 from public.world_factions where id=p_owner_faction and planet_id=v_region.planet_id
  ) then raise exception 'invalid_owner_faction'; end if;
  if p_claimed_faction is not null and not exists (
    select 1 from public.world_factions where id=p_claimed_faction and planet_id=v_region.planet_id
  ) then raise exception 'invalid_claimed_faction'; end if;
  perform set_config('app.world_control_context',jsonb_build_object('cause',trim(p_cause),'worldTick',p_world_tick,'metadata',p_metadata)::text,true);
  update public.world_provinces set owner_faction_id=p_owner_faction,
    claimed_by_faction_id=p_claimed_faction,control_strength=p_control_strength,
    control_state=p_control_state,control_updated_at=now(),revision=revision+1
  where id=p_region returning * into v_region;
  return jsonb_build_object('ok',true,'regionId',v_region.id,'revision',v_region.revision);
end $$;
revoke all on function public.mutate_world_region_control(uuid,bigint,text,text,numeric,text,text,bigint,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_world_region_control(uuid,bigint,text,text,numeric,text,text,bigint,text,bigint,jsonb) to service_role;

create table public.world_region_handoffs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null check (length(request_id) between 1 and 96),
  party_id uuid not null references public.world_parties(id) on delete cascade,
  route_id uuid not null references public.world_routes(id) on delete restrict,
  source_region_id uuid not null references public.world_provinces(id) on delete restrict,
  destination_region_id uuid not null references public.world_provinces(id) on delete restrict,
  destination_location_id uuid not null references public.world_locations(id) on delete restrict,
  source_worker_id text not null check (length(source_worker_id) between 1 and 96),
  source_lease_epoch bigint not null check (source_lease_epoch > 0),
  expected_party_revision bigint not null check (expected_party_revision > 0),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  payload jsonb not null default '{}',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (party_id,request_id),
  check (source_region_id <> destination_region_id)
);
create unique index world_region_handoff_one_pending on public.world_region_handoffs(party_id) where status='pending';

create or replace function public.request_world_region_handoff(p_party uuid,p_route uuid,p_request_id text,p_expected_revision bigint,p_source_worker text,p_source_lease_epoch bigint,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_party public.world_parties%rowtype; v_route public.world_routes%rowtype; v_existing public.world_region_handoffs%rowtype; v_handoff public.world_region_handoffs%rowtype; v_source_lease public.world_region_worker_leases%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_source_worker is null or length(p_source_worker) not between 1 and 96 or p_source_lease_epoch is null or p_source_lease_epoch<=0 or coalesce(jsonb_typeof(p_payload),'null')<>'object' then raise exception 'invalid_handoff_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-region-handoff:'||p_party::text,0));
  select * into v_existing from public.world_region_handoffs where party_id=p_party and request_id=p_request_id;
  if found then
    if v_existing.route_id<>p_route or v_existing.expected_party_revision<>p_expected_revision or v_existing.source_worker_id<>p_source_worker or v_existing.source_lease_epoch<>p_source_lease_epoch or v_existing.payload<>p_payload then raise exception 'idempotency_conflict'; end if;
    select * into v_source_lease from public.world_region_worker_leases where region_id=v_existing.source_region_id for update;
    if not found or v_source_lease.worker_id<>p_source_worker or v_source_lease.lease_epoch<>p_source_lease_epoch or v_source_lease.lease_until<=now() then raise exception 'source_lease_required'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'handoffId',v_existing.id,'status',v_existing.status);
  end if;
  select * into v_party from public.world_parties where id=p_party for update;
  if not found or v_party.revision<>p_expected_revision then raise exception 'stale_party'; end if;
  select * into v_route from public.world_routes where id=p_route;
  if not found or v_route.origin_region_id=v_route.destination_region_id or v_route.origin_region_id<>v_party.region_id or v_party.route_id<>v_route.id then raise exception 'invalid_cross_region_route'; end if;
  select * into v_source_lease from public.world_region_worker_leases where region_id=v_route.origin_region_id for update;
  if not found or v_source_lease.worker_id<>p_source_worker or v_source_lease.lease_epoch<>p_source_lease_epoch or v_source_lease.lease_until<=now() then raise exception 'source_lease_required'; end if;
  insert into public.world_region_handoffs(request_id,party_id,route_id,source_region_id,destination_region_id,destination_location_id,source_worker_id,source_lease_epoch,expected_party_revision,payload)
  values(p_request_id,v_party.id,v_route.id,v_route.origin_region_id,v_route.destination_region_id,v_route.destination_id,p_source_worker,p_source_lease_epoch,v_party.revision,p_payload)
  returning * into v_handoff;
  return jsonb_build_object('ok',true,'duplicate',false,'handoffId',v_handoff.id,'status',v_handoff.status);
end $$;
revoke all on function public.request_world_region_handoff(uuid,uuid,text,bigint,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.request_world_region_handoff(uuid,uuid,text,bigint,text,bigint,jsonb) to service_role;

create or replace function public.complete_world_region_handoff(p_handoff uuid,p_destination_worker text,p_destination_lease_epoch bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_handoff public.world_region_handoffs%rowtype; v_party public.world_parties%rowtype; v_lease public.world_region_worker_leases%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_destination_worker is null or length(p_destination_worker) not between 1 and 96 or p_destination_lease_epoch is null or p_destination_lease_epoch<=0 then raise exception 'destination_lease_required'; end if;
  select * into v_handoff from public.world_region_handoffs where id=p_handoff for update;
  if not found then raise exception 'handoff_not_found'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=v_handoff.destination_region_id for update;
  if not found or v_lease.worker_id<>p_destination_worker or v_lease.lease_epoch<>p_destination_lease_epoch or v_lease.lease_until<=now() then raise exception 'destination_lease_required'; end if;
  if v_handoff.status='accepted' then return jsonb_build_object('ok',true,'duplicate',true,'partyId',v_handoff.party_id,'regionId',v_handoff.destination_region_id); end if;
  if v_handoff.status<>'pending' then raise exception 'handoff_not_pending'; end if;
  select * into v_party from public.world_parties where id=v_handoff.party_id for update;
  if v_party.region_id<>v_handoff.source_region_id or v_party.revision<>v_handoff.expected_party_revision then raise exception 'stale_handoff'; end if;
  if not exists(select 1 from public.world_locations where id=v_handoff.destination_location_id and province_id=v_handoff.destination_region_id) then raise exception 'invalid_destination'; end if;
  update public.world_movement_orders set status='arrived',revision=revision+1 where party_id=v_party.id and route_id=v_handoff.route_id and status in ('queued','moving');
  update public.world_parties set region_id=v_handoff.destination_region_id,location_id=v_handoff.destination_location_id,route_id=null,route_progress=0,revision=revision+1,updated_at=now() where id=v_party.id returning * into v_party;
  update public.world_region_handoffs set status='accepted',completed_at=now() where id=v_handoff.id;
  return jsonb_build_object('ok',true,'duplicate',false,'partyId',v_party.id,'regionId',v_party.region_id,'partyRevision',v_party.revision);
end $$;
revoke all on function public.complete_world_region_handoff(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.complete_world_region_handoff(uuid,text,bigint) to service_role;

do $$ declare t text; begin foreach t in array array['world_universes','world_star_systems','world_planets','world_factions','world_region_states','world_region_worker_leases','world_region_control_history','world_region_handoffs'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy world_region_handoffs_owner_read on public.world_region_handoffs for select to authenticated using(exists(select 1 from public.world_parties p where p.id=party_id and p.owner_user_id=auth.uid()));

commit;
