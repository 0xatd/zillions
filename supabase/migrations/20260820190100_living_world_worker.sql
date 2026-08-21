-- Single-writer living-world simulation worker. The API records commands; this
-- function applies them and advances exactly one deterministic shard tick.
begin;

create table public.world_worker_leases (
  shard_id text primary key references public.world_shards(id) on delete cascade,
  worker_id text not null,
  lease_until timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  check (length(worker_id) between 1 and 96)
);
alter table public.world_worker_leases enable row level security;

create table public.world_battle_orders (
  engagement_id uuid not null references public.world_engagements(id) on delete cascade,
  round integer not null check (round > 0),
  party_id uuid not null references public.world_parties(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  orders jsonb not null,
  submitted_at timestamptz not null default now(),
  revision bigint not null default 1,
  primary key (engagement_id, round, party_id)
);
alter table public.world_battle_orders enable row level security;
create policy world_battle_orders_actor_read on public.world_battle_orders
  for select to authenticated using (actor_user_id = auth.uid());

-- Enqueue only. Reserving the party revision prevents two clients from issuing
-- commands from the same stale snapshot. The worker performs the domain write.
create or replace function public.living_world_command(
  p_actor uuid,p_shard text,p_request_id text,p_type text,p_party uuid,p_expected_revision bigint,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing public.world_commands%rowtype; v_party public.world_parties%rowtype;
  v_result jsonb; v_sequence bigint; v_tick bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_actor is null or p_shard is null or p_request_id is null or length(p_request_id) not between 1 and 96 then raise exception 'invalid_request'; end if;
  if p_type not in('issue_movement','cancel_movement','set_encounter_choice','submit_battle_order','accept_surrender','trade_market') then raise exception 'unsupported_command'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_payload'; end if;

  perform pg_advisory_xact_lock(hashtextextended('world-shard:'||p_shard,0));
  select simulation_tick into v_tick from public.world_shards where id=p_shard and status='active' for update;
  if not found then raise exception 'shard_not_active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-command:'||p_shard||':'||p_actor::text||':'||p_request_id,0));
  select * into v_existing from public.world_commands where shard_id=p_shard and actor_user_id=p_actor and request_id=p_request_id;
  if found then
    if v_existing.command_type<>p_type or v_existing.party_id is distinct from p_party
      or v_existing.expected_revision<>p_expected_revision or v_existing.payload<>p_payload then raise exception 'idempotency_conflict'; end if;
    return v_existing.response || jsonb_build_object('duplicate',true);
  end if;

  select * into v_party from public.world_parties where id=p_party and shard_id=p_shard for update;
  if not found then raise exception 'party_not_found'; end if;
  if v_party.owner_user_id is distinct from p_actor then raise exception 'unauthorized_ownership'; end if;
  if v_party.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
  update public.world_parties set revision=revision+1,updated_at=now() where id=p_party returning * into v_party;
  v_result:=jsonb_build_object('ok',true,'status','queued','duplicate',false,'partyRevision',v_party.revision);
  insert into public.world_commands(shard_id,actor_user_id,request_id,command_type,party_id,expected_revision,payload,response)
    values(p_shard,p_actor,p_request_id,p_type,p_party,p_expected_revision,p_payload,v_result);
  select coalesce(max(sequence),0)+1 into v_sequence from public.world_events where shard_id=p_shard;
  insert into public.world_events(shard_id,sequence,tick,event_type,actor_user_id,aggregate_type,aggregate_id,aggregate_revision,payload,command_request_id)
    values(p_shard,v_sequence,v_tick,'command.queued',p_actor,'party',p_party::text,v_party.revision,jsonb_build_object('type',p_type),p_request_id);
  return v_result;
end $$;

