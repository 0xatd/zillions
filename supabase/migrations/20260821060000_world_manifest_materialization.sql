-- Materialize one immutable manifest into the authority tables in one transaction.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.world_manifests
  add column materialization_hash text,
  add column topology_fingerprint text,
  add column materialization_summary jsonb not null default '{}';

create function public.world_materialized_topology_fingerprint(p_planet text)
returns text language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select 'sha256-'||encode(extensions.digest(convert_to(jsonb_build_object(
    'regions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'shardId',shard_id,'key',key,'name',name,'bounds',bounds,'planetId',planet_id) order by id) from public.world_provinces where planet_id=p_planet),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'provinceId',l.province_id,'key',l.key,'name',l.name,'kind',l.kind,'position',l.position,'services',l.services,'seat',l.is_region_seat) order by l.id) from public.world_locations l join public.world_provinces p on p.id=l.province_id where p.planet_id=p_planet),'[]'::jsonb),
    'routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'provinceId',r.province_id,'originId',r.origin_id,'destinationId',r.destination_id,'distance',r.distance,'terrain',r.terrain,'originRegionId',r.origin_region_id,'destinationRegionId',r.destination_region_id) order by r.id) from public.world_routes r join public.world_provinces p on p.id=r.origin_region_id where p.planet_id=p_planet),'[]'::jsonb)
  )::text,'utf8'),'sha256'),'hex');
$$;
revoke all on function public.world_materialized_topology_fingerprint(text) from public,anon,authenticated;
grant execute on function public.world_materialized_topology_fingerprint(text) to service_role;

create function public.fence_materialized_world_province()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if tg_op='INSERT' then if exists(select 1 from public.world_manifests where planet_id=new.planet_id and materialization_state='ready') then raise exception 'materialized_world_topology_immutable'; end if; return new; end if;
  if not exists(select 1 from public.world_manifests where planet_id=old.planet_id and materialization_state='ready') then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' or (old.id,old.shard_id,old.key,old.name,old.bounds,old.planet_id) is distinct from (new.id,new.shard_id,new.key,new.name,new.bounds,new.planet_id) then raise exception 'materialized_world_topology_immutable'; end if;
  return new;
end $$;
create function public.fence_materialized_world_location()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_planet text; begin
  select planet_id into v_planet from public.world_provinces where id=case when tg_op='INSERT' then new.province_id else old.province_id end;
  if tg_op='INSERT' then if exists(select 1 from public.world_manifests where planet_id=v_planet and materialization_state='ready') then raise exception 'materialized_world_topology_immutable'; end if; return new; end if;
  if not exists(select 1 from public.world_manifests where planet_id=v_planet and materialization_state='ready') then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' or (old.id,old.province_id,old.key,old.name,old.kind,old.position,old.services,old.is_region_seat) is distinct from (new.id,new.province_id,new.key,new.name,new.kind,new.position,new.services,new.is_region_seat) then raise exception 'materialized_world_topology_immutable'; end if;
  return new;
end $$;
create function public.fence_materialized_world_route()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_planet text; begin
  select planet_id into v_planet from public.world_provinces where id=case when tg_op='INSERT' then new.origin_region_id else old.origin_region_id end;
  if tg_op='INSERT' then if exists(select 1 from public.world_manifests where planet_id=v_planet and materialization_state='ready') then raise exception 'materialized_world_topology_immutable'; end if; return new; end if;
  if not exists(select 1 from public.world_manifests where planet_id=v_planet and materialization_state='ready') then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' or (old.id,old.province_id,old.origin_id,old.destination_id,old.distance,old.terrain,old.origin_region_id,old.destination_region_id) is distinct from (new.id,new.province_id,new.origin_id,new.destination_id,new.distance,new.terrain,new.origin_region_id,new.destination_region_id) then raise exception 'materialized_world_topology_immutable'; end if;
  return new;
end $$;
create trigger fence_world_province_topology before insert or update or delete on public.world_provinces for each row execute function public.fence_materialized_world_province();
create trigger fence_world_location_topology before insert or update or delete on public.world_locations for each row execute function public.fence_materialized_world_location();
create trigger fence_world_route_topology before insert or update or delete on public.world_routes for each row execute function public.fence_materialized_world_route();

