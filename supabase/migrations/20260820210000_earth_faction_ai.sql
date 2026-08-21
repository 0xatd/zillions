-- Deterministic, region-fenced faction intent and roaming-army simulation.
-- This slice exposes why armies move and applies control pressure. It does not
-- resolve sieges, transfer ownership, or simulate the full regional economy.
begin;

alter table public.world_parties
  add column strategic_intent text,
  add column strategic_reason text,
  add column strategic_target_location_id uuid references public.world_locations(id) on delete set null,
  add column strategic_intent_tick bigint check (strategic_intent_tick >= 0);

-- Complete the initial political roster without inventing player activity.
-- Greenfall, Ironwood, and Sunward are states; Rotmire is hostile; the
-- Wayfarers represent neutral caravans and unaffiliated companies.
insert into public.world_factions(id,planet_id,name,kind) values
  ('sunward_concord','earth','Sunward Concord','state'),
  ('earth_wayfarers','earth','Earth Wayfarers','neutral')
on conflict(id) do nothing;

create table public.world_faction_region_states (
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  faction_id text not null references public.world_factions(id) on delete cascade,
  current_goal text not null check (current_goal in ('patrol','trade','raid','reinforce','pursue','defend','siege_prepare')),
  goal_reason text not null check (length(goal_reason) between 1 and 240),
  target_location_id uuid references public.world_locations(id) on delete set null,
  ownership_pressure numeric(12,4) not null default 0 check (ownership_pressure >= 0),
  evaluated_tick bigint not null check (evaluated_tick >= 0),
  revision bigint not null default 1,
  primary key (region_id,faction_id)
);

-- Single-column foreign keys prove that each row exists, but they do not prove
-- that the faction and target belong to this region's planet. Keep that
-- ownership boundary enforced for every writer, including service jobs.
create function public.enforce_world_faction_region_state_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists (
    select 1 from public.world_provinces p
    join public.world_factions f on f.id=new.faction_id and f.planet_id=p.planet_id
    where p.id=new.region_id
  ) then raise exception 'faction_region_scope_mismatch'; end if;
  if new.target_location_id is not null and not exists (
    select 1 from public.world_locations l
    where l.id=new.target_location_id and l.province_id=new.region_id
  ) then raise exception 'target_region_scope_mismatch'; end if;
  return new;
end $$;
create trigger world_faction_region_states_scope
before insert or update of region_id,faction_id,target_location_id
on public.world_faction_region_states for each row
execute function public.enforce_world_faction_region_state_scope();

alter table public.world_faction_region_states enable row level security;