create or replace function public.living_world_process_shard(
  p_shard text,p_worker text,p_lease_seconds integer default 30,p_command_limit integer default 100
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_shard public.world_shards%rowtype; v_lease public.world_worker_leases%rowtype;
  v_command public.world_commands%rowtype; v_party public.world_parties%rowtype;
  v_route public.world_routes%rowtype; v_order public.world_movement_orders%rowtype;
  v_encounter public.world_encounters%rowtype; v_engagement public.world_engagements%rowtype;
  v_market public.world_markets%rowtype; v_wallet public.player_wallets%rowtype;
  v_sequence bigint; v_processed integer:=0; v_failed integer:=0; v_duration bigint;
  v_quantity numeric; v_cost bigint; v_side text; v_result jsonb; v_location uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_shard is null or p_worker is null or length(p_worker) not between 1 and 96 then raise exception 'invalid_worker'; end if;
  if p_lease_seconds not between 5 and 300 or p_command_limit not between 1 and 500 then raise exception 'invalid_worker_limits'; end if;

  -- Every command submission and tick uses the same shard-first lock order.
  perform pg_advisory_xact_lock(hashtextextended('world-shard:'||p_shard,0));
  select * into v_shard from public.world_shards where id=p_shard and status='active' for update;
  if not found then raise exception 'shard_not_active'; end if;
  insert into public.world_worker_leases(shard_id,worker_id,lease_until)
    values(p_shard,p_worker,now()+make_interval(secs=>p_lease_seconds)) on conflict(shard_id) do nothing;
  select * into v_lease from public.world_worker_leases where shard_id=p_shard for update;
  if v_lease.worker_id<>p_worker and v_lease.lease_until>now() then
    return jsonb_build_object('ok',false,'status','lease_held','worker',v_lease.worker_id,'leaseUntil',v_lease.lease_until);
  end if;
  update public.world_worker_leases set worker_id=p_worker,lease_until=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now() where shard_id=p_shard;

  for v_command in
    select * from public.world_commands where shard_id=p_shard and completed_at is null
    order by created_at,actor_user_id,request_id limit p_command_limit for update skip locked
  loop
    begin
      select * into strict v_party from public.world_parties where id=v_command.party_id and shard_id=p_shard for update;
      -- Acceptance reserved exactly one revision for this command.
      if v_party.revision < v_command.expected_revision+1 then raise exception 'party_revision_corrupt'; end if;

      if v_command.command_type='issue_movement' then
        select r.* into v_route from public.world_routes r join public.world_provinces p on p.id=r.province_id
          where r.id=(v_command.payload->>'routeId')::uuid and p.shard_id=p_shard for update of r;
        if not found then raise exception 'route_not_found'; end if;
        if v_party.route_id is not null then raise exception 'party_already_moving'; end if;
        if v_party.location_id is distinct from v_route.origin_id then raise exception 'route_not_reachable'; end if;
        v_duration:=greatest(1,ceil(v_route.distance/greatest(v_party.speed,0.1))::bigint);
        insert into public.world_movement_orders(party_id,route_id,issued_by,issued_tick,start_tick,expected_arrival_tick,status)
          values(v_party.id,v_route.id,v_command.actor_user_id,v_shard.simulation_tick,v_shard.simulation_tick,v_shard.simulation_tick+v_duration,'moving') returning * into v_order;
        update public.world_parties set location_id=null,route_id=v_route.id,route_progress=0,updated_at=now(),revision=revision+1 where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('movementOrderId',v_order.id,'expectedArrivalTick',v_order.expected_arrival_tick);

      elsif v_command.command_type='cancel_movement' then
        select * into v_order from public.world_movement_orders where id=(v_command.payload->>'movementOrderId')::uuid and party_id=v_party.id and status in('queued','moving') for update;
        if not found then raise exception 'movement_order_not_active'; end if;
        select * into strict v_route from public.world_routes where id=v_order.route_id;
        v_location:=case when v_party.route_progress<0.5 then v_route.origin_id else v_route.destination_id end;
        update public.world_movement_orders set status='cancelled',revision=revision+1 where id=v_order.id;
        update public.world_parties set location_id=v_location,route_id=null,route_progress=0,updated_at=now(),revision=revision+1 where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('locationId',v_location);

      elsif v_command.command_type='set_encounter_choice' then
        select * into v_encounter from public.world_encounters where id=(v_command.payload->>'encounterId')::uuid and shard_id=p_shard and state in('choosing','negotiating') for update;
        if not found or v_party.id not in(v_encounter.attacker_party_id,v_encounter.defender_party_id) then raise exception 'encounter_not_available'; end if;
        if v_command.payload->>'choice' not in('fight','auto_command','surrender','attempt_escape','rearguard','diversion','negotiate') then raise exception 'invalid_encounter_choice'; end if;
        if v_party.id=v_encounter.attacker_party_id then update public.world_encounters set attacker_choice=v_command.payload->>'choice',revision=revision+1 where id=v_encounter.id returning * into v_encounter;
        else update public.world_encounters set defender_choice=v_command.payload->>'choice',revision=revision+1 where id=v_encounter.id returning * into v_encounter; end if;
        update public.world_parties set revision=revision+1,updated_at=now() where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('encounterId',v_encounter.id,'choice',v_command.payload->>'choice');

      elsif v_command.command_type='submit_battle_order' then
        select e.* into v_engagement from public.world_engagements e join public.world_encounters n on n.id=e.encounter_id
          where e.id=(v_command.payload->>'engagementId')::uuid and n.shard_id=p_shard and e.state='active'
            and v_party.id in(n.attacker_party_id,n.defender_party_id) for update of e;
        if not found or (v_command.payload->>'round')::integer<>v_engagement.current_round+1 then raise exception 'battle_round_not_open'; end if;
        insert into public.world_battle_orders(engagement_id,round,party_id,actor_user_id,orders)
          values(v_engagement.id,(v_command.payload->>'round')::integer,v_party.id,v_command.actor_user_id,v_command.payload->'order');
        update public.world_parties set revision=revision+1,updated_at=now() where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('engagementId',v_engagement.id,'round',(v_command.payload->>'round')::integer);

      elsif v_command.command_type='accept_surrender' then
        select * into v_encounter from public.world_encounters where id=(v_command.payload->>'encounterId')::uuid and shard_id=p_shard and state in('choosing','negotiating') for update;
        if not found or v_party.id<>v_encounter.attacker_party_id or v_encounter.defender_choice<>'surrender' then raise exception 'surrender_not_offered'; end if;
        if coalesce(jsonb_typeof(v_command.payload->'terms'),'null')<>'object' or v_command.payload->'terms'<>'{}'::jsonb then raise exception 'unsupported_surrender_terms'; end if;
        update public.world_encounters set attacker_choice='accept_surrender',state='surrendered',revision=revision+1 where id=v_encounter.id returning * into v_encounter;
        update public.world_parties set stance='neutral',revision=revision+1,updated_at=now() where id in(v_encounter.attacker_party_id,v_encounter.defender_party_id);
        select * into v_party from public.world_parties where id=v_command.party_id;
        v_result:=jsonb_build_object('encounterId',v_encounter.id,'state','surrendered','terms',v_command.payload->'terms');

      elsif v_command.command_type='trade_market' then
        v_quantity:=(v_command.payload->>'quantity')::numeric; v_side:=v_command.payload->>'side';
        if v_quantity<=0 or trunc(v_quantity)<>v_quantity or v_side not in('buy','sell') then raise exception 'invalid_trade'; end if;
        if v_party.location_id is distinct from (v_command.payload->>'locationId')::uuid then raise exception 'party_not_at_market'; end if;
        select * into v_market from public.world_markets where location_id=v_party.location_id and commodity_key=v_command.payload->>'commodityKey' for update;
        if not found then raise exception 'market_offer_not_found'; end if;
        insert into public.player_wallets(user_id) values(v_command.actor_user_id) on conflict do nothing;
        select * into v_wallet from public.player_wallets where user_id=v_command.actor_user_id for update;
        v_cost:=case when v_side='buy' then v_market.buy_price else v_market.sell_price end*v_quantity::bigint;
        if v_side='buy' then
          if v_market.stock<v_quantity or v_wallet.salvage_alloy<v_cost then raise exception 'trade_unavailable'; end if;
          update public.world_markets set stock=stock-v_quantity,revision=revision+1 where location_id=v_market.location_id and commodity_key=v_market.commodity_key;
          insert into public.world_cargo(party_id,commodity_key,quantity) values(v_party.id,v_market.commodity_key,v_quantity)
            on conflict(party_id,commodity_key) do update set quantity=world_cargo.quantity+excluded.quantity,revision=world_cargo.revision+1;
          update public.player_wallets set salvage_alloy=salvage_alloy-v_cost,revision=revision+1,updated_at=now() where user_id=v_command.actor_user_id returning * into v_wallet;
        else
          update public.world_cargo set quantity=quantity-v_quantity,revision=revision+1 where party_id=v_party.id and commodity_key=v_market.commodity_key and quantity-reserved_quantity>=v_quantity;
          if not found then raise exception 'insufficient_cargo'; end if;
          update public.world_markets set stock=stock+v_quantity,revision=revision+1 where location_id=v_market.location_id and commodity_key=v_market.commodity_key;
          update public.player_wallets set salvage_alloy=salvage_alloy+v_cost,revision=revision+1,updated_at=now() where user_id=v_command.actor_user_id returning * into v_wallet;
        end if;
        update public.world_parties set revision=revision+1,updated_at=now() where id=v_party.id returning * into v_party;
        v_result:=jsonb_build_object('side',v_side,'quantity',v_quantity,'cost',v_cost,'balance',v_wallet.salvage_alloy);
      end if;

      select coalesce(max(sequence),0)+1 into v_sequence from public.world_events where shard_id=p_shard;
      insert into public.world_events(shard_id,sequence,tick,event_type,actor_user_id,aggregate_type,aggregate_id,aggregate_revision,payload,command_request_id)
        values(p_shard,v_sequence,v_shard.simulation_tick,'command.applied',v_command.actor_user_id,'party',v_party.id::text,v_party.revision,jsonb_build_object('type',v_command.command_type,'result',v_result),v_command.request_id);
      v_result:=jsonb_build_object('ok',true,'status','applied','duplicate',false,'partyRevision',v_party.revision,'result',v_result,'sequence',v_sequence);
      update public.world_commands set response=v_result,completed_at=now() where shard_id=p_shard and actor_user_id=v_command.actor_user_id and request_id=v_command.request_id;
      v_processed:=v_processed+1;
    exception when others then
      -- Do not expose database details through the actor-readable command row.
      v_result:=jsonb_build_object('ok',false,'status','rejected','error',case when sqlstate='P0001' then sqlerrm else 'invalid_command_payload' end);
      update public.world_commands set response=v_result,completed_at=now() where shard_id=p_shard and actor_user_id=v_command.actor_user_id and request_id=v_command.request_id;
      v_failed:=v_failed+1;
    end;
  end loop;

  -- Tick movement from authoritative order timing. No wall-clock deltas enter
  -- the simulation, so replaying a seed and command log gives the same result.
  update public.world_parties p set
    route_progress=least(1,(v_shard.simulation_tick+1-o.start_tick)::numeric/greatest(1,o.expected_arrival_tick-o.start_tick)),
    fatigue=least(100,p.fatigue+0.05),revision=p.revision+1,updated_at=now()
  from public.world_movement_orders o where o.party_id=p.id and p.shard_id=p_shard and o.status='moving' and o.expected_arrival_tick>v_shard.simulation_tick+1;

  for v_order in select o.* from public.world_movement_orders o join public.world_parties p on p.id=o.party_id
    where p.shard_id=p_shard and o.status='moving' and o.expected_arrival_tick<=v_shard.simulation_tick+1 for update of o
  loop
    select * into strict v_route from public.world_routes where id=v_order.route_id;
    update public.world_movement_orders set status='arrived',revision=revision+1 where id=v_order.id;
    update public.world_parties set location_id=v_route.destination_id,route_id=null,route_progress=0,fatigue=least(100,fatigue+0.05),revision=revision+1,updated_at=now() where id=v_order.party_id;
  end loop;
  update public.world_supplies s set quantity=greatest(0,s.quantity-s.consumption_per_tick),revision=s.revision+1
    from public.world_parties p where p.id=s.party_id and p.shard_id=p_shard and s.consumption_per_tick>0;

  update public.world_shards set simulation_tick=simulation_tick+1,revision=revision+1,updated_at=now() where id=p_shard returning * into v_shard;
  update public.world_worker_leases set lease_until=now(),heartbeat_at=now() where shard_id=p_shard and worker_id=p_worker;
  return jsonb_build_object('ok',true,'status','advanced','tick',v_shard.simulation_tick,'processed',v_processed,'rejected',v_failed,'shardRevision',v_shard.revision);
end $$;

revoke all on function public.living_world_process_shard(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.living_world_process_shard(text,text,integer,integer) to service_role;
commit;