create or replace function public.materialize_world_manifest(p_planet text,p_manifest_hash text,p_bundle jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.world_manifests%rowtype;x record;v_start uuid;v_counts jsonb;v_bundle_hash text;v_topology_fingerprint text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_bundle is null or jsonb_typeof(p_bundle)<>'object' or p_bundle->>'schema'<>'zillions.world-materialization.v1' then raise exception 'invalid_materialization_bundle'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-materialization:'||p_planet,0));
  select * into m from public.world_manifests where planet_id=p_planet for update;
  if not found then raise exception 'world_manifest_not_found'; end if;
  if m.content_hash<>p_manifest_hash or p_bundle->>'manifestHash'<>p_manifest_hash or p_bundle->>'planetId'<>p_planet then raise exception 'world_manifest_hash_conflict'; end if;
  if (p_bundle-'manifestHash'-'materializationHash')<>m.manifest->'materialization' then raise exception 'materialization_template_mismatch';end if;
  v_bundle_hash:='sha256-'||encode(extensions.digest(convert_to((p_bundle-'materializationHash')::text,'utf8'),'sha256'),'hex');
  if m.materialization_state='ready' then
    if m.materialization_hash is distinct from v_bundle_hash then raise exception 'world_materialization_conflict'; end if;
    v_topology_fingerprint:=public.world_materialized_topology_fingerprint(p_planet);
    if m.topology_fingerprint is null or m.topology_fingerprint is distinct from v_topology_fingerprint then raise exception 'world_materialization_topology_drift'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'planetId',p_planet,'manifestHash',p_manifest_hash,'materializationHash',m.materialization_hash,'summary',m.materialization_summary);
  end if;
  if p_bundle->>'shardId' is null or not exists(select 1 from public.world_planets where id=p_planet and shard_id=p_bundle->>'shardId') then raise exception 'materialization_planet_scope_mismatch'; end if;
  if jsonb_array_length(p_bundle->'regions')<>jsonb_array_length(m.manifest->'regions')
    or jsonb_array_length(p_bundle->'locations')<>jsonb_array_length(m.manifest->'settlements')
    or jsonb_array_length(p_bundle->'routes')<>jsonb_array_length(m.manifest->'routes')*2 then raise exception 'materialization_topology_count_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'regions') r where not exists(select 1 from jsonb_array_elements(m.manifest->'regions') mr where mr->>'id'=r->>'id' and mr->>'key'=r->>'key' and mr->>'name'=r->>'name' and mr->'polygon'=r->'polygon')) then raise exception 'materialization_region_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'locations') l where not exists(select 1 from jsonb_array_elements(m.manifest->'settlements') ml where ml->>'id'=l->>'id' and ml->>'key'=l->>'key' and ml->>'regionId'=l->>'regionId' and ml->>'kind'=l->>'kind' and ml->'position'=l->'position')) then raise exception 'materialization_location_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(m.manifest->'routes') mr where
    (select count(*) from jsonb_array_elements(p_bundle->'routes') r where r->>'sourceRouteId'=mr->>'id' and
      ((r->>'direction'='forward' and r->>'originRegionId'=mr->>'originRegionId' and r->>'destinationRegionId'=mr->>'destinationRegionId' and r->'path'=mr->'path')
       or (r->>'direction'='reverse' and r->>'originRegionId'=mr->>'destinationRegionId' and r->>'destinationRegionId'=mr->>'originRegionId' and r->'path'=(select jsonb_agg(value order by ord desc) from jsonb_array_elements(mr->'path') with ordinality p(value,ord)))))<>2
  ) then raise exception 'materialization_route_mismatch'; end if;
  if jsonb_array_length(p_bundle->'parties')<>jsonb_array_length(m.manifest->'regions') or jsonb_array_length(p_bundle->'armies')<>jsonb_array_length(m.manifest->'regions') or jsonb_array_length(p_bundle->'markets')<1 then raise exception 'materialization_seed_count_mismatch'; end if;
  if exists(select 1 from public.world_parties p where p.shard_id=p_bundle->>'shardId' and (p.owner_user_id is not null or p.kind='player' or p.leader_character_id is not null
    or exists(select 1 from public.world_armies a where a.party_id=p.id and a.commander_user_id is not null)
    or exists(select 1 from public.world_companies c where c.party_id=p.id and c.owner_user_id is not null)
    or exists(select 1 from public.world_tutorial_progress t where t.world_party_id=p.id))) then raise exception 'earth_materialization_player_party_conflict'; end if;

  update public.world_manifests set materialization_state='materializing',materialization_hash=v_bundle_hash where planet_id=p_planet;
  delete from public.world_parties where shard_id=p_bundle->>'shardId';
  delete from public.world_routes where origin_region_id in(select id from public.world_provinces where planet_id=p_planet);
  delete from public.world_locations where province_id in(select id from public.world_provinces where planet_id=p_planet);
  delete from public.world_provinces where planet_id=p_planet;

  for x in select * from jsonb_to_recordset(p_bundle->'factions') as f(id text,name text,kind text) loop
    insert into public.world_factions(id,planet_id,name,kind) values(x.id,p_planet,x.name,x.kind)
    on conflict(id) do update set name=excluded.name,kind=excluded.kind where world_factions.planet_id=p_planet;
  end loop;
  for x in select * from jsonb_to_recordset(p_bundle->'regions') as r(id uuid,key text,name text,landmass text,polygon jsonb,biome text,"resourceBias" numeric,"ownerFactionId" text) loop
    insert into public.world_provinces(id,shard_id,key,name,bounds,owner_faction_id,planet_id,claimed_by_faction_id,control_strength,garrison_strength,control_state)
    values(x.id,p_bundle->>'shardId',x.key,x.name,jsonb_build_object('polygon',x.polygon,'landmass',x.landmass,'biome',x.biome,'resourceBias',x."resourceBias"),x."ownerFactionId",p_planet,x."ownerFactionId",1,0,'controlled');
  end loop;
  for x in select * from jsonb_to_recordset(p_bundle->'locations') as l(id uuid,"regionId" uuid,key text,name text,kind text,position jsonb,"ownerFactionId" text,services jsonb,"isRegionSeat" boolean) loop
    insert into public.world_locations(id,province_id,key,name,kind,position,owner_faction_id,services,claimed_by_faction_id,control_strength,garrison_strength,control_state,is_region_seat)
    values(x.id,x."regionId",x.key,x.name,x.kind,x.position,x."ownerFactionId",x.services,x."ownerFactionId",1,0,'controlled',x."isRegionSeat");
  end loop;
  for x in select * from jsonb_to_recordset(p_bundle->'routes') as r(id uuid,"originRegionId" uuid,"destinationRegionId" uuid,"originId" uuid,"destinationId" uuid,kind text,distance numeric,path jsonb,"ownerFactionId" text) loop
    insert into public.world_routes(id,province_id,origin_id,destination_id,distance,terrain,danger,origin_region_id,destination_region_id,owner_faction_id,claimed_by_faction_id,control_strength,control_state)
    values(x.id,x."originRegionId",x."originId",x."destinationId",x.distance,jsonb_build_object('kind',x.kind,'path',x.path),case when x.kind='sea' then .12 else .04 end,x."originRegionId",x."destinationRegionId",x."ownerFactionId",x."ownerFactionId",1,'controlled');
  end loop;
  insert into public.world_region_states(region_id,simulation_tick,status) select id,0,'paused' from public.world_provinces where planet_id=p_planet;
  for x in select * from jsonb_to_recordset(p_bundle->'parties') as p(id uuid,"regionId" uuid,"locationId" uuid,"ownerFactionId" text,name text,kind text,"combatPower" numeric) loop
    insert into public.world_parties(id,shard_id,region_id,owner_faction_id,name,kind,location_id,speed,morale,stance)
    values(x.id,p_bundle->>'shardId',x."regionId",x."ownerFactionId",x.name,x.kind,x."locationId",.8,75,'friendly');
    update public.world_provinces set garrison_strength=x."combatPower" where id=x."regionId";
    update public.world_locations set garrison_strength=x."combatPower" where id=x."locationId";
  end loop;
  for x in select * from jsonb_to_recordset(p_bundle->'armies') as a(id uuid,"partyId" uuid,"combatPower" numeric,formation jsonb) loop insert into public.world_armies(id,party_id,combat_power,formation) values(x.id,x."partyId",x."combatPower",x.formation); end loop;
  for x in select * from jsonb_to_recordset(p_bundle->'markets') as q("locationId" uuid,"commodityKey" text,stock numeric,"targetStock" numeric,"basePrice" bigint,"buyPrice" bigint,"sellPrice" bigint) loop
    insert into public.world_markets(location_id,commodity_key,stock,target_stock,base_price,buy_price,sell_price) values(x."locationId",x."commodityKey",x.stock,x."targetStock",x."basePrice",x."buyPrice",x."sellPrice");
  end loop;
  select (p_bundle->>'startingLocationId')::uuid into v_start;
  update public.world_planets set world_state=world_state||jsonb_build_object('manifestHash',p_manifest_hash,'startingLocationId',v_start,'materializationHash',v_bundle_hash),revision=revision+1 where id=p_planet;
  v_counts:=jsonb_build_object('regions',jsonb_array_length(p_bundle->'regions'),'locations',jsonb_array_length(p_bundle->'locations'),'routes',jsonb_array_length(p_bundle->'routes'),'garrisons',jsonb_array_length(p_bundle->'parties'),'markets',jsonb_array_length(p_bundle->'markets'));
  v_topology_fingerprint:=public.world_materialized_topology_fingerprint(p_planet);
  update public.world_manifests set materialization_state='ready',materialized_at=now(),materialization_summary=v_counts,topology_fingerprint=v_topology_fingerprint where planet_id=p_planet;
  return jsonb_build_object('ok',true,'duplicate',false,'planetId',p_planet,'manifestHash',p_manifest_hash,'materializationHash',v_bundle_hash,'summary',v_counts);
