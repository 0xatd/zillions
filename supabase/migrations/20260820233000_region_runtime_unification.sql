-- Retire shard-wide mutation and make one leased region runtime the only
-- authority that drains player movement commands and advances world systems.
begin;

create table public.world_region_runtime_ticks (
  region_id uuid not null references public.world_provinces(id) on delete cascade,
  world_tick bigint not null check (world_tick >= 0),
  worker_id text not null,
  lease_epoch bigint not null check (lease_epoch > 0),
  commands_applied integer not null default 0,
  commands_rejected integer not null default 0,
  result jsonb not null default '{}',
  processed_at timestamptz not null default now(),
  primary key (region_id,world_tick)
);
alter table public.world_region_runtime_ticks enable row level security;

create table public.world_api_rate_buckets (
  actor_user_id uuid not null,
  scope text not null check(scope~'^[a-z0-9:._-]{1,64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check(request_count>0),
  updated_at timestamptz not null default now(),
  primary key(actor_user_id,scope,window_started_at)
);
alter table public.world_api_rate_buckets enable row level security;

create function public.consume_world_api_rate_limit(p_actor uuid,p_scope text,p_limit integer,p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_window timestamptz; v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_actor is null or p_scope!~'^[a-z0-9:._-]{1,64}$' or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then raise exception 'invalid_rate_limit'; end if;
  v_window:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_window_seconds)*p_window_seconds);
  perform pg_advisory_xact_lock(hashtextextended('world-rate:'||p_actor::text||':'||p_scope||':'||v_window::text,0));
  insert into public.world_api_rate_buckets(actor_user_id,scope,window_started_at,request_count)
    values(p_actor,p_scope,v_window,1)
  on conflict(actor_user_id,scope,window_started_at) do update set request_count=public.world_api_rate_buckets.request_count+1,updated_at=now()
  returning request_count into v_count;
  delete from public.world_api_rate_buckets where window_started_at<now()-interval '2 days';
  return jsonb_build_object('allowed',v_count<=p_limit,'limit',p_limit,'remaining',greatest(0,p_limit-v_count),
    'retryAfterSeconds',greatest(1,ceil(extract(epoch from (v_window+make_interval(secs=>p_window_seconds)-clock_timestamp())))::integer));
end $$;
revoke all on function public.consume_world_api_rate_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_world_api_rate_limit(uuid,text,integer,integer) to service_role;

-- The authored Greenfall victory is the existing, server-recorded tutorial.
-- Convert that proof once instead of trusting five browser-supplied flags.
create or replace function public.complete_world_tutorial_from_campaign(p_actor uuid,p_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_progress public.world_tutorial_progress%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.game_characters where id=p_character and user_id=p_actor) then raise exception 'character_not_found'; end if;
  if not exists(select 1 from public.match_history where user_id=p_actor and mode='campaign' and result='win'
    and coalesce((summary->>'level')::integer,0)>=1) then raise exception 'tutorial_campaign_required'; end if;
  insert into public.world_tutorial_progress(user_id,character_id,movement_complete,town_complete,recruitment_complete,trade_complete,battle_complete,completed_at)
    values(p_actor,p_character,true,true,true,true,true,now())
  on conflict(user_id) do update set character_id=excluded.character_id,movement_complete=true,town_complete=true,
    recruitment_complete=true,trade_complete=true,battle_complete=true,completed_at=coalesce(public.world_tutorial_progress.completed_at,now()),
    revision=public.world_tutorial_progress.revision+1,updated_at=now()
  returning * into v_progress;
  return jsonb_build_object('ok',true,'complete',true,'revision',v_progress.revision);
end $$;
revoke all on function public.complete_world_tutorial_from_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_world_tutorial_from_campaign(uuid,uuid) to service_role;

alter table public.world_company_members drop constraint if exists world_company_members_status_check;
alter table public.world_company_members
  add column member_kind text not null default 'troop' check(member_kind in('troop','companion')),
  add column experience bigint not null default 0 check(experience>=0),
  add column morale numeric(6,3) not null default 60 check(morale between 0 and 100),
  add column fatigue numeric(6,3) not null default 0 check(fatigue between 0 and 100),
  add column formation_slot text,
  add column captor_party_id uuid references public.world_parties(id) on delete set null,
  add constraint world_company_members_status_check check(status in('active','wounded','recovering','captured','dead','dismissed')),
  add constraint world_company_member_capture_state check((status='captured')=(captor_party_id is not null));

