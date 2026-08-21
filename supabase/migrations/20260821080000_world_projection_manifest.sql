-- Publish only immutable strategic-map geometry to the trusted projection API.
-- Seed, generator internals, materialization data, and mutable campaign state stay private.
begin;

create or replace function public.living_world_projection_manifest(p_planet text)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select case when m.planet_id is null then null else jsonb_build_object(
    'content_hash',m.content_hash,
    'manifest',jsonb_build_object(
      'planetId',m.manifest->'planetId',
      'projection',m.manifest->'projection',
      'size',m.manifest->'size',
      'landmasses',m.manifest->'landmasses',
      'regions',m.manifest->'regions'
    )
  ) end
  from (select 1) x
  left join public.world_manifests m on m.planet_id=p_planet;
$$;

revoke all on function public.living_world_projection_manifest(text) from public,anon,authenticated;
grant execute on function public.living_world_projection_manifest(text) to service_role;

commit;