exception when others then
  raise;
end $$;

create or replace function public.enter_living_world(p_actor uuid,p_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_progress public.world_tutorial_progress%rowtype;v_character public.game_characters%rowtype;v_region uuid;v_location uuid;v_party uuid;v_social uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-entry:'||p_actor::text,0));
  select * into v_character from public.game_characters where id=p_character and user_id=p_actor for update;if not found then raise exception 'character_not_found'; end if;
  select * into v_progress from public.world_tutorial_progress where user_id=p_actor and character_id=p_character for update;if not found or v_progress.completed_at is null then raise exception 'tutorial_incomplete'; end if;
  if v_progress.world_party_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'partyId',v_progress.world_party_id,'shardId','earth-1');end if;
  select l.province_id,l.id into v_region,v_location from public.world_planets planet join public.world_locations l on l.id=(planet.world_state->>'startingLocationId')::uuid where planet.id='earth';
  if v_region is null then select p.id,l.id into v_region,v_location from public.world_provinces p join public.world_locations l on l.province_id=p.id where p.shard_id='earth-1' and p.key='greenfall' and l.key='greenfall-crossing';end if;
  if v_region is null or v_location is null then raise exception 'earth_bootstrap_missing';end if;
  insert into public.world_parties(shard_id,region_id,owner_user_id,leader_character_id,name,kind,location_id,speed,morale,stance) values('earth-1',v_region,p_actor,p_character,v_character.name||'''s Company','player',v_location,1.2,60,'friendly') returning id into v_party;
  insert into public.world_armies(party_id,commander_user_id,combat_power,formation) values(v_party,p_actor,0,'{}');
  insert into public.social_parties(shard_id,leader_user_id,name) values('earth-1',p_actor,v_character.name||'''s Party') returning id into v_social;
  insert into public.social_party_members(party_id,user_id,role) values(v_social,p_actor,'leader');
  update public.world_tutorial_progress set entered_world_at=now(),world_party_id=v_party,revision=revision+1,updated_at=now() where user_id=p_actor;
  return jsonb_build_object('ok',true,'duplicate',false,'partyId',v_party,'socialPartyId',v_social,'shardId','earth-1');
end $$;

revoke all on function public.materialize_world_manifest(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.materialize_world_manifest(text,text,jsonb) to service_role;
commit;