create function public.world_company_effective_speed(p_party uuid)
returns numeric language sql stable set search_path=public,pg_temp as $$
  select greatest(.1,p.speed*(1-least(.35,coalesce(active_members.count,0)::numeric/greatest(c.member_capacity,1)*.15))*(1-p.fatigue/250))
  from public.world_parties p left join public.world_companies c on c.party_id=p.id
  left join lateral(select count(*) from public.world_company_members m where m.party_id=p.id and m.status in('active','wounded','recovering')) active_members on true
  where p.id=p_party;
$$;

create function public.bootstrap_player_world_knowledge()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tick bigint;
begin
  if new.kind<>'player' or new.owner_user_id is null or new.location_id is null then return new; end if;
  select simulation_tick into v_tick from public.world_shards where id=new.shard_id;
  insert into public.world_scouting_reports(shard_id,observer_party_id,location_id,observed_tick,expires_tick,accuracy,intelligence)
    select new.shard_id,new.id,known.location_id,v_tick,v_tick+1000000000,1,jsonb_build_object('mapKnowledge',true,'marketAccess',known.kind in('town','village','fort','port'))
    from (
      select l.id location_id,l.kind from public.world_locations l where l.id=new.location_id
      union
      select l.id,l.kind from public.world_routes r join public.world_locations l on l.id=r.destination_id where r.origin_id=new.location_id
    ) known;
  return new;
end $$;
create trigger world_party_bootstrap_knowledge after insert on public.world_parties for each row execute function public.bootstrap_player_world_knowledge();

update public.world_locations set services=services||'{"fastTravel":true,"fastTravelUnlocked":true}'::jsonb where kind in('town','fort','port');
update public.world_locations set services=services||'{"missionLevel":1,"missionName":"Greenfall Training Deployment"}'::jsonb where key='greenfall-crossing';
update public.world_locations set services=services||'{"missionLevel":2,"missionName":"Rotmire Relief"}'::jsonb where key='rotmire-watch';

