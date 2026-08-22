-- Direct PostgreSQL tests are normally below 250 ms. The production Vercel
-- worker includes two network round trips per region, so use a hosted latency
-- threshold that still catches a slow region without flagging normal I/O.
begin;
create or replace function public.record_world_region_runtime_health(p_region uuid,p_world_tick bigint,p_worker text,p_lease_epoch bigint,
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
  v_breached:=not p_success or p_duration_ms>750 or v_lag>2 or v_backlog>32 or v_congestion='overloaded' or p_action_saturated;
  insert into public.world_region_runtime_health(region_id,world_tick,worker_id,lease_epoch,duration_ms,success,error_code,tick_lag,handoff_backlog,present_parties,action_budget,action_saturated,congestion_state,threshold_breached)
    values(p_region,p_world_tick,p_worker,p_lease_epoch,p_duration_ms,p_success,p_error_code,v_lag,v_backlog,v_present,p_action_budget,p_action_saturated,v_congestion,v_breached);
  return jsonb_build_object('ok',true,'tickLag',v_lag,'handoffBacklog',v_backlog,'presentParties',v_present,'congestion',v_congestion,'thresholdBreached',v_breached);
end $$;
commit;
