-- Run each active region at most once per scheduled minute. Vercel can retry
-- or overlap cron delivery, so the database selection is the cadence fence.
begin;
create or replace function public.living_world_region_runtime_batch(p_limit integer default 72)
returns table(region_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select s.region_id
  from public.world_region_states s
  left join lateral(
    select max(t.processed_at) last_processed_at
    from public.world_region_runtime_ticks t
    where t.region_id=s.region_id
  ) tick on true
  where s.status='active'
    and (tick.last_processed_at is null or tick.last_processed_at<=now()-interval '45 seconds')
  order by tick.last_processed_at nulls first,s.region_id
  limit greatest(1,least(96,coalesce(p_limit,72)));
$$;
revoke all on function public.living_world_region_runtime_batch(integer) from public,anon,authenticated;
grant execute on function public.living_world_region_runtime_batch(integer) to service_role;
commit;