create or replace function public.social_party_snapshot(p_actor uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object(
    'id',p.id,'name',p.name,'revision',p.revision,'leaderUserId',p.leader_user_id,
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.user_id,'name',coalesce(gc.name,'Commander'),'role',m.role,'travelMode',m.travel_mode,
      'worldPartyId',wp.id,'worldPartyRevision',wp.revision,
      'health',case when wp.id is null then 0 else coalesce((select round(avg(cm.health)) from public.world_company_members cm where cm.party_id=wp.id and cm.status not in('dismissed','dead','captured')),100) end,
      'status',case when wp.route_id is not null then 'Travelling' else initcap(wp.stance) end,
      'companyStrength',coalesce(a.combat_power,0),'locationId',wp.location_id,'routeId',wp.route_id,'location',coalesce(l.name,'Unknown')
    ) order by case m.role when 'leader' then 0 when 'officer' then 1 else 2 end,m.joined_at)
      from public.social_party_members m left join public.world_parties wp on wp.owner_user_id=m.user_id and wp.kind='player'
      left join public.game_characters gc on gc.id=wp.leader_character_id and gc.user_id=m.user_id
      left join public.world_armies a on a.party_id=wp.id left join public.world_locations l on l.id=wp.location_id where m.party_id=p.id),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'partyId',i.party_id,'invitedBy',i.invited_by,'invitedUserId',i.invited_user_id,'status',i.status,'expiresAt',i.expires_at) order by i.created_at) from public.social_party_invites i where i.party_id=p.id and i.status='pending' and i.expires_at>now()),'[]'::jsonb)
  ) from public.social_parties p join public.social_party_members mine on mine.party_id=p.id where mine.user_id=p_actor and p.status='active'),jsonb_build_object('id',null,'members','[]'::jsonb,'invites','[]'::jsonb)) || jsonb_build_object(
    'pendingInvites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'partyId',i.party_id,'partyName',p.name,'invitedBy',i.invited_by,'expiresAt',i.expires_at) order by i.created_at) from public.social_party_invites i join public.social_parties p on p.id=i.party_id where i.invited_user_id=p_actor and i.status='pending' and i.expires_at>now() and p.status='active'),'[]'::jsonb));
$$;

create function public.social_party_manage_member(p_actor uuid,p_request_id text,p_party uuid,p_target uuid,p_action text,p_role text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor_role text; v_target_role text; v_party public.social_parties%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_action not in('kick','promote') or p_target=p_actor then raise exception 'invalid_member_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended('social-party-member:'||p_party::text||':'||p_target::text,0));
  select * into v_party from public.social_parties where id=p_party and status='active' for update;
  select role into v_actor_role from public.social_party_members where party_id=p_party and user_id=p_actor;
  select role into v_target_role from public.social_party_members where party_id=p_party and user_id=p_target for update;
  if v_actor_role is null or v_target_role is null then raise exception 'party_member_not_found'; end if;
  if p_action='kick' then
    if v_actor_role not in('leader','officer') or v_target_role='leader' or (v_actor_role='officer' and v_target_role='officer') then raise exception 'member_action_forbidden'; end if;
    delete from public.social_party_members where party_id=p_party and user_id=p_target;
  else
    if v_actor_role<>'leader' or p_role not in('member','officer') then raise exception 'member_action_forbidden'; end if;
    update public.social_party_members set role=p_role where party_id=p_party and user_id=p_target;
  end if;
  update public.social_parties set revision=revision+1,updated_at=now() where id=p_party;
  return jsonb_build_object('ok',true,'requestId',p_request_id,'partyId',p_party,'targetId',p_target,'action',p_action,'role',p_role);
end $$;
revoke all on function public.social_party_manage_member(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.social_party_manage_member(uuid,text,uuid,uuid,text,text) to service_role;

alter table public.world_battle_assignments
  add column region_id uuid references public.world_provinces(id) on delete restrict,
  add column region_lease_epoch bigint check(region_lease_epoch>0);

create function public.fence_world_battle_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region uuid; v_lease public.world_region_worker_leases%rowtype;
begin
  if tg_op='INSERT' then
    select p.region_id into v_region from public.world_encounters e join public.world_parties p on p.id=e.attacker_party_id where e.id=new.encounter_id;
    select * into v_lease from public.world_region_worker_leases where region_id=v_region for update;
    if not found or v_lease.lease_until<=now() then raise exception 'region_lease_required'; end if;
    new.region_id:=v_region; new.region_lease_epoch:=v_lease.lease_epoch;
  elsif new.state='committed' and old.state is distinct from new.state then
    select * into v_lease from public.world_region_worker_leases where region_id=old.region_id for update;
    if not found or v_lease.lease_epoch<>old.region_lease_epoch or v_lease.lease_until<=now() then raise exception 'stale_battle_region_lease'; end if;
  end if;
  return new;
end $$;
create trigger world_battle_assignment_region_fence before insert or update of state on public.world_battle_assignments
for each row execute function public.fence_world_battle_assignment();

create function public.living_world_get_battle_assignment(p_actor uuid,p_assignment uuid,p_nonce uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_assignment public.world_battle_assignments%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  select * into v_assignment from public.world_battle_assignments where id=p_assignment and requested_by=p_actor and nonce=p_nonce;
  if not found or v_assignment.state<>'issued' or v_assignment.expires_at<=now() then raise exception 'battle_assignment_unavailable'; end if;
  return to_jsonb(v_assignment);
end $$;
revoke all on function public.living_world_get_battle_assignment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.living_world_get_battle_assignment(uuid,uuid,uuid) to service_role;

create or replace function public.living_world_process_shard(
  p_shard text,p_worker text,p_lease_seconds integer default 30,p_command_limit integer default 100
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  raise exception 'shard_worker_retired';
end $$;
revoke all on function public.living_world_process_shard(text,text,integer,integer) from public,anon,authenticated,service_role;

create or replace function public.process_world_region_runtime(
  p_region uuid,p_worker text,p_lease_epoch bigint,p_command_limit integer default 100
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_state public.world_region_states%rowtype;
  v_lease public.world_region_worker_leases%rowtype;
  v_command public.world_commands%rowtype;
  v_party public.world_parties%rowtype;
  v_route public.world_routes%rowtype;
  v_order public.world_movement_orders%rowtype;
  v_handoff public.world_region_handoffs%rowtype;
  v_tick bigint;
  v_applied integer:=0;
  v_rejected integer:=0;
  v_result jsonb;
  v_factions jsonb;
  v_logistics jsonb;
  v_shard text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_region is null or p_worker is null or length(p_worker) not between 1 and 96
    or p_lease_epoch<1 or p_command_limit not between 1 and 500 then raise exception 'invalid_region_runtime'; end if;

  perform pg_advisory_xact_lock(hashtextextended('world-region:'||p_region::text,0));
  select * into v_state from public.world_region_states where region_id=p_region and status='active' for update;
  if not found then raise exception 'region_not_active'; end if;
  select * into v_lease from public.world_region_worker_leases where region_id=p_region for update;
  if not found or v_lease.worker_id<>p_worker or v_lease.lease_epoch<>p_lease_epoch or v_lease.lease_until<=now()
    then raise exception 'region_lease_required'; end if;
  select shard_id into v_shard from public.world_provinces where id=p_region;

  -- Destination ownership accepts completed cross-region travel first. The
  -- party changes region exactly once under the destination lease.
  for v_handoff in select * from public.world_region_handoffs where destination_region_id=p_region and status='pending' order by requested_at,id for update
  loop
    perform public.complete_world_region_handoff(v_handoff.id,p_worker,p_lease_epoch);
  end loop;

  for v_command in
    select c.* from public.world_commands c join public.world_parties p on p.id=c.party_id
    where p.region_id=p_region and c.completed_at is null
    order by c.created_at,c.actor_user_id,c.request_id limit p_command_limit
    for update of c skip locked
  loop
    begin
      select * into strict v_party from public.world_parties where id=v_command.party_id and region_id=p_region for update;
      if v_party.revision<v_command.expected_revision+1 then raise exception 'party_revision_corrupt'; end if;
      if v_command.command_type='issue_movement' then
        select * into v_route from public.world_routes where id=(v_command.payload->>'routeId')::uuid
          and origin_region_id=p_region for update;
        if not found then raise exception 'route_not_found'; end if;
        if v_party.route_id is not null then raise exception 'party_already_moving'; end if;
        if v_party.location_id is distinct from v_route.origin_id then raise exception 'route_not_reachable'; end if;
        if coalesce(v_command.payload->>'mode','travel')='fast' and (v_route.danger>=.5 or v_route.control_state='blocked'
          or coalesce((v_route.blockade_state->>'closed')::boolean,false)
          or not exists(select 1 from public.world_locations where id=v_route.destination_id and coalesce((services->>'fastTravel')::boolean,false)))
          then raise exception 'fast_travel_unavailable'; end if;
        insert into public.world_movement_orders(party_id,route_id,issued_by,issued_tick,start_tick,expected_arrival_tick,status)
          values(v_party.id,v_route.id,v_command.actor_user_id,v_state.simulation_tick,v_state.simulation_tick,
            v_state.simulation_tick+case when coalesce(v_command.payload->>'mode','travel')='fast' then 1 else greatest(1,ceil(v_route.distance/greatest(public.world_company_effective_speed(v_party.id),.1))::bigint) end,'moving')
          returning * into v_order;
        update public.world_parties set location_id=null,route_id=v_route.id,route_progress=0,revision=revision+1,updated_at=now()
          where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('movementOrderId',v_order.id,'expectedArrivalTick',v_order.expected_arrival_tick);
      elsif v_command.command_type='cancel_movement' then
        select * into v_order from public.world_movement_orders where id=(v_command.payload->>'movementOrderId')::uuid
          and party_id=v_party.id and status in('queued','moving') for update;
        if not found then raise exception 'movement_order_not_active'; end if;
        select * into strict v_route from public.world_routes where id=v_order.route_id;
        update public.world_movement_orders set status='cancelled',revision=revision+1 where id=v_order.id;
        update public.world_parties set location_id=case when route_progress<.5 then v_route.origin_id else v_route.destination_id end,
          route_id=null,route_progress=0,revision=revision+1,updated_at=now() where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('locationId',v_party.location_id);
      elsif v_command.command_type='set_encounter_choice' then
        v_result:=public.submit_world_encounter_decision(
          v_command.actor_user_id,
          (v_command.payload->>'encounterId')::uuid,
          v_party.id,
          v_command.request_id,
          (v_command.payload->>'decisionRevision')::bigint,
          replace(v_command.payload->>'choice','_','-'),
          null,
          p_worker,
          p_lease_epoch
        );
      else
        raise exception 'command_requires_domain_endpoint';
      end if;
      update public.world_commands set response=jsonb_build_object('ok',true,'status','applied','partyRevision',v_party.revision,'result',v_result),completed_at=now()
        where shard_id=v_command.shard_id and actor_user_id=v_command.actor_user_id and request_id=v_command.request_id;
      v_applied:=v_applied+1;
    exception when others then
      update public.world_commands set response=jsonb_build_object('ok',false,'status','rejected','error',case when sqlstate='P0001' then sqlerrm else 'invalid_command_payload' end),completed_at=now()
        where shard_id=v_command.shard_id and actor_user_id=v_command.actor_user_id and request_id=v_command.request_id;
      v_rejected:=v_rejected+1;
    end;
  end loop;

  -- Source ownership advances cross-region routes only to the boundary, then
  -- emits a durable handoff for the destination runtime to accept.
  update public.world_parties p set
    route_progress=least(1,(v_state.simulation_tick+1-o.start_tick)::numeric/greatest(1,o.expected_arrival_tick-o.start_tick)),
    fatigue=least(100,p.fatigue+.05),revision=p.revision+1,updated_at=now()
  from public.world_movement_orders o join public.world_routes r on r.id=o.route_id
  where o.party_id=p.id and p.region_id=p_region and o.status='moving'
    and r.origin_region_id=p_region and r.destination_region_id<>p_region
    and o.expected_arrival_tick>v_state.simulation_tick+1;
  for v_order in select o.* from public.world_movement_orders o join public.world_parties p on p.id=o.party_id
    join public.world_routes r on r.id=o.route_id where p.region_id=p_region and o.status='moving'
    and r.origin_region_id=p_region and r.destination_region_id<>p_region
    and o.expected_arrival_tick<=v_state.simulation_tick+1 order by o.id for update of o
  loop
    select * into strict v_party from public.world_parties where id=v_order.party_id for update;
    perform public.request_world_region_handoff(v_party.id,v_order.route_id,'runtime:'||v_order.id::text,
      v_party.revision,p_worker,p_lease_epoch,jsonb_build_object('arrivalTick',v_state.simulation_tick+1));
  end loop;

  v_factions:=public.living_world_process_region(p_region,p_worker,p_lease_epoch,64);
  v_tick:=(v_factions->>'tick')::bigint;
  v_logistics:=public.process_world_region_logistics(p_region,v_tick,p_worker,p_lease_epoch);
  update public.world_shards s set simulation_tick=greatest(s.simulation_tick,v_tick),revision=s.revision+1,updated_at=now()
    where s.id=v_shard;
  v_result:=jsonb_build_object('ok',true,'regionId',p_region,'tick',v_tick,'commandsApplied',v_applied,
    'commandsRejected',v_rejected,'factions',v_factions,'logistics',v_logistics);
  insert into public.world_region_runtime_ticks(region_id,world_tick,worker_id,lease_epoch,commands_applied,commands_rejected,result)
    values(p_region,v_tick,p_worker,p_lease_epoch,v_applied,v_rejected,v_result)
    on conflict(region_id,world_tick) do nothing;
  return v_result;
end $$;

revoke all on function public.process_world_region_runtime(uuid,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.process_world_region_runtime(uuid,text,bigint,integer) to service_role;

create function public.living_world_region_runtime_batch(p_limit integer default 8)
returns table(region_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select s.region_id
  from public.world_region_states s
  left join lateral(
    select max(t.processed_at) last_processed_at
    from public.world_region_runtime_ticks t
    where t.region_id=s.region_id
  ) tick on true
  where s.status='active'
  order by tick.last_processed_at nulls first,s.region_id
  limit greatest(1,least(16,coalesce(p_limit,8)));
$$;
revoke all on function public.living_world_region_runtime_batch(integer) from public,anon,authenticated;
grant execute on function public.living_world_region_runtime_batch(integer) to service_role;
commit;
