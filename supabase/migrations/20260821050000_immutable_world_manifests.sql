-- Persist generated planet topology once. Campaign state changes elsewhere.
begin;
-- This fence protects the application service role. A database owner can alter
-- or drop database objects and remains an explicit operational trust boundary.
create table public.world_manifests (
  planet_id text primary key references public.world_planets(id) on delete restrict,
  schema_version text not null check (length(schema_version) between 1 and 64),
  generator_version integer not null check (generator_version > 0), seed bigint not null check (seed >= 0),
  content_hash text not null unique check (content_hash ~ '^zillions-fingerprint-v1-[0-9a-f]{16}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  materialization_state text not null default 'pending' check (materialization_state in ('pending','materializing','ready','failed')),
  materialized_at timestamptz, created_at timestamptz not null default now(),
  check (manifest->>'planetId' = planet_id), check (manifest->>'schema' = schema_version),
  check ((manifest->>'generatorVersion')::integer = generator_version), check ((manifest->>'seed')::bigint = seed),
  check (manifest->>'contentHash' = content_hash)
);
create or replace function public.create_world_manifest_once(p_planet text,p_schema text,p_generator integer,p_seed bigint,p_hash text,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.world_manifests%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-manifest:'||p_planet,0));
  select * into v_existing from public.world_manifests where planet_id=p_planet for update;
  if found then
    if v_existing.content_hash<>p_hash or v_existing.seed<>p_seed or v_existing.generator_version<>p_generator or v_existing.schema_version<>p_schema or v_existing.manifest<>p_manifest then raise exception 'immutable_world_manifest_conflict'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'planetId',p_planet,'contentHash',v_existing.content_hash,'state',v_existing.materialization_state);
  end if;
  insert into public.world_manifests(planet_id,schema_version,generator_version,seed,content_hash,manifest) values(p_planet,p_schema,p_generator,p_seed,p_hash,p_manifest);
  return jsonb_build_object('ok',true,'duplicate',false,'planetId',p_planet,'contentHash',p_hash,'state','pending');
end $$;
create or replace function public.prevent_world_manifest_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.planet_id<>old.planet_id or new.schema_version<>old.schema_version or new.generator_version<>old.generator_version or new.seed<>old.seed or new.content_hash<>old.content_hash or new.manifest<>old.manifest then raise exception 'immutable_world_manifest_conflict'; end if;
  if old.materialization_state='ready' and new.materialization_state<>'ready' then raise exception 'world_manifest_already_materialized'; end if;
  return new;
end $$;
create trigger world_manifests_immutable before update on public.world_manifests for each row execute function public.prevent_world_manifest_mutation();
create or replace function public.prevent_world_manifest_delete() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'immutable_world_manifest_delete_forbidden';
end $$;
create trigger world_manifests_no_delete before delete on public.world_manifests for each row execute function public.prevent_world_manifest_delete();
alter table public.world_manifests enable row level security;
revoke all on public.world_manifests from public,anon,authenticated;
revoke all on public.world_manifests from service_role;
revoke create on schema public from anon,authenticated,service_role;
revoke all on function public.create_world_manifest_once(text,text,integer,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_world_manifest_once(text,text,integer,bigint,text,jsonb) to service_role;
commit;