create or replace function public.living_world_process_region(
  p_region uuid,p_worker text,p_lease_epoch bigint,p_max_actions integer default 64
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_state public.world_region_states%rowtype;
  v_lease public.world_region_worker_leases%rowtype;
  v_party public.world_parties%rowtype;
  v_route public.world_routes%rowtype;
  v_order public.world_movement_orders%rowtype;
  v_location public.world_locations%rowtype;
  v_goal text; v_reason text; v_target uuid; v_pursuit_target uuid; v_slot integer; v_duration bigint;
  v_processed integer:=0; v_sequence bigint; v_shard text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_region is null or p_worker is null or length(p_worker) not between 1 and 96
    or p_lease_epoch is null or p_lease_epoch<1 or p_max_actions not between 1 and 500
  then raise exception 'invalid_region_tick'; end if;

  -- A stale worker can wait on this lock, but it cannot write after takeover:
  -- the lease row is re-read and fenced inside the transaction.
  perform pg_advisory_xact_lock(hashtextextended('world-region:'||p_region::text,0));
  select * into v_state from public.world_region_states where region_id=p_region for update;
  if not found or v_state.status<>'active' then raise exception 'region_not_active'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=p_region for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch
    or v_lease.lease_until<=now() then raise exception 'stale_region_lease'; end if;
  select shard_id into v_shard from public.world_provinces where id=p_region;

  -- Advance only movement owned by this region. Cross-region arrival remains a
  -- durable handoff and is never completed by this function.
  update public.world_parties p set
    route_progress=least(1,greatest(0,(v_state.simulation_tick+1-o.start_tick)::numeric/greatest(1,o.expected_arrival_tick-o.start_tick))),
    fatigue=least(100,p.fatigue+0.05),revision=p.revision+1,updated_at=now()
  from public.world_movement_orders o join public.world_routes r on r.id=o.route_id
  where o.party_id=p.id and p.region_id=p_region and o.status='moving'
    and r.origin_region_id=p_region and r.destination_region_id=p_region
    and o.expected_arrival_tick>v_state.simulation_tick+1;
  for v_order in
    select o.* from public.world_movement_orders o
    join public.world_parties p on p.id=o.party_id
    join public.world_routes r on r.id=o.route_id
    where p.region_id=p_region and o.status='moving'
      and r.origin_region_id=p_region and r.destination_region_id=p_region
      and o.expected_arrival_tick<=v_state.simulation_tick+1
    order by o.id for update of o
  loop
    select * into strict v_route from public.world_routes where id=v_order.route_id;
    update public.world_movement_orders set status='arrived',revision=revision+1 where id=v_order.id;
    update public.world_parties set location_id=v_route.destination_id,route_id=null,route_progress=0,
      fatigue=least(100,fatigue+0.05),revision=revision+1,updated_at=now() where id=v_order.party_id;
  end loop;

  for v_party in
    select p.* from public.world_parties p
    where p.region_id=p_region and p.owner_user_id is null
      and p.owner_faction_id is not null
      and exists (
        select 1 from public.world_factions f
        join public.world_provinces owned_region on owned_region.id=p.region_id
        where f.id=p.owner_faction_id and f.planet_id=owned_region.planet_id
      )
      and p.kind in ('ai','caravan','patrol','garrison')
      and p.stance<>'engaged'
      and not exists(select 1 from public.world_region_handoffs h where h.party_id=p.id and h.status='pending')
      and not exists(select 1 from public.world_sieges s where s.attacker_party_id=p.id and s.status in('preparing','active','breached'))
    -- Rotate the bounded work set by authoritative tick. A fixed ID prefix
    -- would starve every army after p_max_actions in a large region.
    order by mod(mod(hashtextextended(p.id::text||':'||v_state.simulation_tick::text,0),2147483647)+2147483647,2147483647),p.id
    limit p_max_actions for update
  loop
    -- Stable UUID hashing plus the authoritative tick produces the same goal
    -- for the same state and command log. Wall time and entropy calls are forbidden.
    -- Hash the complete input instead of adding two bigints. Addition and
    -- abs(min_bigint) can overflow even though the choice only needs 7 slots.
    v_slot:=mod(mod(hashtextextended(v_party.id::text||':'||v_state.simulation_tick::text,0),7)+7,7)::integer;
    v_goal:=(array['patrol','trade','raid','reinforce','pursue','defend','siege_prepare'])[v_slot+1];
    if v_party.strategic_role='caravan' or v_party.kind='caravan' then v_goal:='trade';
    elsif v_party.strategic_role='patrol' then v_goal:='patrol';
    elsif v_party.strategic_role='raider' then v_goal:='raid';
    elsif v_party.strategic_role='scout' then v_goal:='pursue';
    elsif v_party.strategic_role='siege_force' then v_goal:='siege_prepare';
    elsif v_party.kind='garrison' then v_goal:=case when v_slot=6 then 'reinforce' else 'defend' end;
    end if;

    v_pursuit_target:=null;
    if v_goal='pursue' then
      select coalesce(t.location_id,tr.destination_id) into v_pursuit_target
      from public.world_pursuits po join public.world_parties t on t.id=po.target_party_id
      left join public.world_routes tr on tr.id=t.route_id
      where po.pursuer_party_id=v_party.id and po.state='active' order by po.started_tick desc limit 1;
    end if;

    -- Pick an outgoing route deterministically. Direction stays authoritative;
    -- a reverse trip requires a reverse route record.
    v_route:=null; v_target:=null;
    if v_party.location_id is not null then
      if v_goal='pursue' and v_pursuit_target is not null then
        with recursive chase(location_id,first_route,total_distance,visited,depth) as(
          select r.destination_id,r.id,r.distance::numeric(20,3),array[r.origin_id,r.destination_id],1
          from public.world_routes r where r.origin_id=v_party.location_id and r.control_state<>'blocked'
            and not coalesce((r.blockade_state->>'closed')::boolean,false)
          union all
          select r.destination_id,c.first_route,(c.total_distance+r.distance)::numeric(20,3),c.visited||r.destination_id,c.depth+1
          from chase c join public.world_routes r on r.origin_id=c.location_id
          where c.depth<24 and not r.destination_id=any(c.visited) and r.control_state<>'blocked'
            and not coalesce((r.blockade_state->>'closed')::boolean,false)
        )
        select r.* into v_route from chase c join public.world_routes r on r.id=c.first_route
        where c.location_id=v_pursuit_target order by c.total_distance,c.first_route limit 1;
      else
        select r.* into v_route from public.world_routes r
        where r.origin_region_id=p_region and r.origin_id=v_party.location_id
          and r.control_state<>'blocked' and not coalesce((r.blockade_state->>'closed')::boolean,false)
        order by mod(mod(hashtextextended(r.id::text||':'||v_state.simulation_tick::text,0),2147483647)+2147483647,2147483647),r.id
        limit 1;
      end if;
      if found then v_target:=v_route.destination_id; end if;
    end if;
    select * into v_location from public.world_locations where id=coalesce(v_target,v_party.location_id);
    if v_goal='pursue' and v_route.id is not null then
      update public.world_pursuits set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('chaseRouteId',v_route.id,'targetLocationId',v_pursuit_target,'chaseTick',v_state.simulation_tick)
        where pursuer_party_id=v_party.id and state='active';
    end if;

    v_reason:=case v_goal
      when 'patrol' then 'Securing a known road and scouting nearby movement.'
      when 'trade' then 'Moving goods toward a connected settlement.'
      when 'raid' then 'Testing hostile control along an exposed route.'
      when 'reinforce' then 'Supporting a friendly settlement under pressure.'
      when 'pursue' then 'Searching the region for a vulnerable hostile party.'
      when 'defend' then 'Holding position to protect faction-controlled ground.'
      else 'Gathering strength near a rival strategic location.' end;

    update public.world_parties set strategic_intent=v_goal,strategic_reason=v_reason,
      strategic_target_location_id=coalesce(v_target,location_id),strategic_intent_tick=v_state.simulation_tick,
      revision=revision+1,updated_at=now() where id=v_party.id;

    insert into public.world_faction_region_states(region_id,faction_id,current_goal,goal_reason,target_location_id,ownership_pressure,evaluated_tick)
      values(p_region,v_party.owner_faction_id,v_goal,v_reason,
        case when v_route.destination_region_id=p_region then v_target else v_party.location_id end,
        case when v_location.owner_faction_id is distinct from v_party.owner_faction_id and v_goal in ('raid','siege_prepare') then 1 else 0 end,
        v_state.simulation_tick)
    on conflict(region_id,faction_id) do update set current_goal=excluded.current_goal,
      goal_reason=excluded.goal_reason,target_location_id=excluded.target_location_id,
      ownership_pressure=public.world_faction_region_states.ownership_pressure+excluded.ownership_pressure,
      evaluated_tick=excluded.evaluated_tick,revision=public.world_faction_region_states.revision+1;

    if v_route.id is not null and v_goal in ('patrol','trade','raid','reinforce','pursue','siege_prepare')
      and not exists(select 1 from public.world_movement_orders where party_id=v_party.id and status in ('queued','moving'))
      and not exists(select 1 from public.world_caravan_plans where party_id=v_party.id and state<>'suspended')
    then
      v_duration:=greatest(1,ceil(v_route.distance/greatest(v_party.speed,0.001)))::bigint;
      insert into public.world_movement_orders(id,party_id,route_id,issued_tick,start_tick,expected_arrival_tick,status)
        values(md5(v_party.id::text||':'||v_route.id::text||':'||v_state.simulation_tick::text)::uuid,
          v_party.id,v_route.id,v_state.simulation_tick,v_state.simulation_tick,v_state.simulation_tick+v_duration,'moving');
      update public.world_parties set location_id=null,route_id=v_route.id,route_progress=0,
        revision=revision+1,updated_at=now() where id=v_party.id;
    end if;
    v_processed:=v_processed+1;
  end loop;

  -- Event sequence remains shard-global while simulation authority is regional.
  perform pg_advisory_xact_lock(hashtextextended('world-events:'||v_shard,0));
  select coalesce(max(sequence),0)+1 into v_sequence from public.world_events where shard_id=v_shard;
  insert into public.world_events(shard_id,sequence,tick,event_type,aggregate_type,aggregate_id,aggregate_revision,payload)
    values(v_shard,v_sequence,v_state.simulation_tick,'region.faction_tick','region',p_region::text,v_state.revision,
      jsonb_build_object('regionId',p_region,'processed',v_processed,'leaseEpoch',p_lease_epoch));
  update public.world_region_states set simulation_tick=simulation_tick+1,revision=revision+1,updated_at=now()
    where region_id=p_region returning * into v_state;
  update public.world_region_worker_leases set heartbeat_at=now()
    where region_id=p_region and worker_id=p_worker and lease_epoch=p_lease_epoch;
  return jsonb_build_object('ok',true,'status','advanced','regionId',p_region,
    'tick',v_state.simulation_tick,'processed',v_processed,'leaseEpoch',p_lease_epoch);
end $$;

revoke all on function public.living_world_process_region(uuid,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.living_world_process_region(uuid,text,bigint,integer) to service_role;

commit;
