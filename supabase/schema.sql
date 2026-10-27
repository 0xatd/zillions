-- Zillions Supabase backend schema.
-- Keep this schema compatible with the optional localStorage/Vercel Blob
-- fallback until the browser app is fully migrated.

create extension if not exists pgcrypto;

-- Authoritative character economy. Browser profile blobs remain readable for
-- legacy/offline play, but signed-in mutations pass through economy_mutate().
create table if not exists public.game_characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_character_id text not null,
  name text not null,
  class_key text not null,
  race_key text not null check (race_key in ('human', 'robot')),
  level integer not null default 1 check (level between 1 and 100),
  -- Progress is written only by apply_match_result() (server-authoritative).
  xp bigint not null default 0 check (xp >= 0),
  stats jsonb not null default '{}'::jsonb,
  progress_revision bigint not null default 1 check (progress_revision > 0),
  customization jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_character_id),
  check (length(client_character_id) between 1 and 96),
  check (length(name) between 1 and 40)
);

create table if not exists public.player_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salvage_alloy bigint not null default 0 check (salvage_alloy >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_instances (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.game_characters(id) on delete cascade,
  legacy_key text not null,
  base_id text not null,
  slot_pool text not null,
  item_level integer not null check (item_level between 1 and 100),
  rarity integer not null check (rarity between 1 and 3),
  affixes jsonb not null default '[]'::jsonb,
  sockets jsonb not null default '[]'::jsonb,
  binding text not null default 'account' check (binding in ('account', 'character')),
  location text not null default 'stash' check (location in ('stash', 'equipped', 'sold')),
  equip_slot text,
  economy_data jsonb not null default '{}'::jsonb,
  provenance jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((location in ('stash', 'sold') and equip_slot is null) or (location = 'equipped' and equip_slot is not null))
);

create unique index if not exists item_instances_one_equipped_slot
on public.item_instances(character_id, equip_slot) where location = 'equipped';
create index if not exists item_instances_owner_character_idx
on public.item_instances(owner_user_id, character_id, created_at);

create table if not exists public.economy_requests (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  action text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, request_id),
  check (length(request_id) between 1 and 64)
);

create table if not exists public.economy_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid references public.game_characters(id) on delete set null,
  request_id text not null,
  action text not null,
  inputs jsonb not null,
  outputs jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, request_id)
);

create table if not exists public.crafting_material_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.game_characters(id) on delete cascade,
  material_id text not null check (material_id in ('alloy_shard','phase_flux','prism_dust','ascendant_core')),
  quantity integer not null default 0 check (quantity >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (character_id, material_id)
);

create table if not exists public.component_instances (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.game_characters(id) on delete cascade,
  component_id text not null check (component_id in ('frame_drive','reflex_drive','signal_drive','kinetic_optic','thermal_optic','bulwark_ward','phase_ward')),
  rank integer not null default 1 check (rank between 1 and 5),
  location text not null default 'inventory' check (location in ('inventory','socketed')),
  item_instance_id uuid references public.item_instances(id) on delete set null,
  socket_index integer,
  provenance jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((location='inventory' and item_instance_id is null and socket_index is null) or
    (location='socketed' and item_instance_id is not null and socket_index is not null))
);
create unique index if not exists component_instances_one_socket
on public.component_instances(item_instance_id, socket_index) where location='socketed';

alter table public.game_characters enable row level security;
alter table public.player_wallets enable row level security;
alter table public.item_instances enable row level security;
alter table public.economy_requests enable row level security;
alter table public.economy_audit_events enable row level security;
alter table public.crafting_material_balances enable row level security;
alter table public.component_instances enable row level security;

drop policy if exists game_characters_read_self on public.game_characters;
create policy game_characters_read_self on public.game_characters for select to authenticated using (auth.uid() = user_id);
drop policy if exists player_wallets_read_self on public.player_wallets;
create policy player_wallets_read_self on public.player_wallets for select to authenticated using (auth.uid() = user_id);
drop policy if exists item_instances_read_self on public.item_instances;
create policy item_instances_read_self on public.item_instances for select to authenticated using (auth.uid() = owner_user_id);
drop policy if exists economy_requests_read_self on public.economy_requests;
create policy economy_requests_read_self on public.economy_requests for select to authenticated using (auth.uid() = actor_user_id);
drop policy if exists economy_audit_read_self on public.economy_audit_events;
create policy economy_audit_read_self on public.economy_audit_events for select to authenticated using (auth.uid() = actor_user_id);
drop policy if exists crafting_materials_read_self on public.crafting_material_balances;
create policy crafting_materials_read_self on public.crafting_material_balances for select to authenticated using (auth.uid() = user_id);
drop policy if exists components_read_self on public.component_instances;
create policy components_read_self on public.component_instances for select to authenticated using (auth.uid() = owner_user_id);

create or replace function public.economy_mutate(
  p_actor uuid, p_request_id text, p_action text, p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_request public.economy_requests%rowtype; v_character public.game_characters%rowtype; v_item public.item_instances%rowtype;
  v_wallet public.player_wallets%rowtype; v_result jsonb; v_entry jsonb; v_price bigint; v_count integer;
  v_target_count integer; v_sold_snapshot jsonb; v_component public.component_instances%rowtype;
  v_material text; v_quantity integer; v_cost jsonb; v_proposal jsonb; v_socket_index integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_actor is null or p_request_id is null or length(p_request_id) not between 1 and 64 then raise exception 'invalid_request'; end if;

  -- Serialize each actor/request key before checking it. This makes concurrent
  -- retries wait for the first transaction instead of racing the primary key.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_request_id, 0));
  select * into v_existing_request from public.economy_requests
  where actor_user_id = p_actor and request_id = p_request_id;
  if found then
    if v_existing_request.action <> p_action or v_existing_request.request_payload <> p_payload then
      raise exception 'idempotency_conflict';
    end if;
    if v_existing_request.response_payload is null then raise exception 'request_in_progress'; end if;
    return v_existing_request.response_payload || jsonb_build_object('duplicate', true);
  end if;
  insert into public.economy_requests(actor_user_id, request_id, action, request_payload)
  values (p_actor, p_request_id, p_action, p_payload);

  if p_action = 'register_character' then
    insert into public.game_characters(user_id, client_character_id, name, class_key, race_key, level, customization)
    values (p_actor, p_payload#>>'{character,client_character_id}', p_payload#>>'{character,name}',
      p_payload#>>'{character,class_key}', p_payload#>>'{character,race_key}',
      (p_payload#>>'{character,level}')::integer, coalesce(p_payload#>'{character,customization}', '{}'::jsonb))
    on conflict (user_id, client_character_id) do update set updated_at = now()
    returning * into v_character;
    -- One account-scoped starter grant makes the free Forge usable without
    -- trusting match rewards or a browser migration. Re-registering another
    -- character cannot repeat it because user_id is the wallet primary key.
    insert into public.player_wallets(user_id, salvage_alloy) values (p_actor, 500) on conflict (user_id) do nothing;
    update public.game_characters set registered_at = coalesce(registered_at, now()), revision = revision + 1
      where id = v_character.id returning * into v_character;
  else
    select * into v_character from public.game_characters where user_id = p_actor
      and client_character_id = p_payload->>'client_character_id' for update;
    if not found then raise exception 'character_not_found'; end if;
    if p_payload->>'expected_character_revision' is not null
      and (p_payload->>'expected_character_revision')::bigint <> v_character.revision then raise exception 'stale_revision'; end if;
    insert into public.player_wallets(user_id) values (p_actor) on conflict do nothing;
  end if;

  if p_action = 'buy_vendor' then
    select count(*) into v_count from public.item_instances where character_id = v_character.id and location = 'stash';
    if v_count >= 60 then raise exception 'inventory_full'; end if;
    v_price := (p_payload->>'price')::bigint;
    update public.player_wallets set salvage_alloy = salvage_alloy - v_price, revision = revision + 1, updated_at = now()
      where user_id = p_actor and salvage_alloy >= v_price returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    v_entry := p_payload->'item';
    insert into public.item_instances(owner_user_id, character_id, legacy_key, base_id, slot_pool, item_level, rarity, affixes, sockets,
      binding, location, economy_data, provenance)
    values (p_actor, v_character.id, v_entry->>'legacy_key', v_entry->>'base_id', v_entry->>'slot_pool', (v_entry->>'item_level')::integer,
      (v_entry->>'rarity')::integer, coalesce(v_entry->'affixes','[]'), coalesce(v_entry->'sockets','[]'),
      coalesce(v_entry->>'binding','account'), 'stash', coalesce(v_entry->'economy_data','{}'),
      jsonb_build_object('kind','vendor_purchase','vendor_id',p_payload->>'vendor_id','rotation',p_payload->>'rotation','offer_index',p_payload->>'offer_index','request_id',p_request_id));
    update public.game_characters set revision = revision + 1, updated_at = now() where id = v_character.id returning * into v_character;
  elsif p_action = 'buy_craft_material' then
    v_material := p_payload->>'material_id'; v_quantity := (p_payload->>'quantity')::integer;
    v_price := (p_payload->>'price')::bigint;
    if v_material not in ('alloy_shard','phase_flux','prism_dust','ascendant_core') or v_quantity not between 1 and 20 then raise exception 'invalid_crafting_stock'; end if;
    update public.player_wallets set salvage_alloy=salvage_alloy-v_price, revision=revision+1, updated_at=now()
      where user_id=p_actor and salvage_alloy>=v_price returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    insert into public.crafting_material_balances(user_id,character_id,material_id,quantity)
      values(p_actor,v_character.id,v_material,v_quantity)
      on conflict(character_id,material_id) do update set quantity=crafting_material_balances.quantity+excluded.quantity, revision=crafting_material_balances.revision+1, updated_at=now();
    update public.game_characters set revision=revision+1,updated_at=now() where id=v_character.id returning * into v_character;
  elsif p_action = 'buy_component' then
    v_price := (p_payload->>'price')::bigint;
    update public.player_wallets set salvage_alloy=salvage_alloy-v_price, revision=revision+1,updated_at=now()
      where user_id=p_actor and salvage_alloy>=v_price returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    select count(*) into v_count from public.component_instances where character_id=v_character.id and location='inventory';
    if v_count>=40 then raise exception 'inventory_full'; end if;
    insert into public.component_instances(owner_user_id,character_id,component_id,rank,provenance)
      values(p_actor,v_character.id,p_payload->>'component_id',1,jsonb_build_object('kind','craft_vendor_purchase','request_id',p_request_id));
    update public.game_characters set revision=revision+1,updated_at=now() where id=v_character.id returning * into v_character;
  elsif p_action in ('craft_recipe','socket_insert','socket_remove') then
    v_proposal := p_payload->'proposal'; v_cost := coalesce(v_proposal->'costs','{}'::jsonb);
    select * into v_item from public.item_instances where id=(p_payload->>'item_id')::uuid and owner_user_id=p_actor
      and character_id=v_character.id and location in ('stash','equipped') for update;
    if not found then raise exception 'unauthorized_ownership'; end if;
    if (v_proposal#>>'{mutation,expectedRevision}')::bigint<>v_item.revision or (p_payload->>'expected_item_revision')::bigint<>v_item.revision then raise exception 'stale_revision'; end if;
    if v_proposal#>>'{item,instanceId}'<>v_item.id::text or v_proposal#>>'{item,ownerId}'<>p_actor::text or v_proposal#>>'{item,itemKey}'<>v_item.legacy_key then raise exception 'invalid_crafting_proposal'; end if;
    v_price := coalesce((v_cost->>'alloy')::bigint,0);
    update public.player_wallets set salvage_alloy=salvage_alloy-v_price,revision=revision+1,updated_at=now()
      where user_id=p_actor and salvage_alloy>=v_price returning * into v_wallet;
    if not found then raise exception 'insufficient_funds'; end if;
    for v_material,v_quantity in select key,value::integer from jsonb_each_text(coalesce(v_cost->'materials','{}'::jsonb)) loop
      update public.crafting_material_balances set quantity=quantity-v_quantity,revision=revision+1,updated_at=now()
        where character_id=v_character.id and material_id=v_material and quantity>=v_quantity;
      if not found then raise exception 'insufficient_materials'; end if;
    end loop;
    if p_action='socket_insert' then
      select * into v_component from public.component_instances where id=(p_payload->>'component_id')::uuid and owner_user_id=p_actor
        and character_id=v_character.id and location='inventory' for update;
      if not found then raise exception 'unauthorized_component'; end if;
      v_socket_index := (p_payload->>'socket_index')::integer;
      update public.component_instances set location='socketed',item_instance_id=v_item.id,socket_index=v_socket_index,revision=revision+1,updated_at=now() where id=v_component.id;
    elsif p_action='socket_remove' then
      v_socket_index := (p_payload->>'socket_index')::integer;
      select * into v_component from public.component_instances where item_instance_id=v_item.id and socket_index=v_socket_index and owner_user_id=p_actor and location='socketed' for update;
      if not found then raise exception 'component_not_found'; end if;
      select count(*) into v_count from public.component_instances where character_id=v_character.id and location='inventory';
      if v_count>=40 then raise exception 'inventory_full'; end if;
      update public.component_instances set location='inventory',item_instance_id=null,socket_index=null,revision=revision+1,updated_at=now() where id=v_component.id;
    elsif v_proposal->>'action'='upgrade_component' then
      v_socket_index := (p_payload->>'socket_index')::integer;
      update public.component_instances set rank=rank+1,revision=revision+1,updated_at=now()
        where item_instance_id=v_item.id and socket_index=v_socket_index and owner_user_id=p_actor and location='socketed';
      if not found then raise exception 'component_not_found'; end if;
    end if;
    update public.item_instances set sockets=v_proposal->'item'->'sockets',revision=(v_proposal#>>'{mutation,nextRevision}')::bigint,
      provenance=provenance||jsonb_build_object('last_craft',v_proposal->'provenance'),updated_at=now() where id=v_item.id returning * into v_item;
    update public.game_characters set revision=revision+1,updated_at=now() where id=v_character.id returning * into v_character;
  elsif p_action = 'sell_vendor' then
    select * into v_item from public.item_instances where id = (p_payload->>'item_id')::uuid and owner_user_id = p_actor
      and character_id = v_character.id and location = 'stash' for update;
    if not found then raise exception 'unauthorized_ownership'; end if;
    v_price := greatest(1, coalesce((v_item.economy_data->>'sell_price')::bigint, 1));
    v_sold_snapshot := to_jsonb(v_item) || jsonb_build_object('sale_price',v_price,'sold_at',now());
    update public.item_instances set location='sold', equip_slot=null, revision=revision+1, updated_at=now(),
      provenance=provenance || jsonb_build_object('sale',jsonb_build_object('request_id',p_request_id,'price',v_price,'sold_at',now()))
      where id = v_item.id returning * into v_item;
    update public.player_wallets set salvage_alloy = salvage_alloy + v_price, revision = revision + 1, updated_at = now()
      where user_id = p_actor returning * into v_wallet;
    update public.game_characters set revision = revision + 1, updated_at = now() where id = v_character.id returning * into v_character;
  elsif p_action in ('equip','unequip') then
    if p_action = 'equip' then
      select * into v_item from public.item_instances where id = (p_payload->>'item_id')::uuid and owner_user_id = p_actor
        and character_id = v_character.id and location in ('stash','equipped') for update;
      if not found then raise exception 'unauthorized_ownership'; end if;
      if p_payload->>'expected_item_revision' is not null and (p_payload->>'expected_item_revision')::bigint <> v_item.revision then raise exception 'stale_revision'; end if;
      if not (
        (v_item.slot_pool = p_payload->>'equip_slot') or
        (v_item.slot_pool = 'weapon' and p_payload->>'equip_slot' in ('weapon','weapon2')) or
        (v_item.slot_pool = 'offhand' and p_payload->>'equip_slot' in ('offhand','offhand2')) or
        (v_item.slot_pool = 'implant' and p_payload->>'equip_slot' in ('implant1','implant2'))
      ) then raise exception 'invalid_equipment_slot'; end if;
      select count(*) into v_target_count from public.item_instances where character_id=v_character.id
        and equip_slot=p_payload->>'equip_slot' and location='equipped' and id<>v_item.id;
      if v_item.location <> 'stash' and v_target_count > 0 then
        select count(*) into v_count from public.item_instances where character_id=v_character.id and location='stash';
        if v_count >= 60 then raise exception 'inventory_full'; end if;
      end if;
      update public.item_instances set location='stash', equip_slot=null, revision=revision+1, updated_at=now()
        where character_id=v_character.id and equip_slot=p_payload->>'equip_slot' and location='equipped';
      update public.item_instances set location='equipped', equip_slot=p_payload->>'equip_slot', revision=revision+1, updated_at=now() where id=v_item.id;
    else
      select count(*) into v_count from public.item_instances where character_id=v_character.id and location='stash';
      if v_count >= 60 then raise exception 'inventory_full'; end if;
      select * into v_item from public.item_instances where character_id=v_character.id
        and equip_slot=p_payload->>'equip_slot' and location='equipped' for update;
      if not found then raise exception 'item_not_found'; end if;
      if p_payload->>'expected_item_revision' is not null and (p_payload->>'expected_item_revision')::bigint <> v_item.revision then raise exception 'stale_revision'; end if;
      update public.item_instances set location='stash', equip_slot=null, revision=revision+1, updated_at=now()
        where id=v_item.id returning * into v_item;
    end if;
    update public.game_characters set revision=revision+1, updated_at=now() where id=v_character.id returning * into v_character;
  elsif p_action not in ('register_character','snapshot') then raise exception 'invalid_action';
  end if;

  select * into v_wallet from public.player_wallets where user_id=p_actor;
  v_result := jsonb_build_object('ok',true,'duplicate',false,
    'character',jsonb_build_object('id',v_character.id,'clientCharacterId',v_character.client_character_id,'revision',v_character.revision),
    'wallet',jsonb_build_object('balance',coalesce(v_wallet.salvage_alloy,0),'revision',coalesce(v_wallet.revision,1)),
    'mutation',jsonb_build_object('action',p_action,'value',coalesce(v_price,0),'itemId',v_item.id,'soldItem',v_sold_snapshot),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'legacyKey',legacy_key,'baseId',base_id,'slotPool',slot_pool,'location',location,'equipSlot',equip_slot,'revision',revision,'sockets',sockets,'provenance',provenance) order by created_at),'[]'::jsonb) from public.item_instances where character_id=v_character.id and location <> 'sold'),
    'materials',(select coalesce(jsonb_object_agg(material_id,quantity),'{}'::jsonb) from public.crafting_material_balances where character_id=v_character.id),
    'components',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'componentId',component_id,'rank',rank,'location',location,'itemInstanceId',item_instance_id,'socketIndex',socket_index,'revision',revision,'provenance',provenance) order by created_at),'[]'::jsonb) from public.component_instances where character_id=v_character.id));
  update public.economy_requests set response_payload=v_result, completed_at=now() where actor_user_id=p_actor and request_id=p_request_id;
  insert into public.economy_audit_events(actor_user_id,character_id,request_id,action,inputs,outputs)
  values(p_actor,v_character.id,p_request_id,p_action,p_payload,v_result);
  return v_result;
exception when others then
  raise;
end;
$$;

revoke all on function public.economy_mutate(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.economy_mutate(uuid,text,text,jsonb) to service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique,
  display_name text not null,
  username_set boolean not null default false,
  selected_hero text not null default 'scott',
  avatar_color text not null default '#f0e6c8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  check (length(handle) between 3 and 32),
  check (handle ~ '^[a-z0-9_]+$')
);

alter table if exists public.profiles
add column if not exists username_set boolean not null default false;

update public.profiles
set handle = 'player_' || substr(replace(id::text, '-', ''), 1, 12),
    display_name = 'player_' || substr(replace(id::text, '-', ''), 1, 12)
where username_set = false
  and (
    handle is distinct from 'player_' || substr(replace(id::text, '-', ''), 1, 12)
    or display_name is distinct from 'player_' || substr(replace(id::text, '-', ''), 1, 12)
  );

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row
execute function public.touch_updated_at();

create table if not exists public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games_played integer not null default 0 check (games_played >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  total_kills integer not null default 0 check (total_kills >= 0),
  best_day integer not null default 0 check (best_day >= 0),
  best_wave integer not null default 0 check (best_wave >= 0),
  buildings_built integer not null default 0 check (buildings_built >= 0),
  favorite_hero text,
  -- Server-owned progression (apply_match_result). Clients can only read.
  campaign_cleared integer not null default 0 check (campaign_cleared >= 0),
  best_survival integer not null default 0 check (best_survival >= 0),
  quests_done jsonb not null default '{}'::jsonb,
  relics jsonb not null default '[]'::jsonb,
  labyrinth_clears jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists player_stats_touch_updated_at on public.player_stats;
create trigger player_stats_touch_updated_at
before update on public.player_stats
for each row
execute function public.touch_updated_at();

create table if not exists public.save_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot_key text not null default 'latest',
  hero text,
  day integer not null default 1 check (day >= 1),
  summary jsonb not null default '{}'::jsonb,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slot_key),
  check (length(slot_key) between 1 and 48)
);

drop trigger if exists save_slots_touch_updated_at on public.save_slots;
create trigger save_slots_touch_updated_at
before update on public.save_slots
for each row
execute function public.touch_updated_at();

create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid,
  mode text not null default 'survival',
  rules text not null default 'survival-plots',
  hero text,
  result text not null default 'unknown',
  day_reached integer not null default 0 check (day_reached >= 0),
  kills integer not null default 0 check (kills >= 0),
  buildings_built integer not null default 0 check (buildings_built >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Survival Room',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'open' check (status in ('open', 'starting', 'in_game', 'finished')),
  rules text not null default 'survival-plots',
  max_players integer not null default 4 check (max_players between 1 and 4),
  difficulty text not null default 'normal',
  invite_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists rooms_status_visibility_idx
on public.rooms (status, visibility, updated_at desc);

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
before update on public.rooms
for each row
execute function public.touch_updated_at();

create table if not exists public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat integer not null check (seat between 1 and 4),
  display_name text not null,
  hero text not null default 'scott',
  ready boolean not null default false,
  connection_state text not null default 'online' check (connection_state in ('online', 'away', 'offline')),
  unlocked_level integer not null default 1 check (unlocked_level >= 1),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

alter table if exists public.room_players
add column if not exists unlocked_level integer not null default 1;

drop trigger if exists room_players_touch_updated_at on public.room_players;
create trigger room_players_touch_updated_at
before update on public.room_players
for each row
execute function public.touch_updated_at();

create table if not exists public.room_chat (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null default 'room' check (channel in ('room', 'game')),
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table if exists public.room_chat
add column if not exists channel text not null default 'room';

do $$
begin
  alter table public.room_chat
  add constraint room_chat_channel_check check (channel in ('room', 'game'));
exception
  when duplicate_object then null;
end;
$$;

create index if not exists room_chat_room_created_idx
on public.room_chat (room_id, created_at desc);

create index if not exists room_chat_room_channel_created_idx
on public.room_chat (room_id, channel, created_at desc);

create table if not exists public.lobby_chat (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global' check (scope in ('global')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists lobby_chat_scope_created_idx
on public.lobby_chat (scope, created_at desc);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_unique
on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);

create index if not exists friendships_requester_idx
on public.friendships (requester_id, status, updated_at desc);

create index if not exists friendships_addressee_idx
on public.friendships (addressee_id, status, updated_at desc);

drop trigger if exists friendships_touch_updated_at on public.friendships;
create trigger friendships_touch_updated_at
before update on public.friendships
for each row
execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.save_slots enable row level security;
alter table public.match_history enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_chat enable row level security;
alter table public.lobby_chat enable row level security;
alter table public.friendships enable row level security;

drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated
on public.profiles for select
to authenticated
using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists player_stats_read_authenticated on public.player_stats;
create policy player_stats_read_authenticated
on public.player_stats for select
to authenticated
using (true);



drop policy if exists save_slots_own_access on public.save_slots;
create policy save_slots_own_access
on public.save_slots for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists match_history_read_visible on public.match_history;
create policy match_history_read_visible
on public.match_history for select
to authenticated
using (auth.uid() = user_id or visibility = 'public');


drop policy if exists rooms_read_authenticated on public.rooms;
create policy rooms_read_authenticated
on public.rooms for select
to authenticated
using (true);

drop policy if exists rooms_insert_host on public.rooms;
create policy rooms_insert_host
on public.rooms for insert
to authenticated
with check (auth.uid() = host_user_id);

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host
on public.rooms for update
to authenticated
using (auth.uid() = host_user_id)
with check (auth.uid() = host_user_id);

drop policy if exists rooms_delete_host on public.rooms;
create policy rooms_delete_host
on public.rooms for delete
to authenticated
using (auth.uid() = host_user_id);

drop policy if exists room_players_read_authenticated on public.room_players;
create policy room_players_read_authenticated
on public.room_players for select
to authenticated
using (true);

drop policy if exists room_players_insert_self on public.room_players;
create policy room_players_insert_self
on public.room_players for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists room_players_update_self_or_host on public.room_players;
create policy room_players_update_self_or_host
on public.room_players for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.rooms
    where rooms.id = room_players.room_id
      and rooms.host_user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.rooms
    where rooms.id = room_players.room_id
      and rooms.host_user_id = auth.uid()
  )
);

drop policy if exists room_players_delete_self_or_host on public.room_players;
create policy room_players_delete_self_or_host
on public.room_players for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.rooms
    where rooms.id = room_players.room_id
      and rooms.host_user_id = auth.uid()
  )
);

drop policy if exists room_chat_read_authenticated on public.room_chat;
drop policy if exists room_chat_read_member on public.room_chat;
create policy room_chat_read_member
on public.room_chat for select
to authenticated
using (
  exists (
    select 1
    from public.room_players
    where room_players.room_id = room_chat.room_id
      and room_players.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.rooms
    where rooms.id = room_chat.room_id
      and rooms.host_user_id = auth.uid()
  )
);

drop policy if exists room_chat_insert_member on public.room_chat;
create policy room_chat_insert_member
on public.room_chat for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.room_players
    where room_players.room_id = room_chat.room_id
      and room_players.user_id = auth.uid()
  )
);

drop policy if exists lobby_chat_read_authenticated on public.lobby_chat;
create policy lobby_chat_read_authenticated
on public.lobby_chat for select
to authenticated
using (scope = 'global');

drop policy if exists lobby_chat_insert_self on public.lobby_chat;
create policy lobby_chat_insert_self
on public.lobby_chat for insert
to authenticated
with check (auth.uid() = user_id and scope = 'global');

drop policy if exists friendships_read_own on public.friendships;
create policy friendships_read_own
on public.friendships for select
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists friendships_insert_request on public.friendships;
create policy friendships_insert_request
on public.friendships for insert
to authenticated
with check (
  auth.uid() = requester_id
  and requester_id <> addressee_id
  and status = 'pending'
);

drop policy if exists friendships_update_own on public.friendships;
create policy friendships_update_own
on public.friendships for update
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id)
with check (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own
on public.friendships for delete
to authenticated
using (auth.uid() = requester_id or auth.uid() = addressee_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'lobby_chat'
    ) then
      alter publication supabase_realtime add table public.lobby_chat;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'room_chat'
    ) then
      alter publication supabase_realtime add table public.room_chat;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'friendships'
    ) then
      alter publication supabase_realtime add table public.friendships;
    end if;

    -- The lobby games feed and room rosters subscribe to postgres_changes on
    -- these two tables; without them in the publication no event ever fires
    -- and clients only see new games / joined players after a manual refresh.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'rooms'
    ) then
      alter publication supabase_realtime add table public.rooms;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'room_players'
    ) then
      alter publication supabase_realtime add table public.room_players;
    end if;
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
begin
  base_handle := 'player_' || substr(replace(new.id::text, '-', ''), 1, 12);

  insert into public.profiles (id, handle, display_name, username_set)
  values (
    new.id,
    base_handle,
    base_handle,
    false
  )
  on conflict (id) do nothing;

  insert into public.player_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_zillions on auth.users;
create trigger on_auth_user_created_zillions
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Server-authoritative match results. player_stats, match_history,
-- game_characters progress, item_instances and player_wallets are written only
-- by security-definer functions called with the service role from /api.
-- See supabase/migrations/20261027000100_server_authoritative_progress.sql.
-- Match report ledger ------------------------------------------------------
create table if not exists public.match_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (length(request_id) between 8 and 64),
  character_id uuid references public.game_characters(id) on delete set null,
  room_id uuid,
  mode text not null,
  level_id integer not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  report jsonb not null,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create unique index if not exists match_reports_one_per_room
  on public.match_reports(user_id, room_id) where room_id is not null;
create index if not exists match_reports_user_created_idx
  on public.match_reports(user_id, created_at desc);

alter table public.match_reports enable row level security;
drop policy if exists match_reports_read_self on public.match_reports;
create policy match_reports_read_self on public.match_reports
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.match_reports from anon, authenticated;

-- The only writer of progression -------------------------------------------
create or replace function public.apply_match_result(
  p_actor uuid,
  p_request_id text,
  p_client_character_id text,
  p_room_id uuid,
  p_expected_progress_revision bigint,
  p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_min_interval constant interval := interval '15 seconds';
  c_clock_slack constant integer := 120;
  c_stash_cap constant integer := 60;
  v_existing public.match_reports%rowtype;
  v_character public.game_characters%rowtype;
  v_stats public.player_stats%rowtype;
  v_wallet public.player_wallets%rowtype;
  v_last timestamptz;
  v_report jsonb := p_result->'report';
  v_duration integer := (p_result->'report'->>'durationSeconds')::integer;
  v_stash integer;
  v_item jsonb;
  v_granted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_quests jsonb := '{}'::jsonb;
  v_quest text;
  v_relic text;
  v_relics jsonb;
  v_alloy bigint := greatest(0, coalesce((p_result->>'alloy')::bigint, 0));
  v_won boolean := coalesce((v_report->>'won')::boolean, false);
  v_mode text := v_report->>'mode';
  v_response jsonb;
begin
  if p_actor is null or coalesce(p_request_id, '') = '' or v_report is null then
    raise exception 'invalid_match_result';
  end if;
  -- One account, one writer at a time: serialises duplicate submits, the rate
  -- limit, and the quest ledger.
  perform pg_advisory_xact_lock(hashtextextended('match_result:' || p_actor::text, 0));

  select * into v_existing from public.match_reports where user_id = p_actor and request_id = p_request_id;
  if found then
    return coalesce(v_existing.response_payload, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  if p_room_id is not null and exists (
    select 1 from public.match_reports where user_id = p_actor and room_id = p_room_id
  ) then
    raise exception 'duplicate_room_report';
  end if;

  select max(created_at) into v_last from public.match_reports where user_id = p_actor;
  if v_last is not null then
    if now() - v_last < c_min_interval then raise exception 'rate_limited'; end if;
    -- A match cannot have lasted longer than the time since the last one ended.
    -- Solo play runs at up to 2x, so sim seconds / 2 is the wall-clock floor.
    if (v_duration + 1) / 2 > extract(epoch from now() - v_last)::integer + c_clock_slack then
      raise exception 'implausible_duration';
    end if;
  end if;

  select * into v_character from public.game_characters
  where user_id = p_actor and client_character_id = p_client_character_id
  for update;
  if not found then raise exception 'character_not_found'; end if;
  if p_expected_progress_revision is not null and v_character.progress_revision <> p_expected_progress_revision then
    raise exception 'stale_progress';
  end if;

  insert into public.player_stats(user_id) values (p_actor) on conflict (user_id) do nothing;
  select * into v_stats from public.player_stats where user_id = p_actor for update;

  -- Quests are once per account; skip any another match already completed.
  for v_quest in select jsonb_array_elements_text(coalesce(p_result->'quests_completed', '[]'::jsonb)) loop
    if not (v_stats.quests_done ? v_quest) then
      v_quests := v_quests || jsonb_build_object(v_quest, true);
    end if;
  end loop;

  -- Items: authored (non-rolled) items are unique per character; rolled items
  -- stack up to the stash cap. Anything that does not fit is reported back.
  select count(*) into v_stash from public.item_instances
  where character_id = v_character.id and location = 'stash';
  for v_item in select * from jsonb_array_elements(coalesce(p_result->'items', '[]'::jsonb)) loop
    if v_item->>'quest_id' is not null and not (v_quests ? (v_item->>'quest_id')) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'quest_already_completed'));
      continue;
    end if;
    if position(':' in v_item->>'legacy_key') = 0 and exists (
      select 1 from public.item_instances
      where character_id = v_character.id and legacy_key = v_item->>'legacy_key' and location <> 'sold'
    ) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'already_owned'));
      continue;
    end if;
    if v_stash >= c_stash_cap then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'stash_full'));
      continue;
    end if;
    insert into public.item_instances(owner_user_id, character_id, legacy_key, base_id, slot_pool, item_level, rarity,
      affixes, sockets, binding, location, economy_data, provenance)
    values (p_actor, v_character.id, v_item->>'legacy_key', v_item->>'base_id', v_item->>'slot_pool',
      (v_item->>'item_level')::integer, (v_item->>'rarity')::integer, coalesce(v_item->'affixes', '[]'::jsonb),
      '[]'::jsonb, coalesce(v_item->>'binding', 'account'), 'stash', coalesce(v_item->'economy_data', '{}'::jsonb),
      coalesce(v_item->'provenance', '{}'::jsonb) || jsonb_build_object('granted_at', now()));
    v_stash := v_stash + 1;
    v_granted := v_granted || jsonb_build_array(v_item->>'legacy_key');
  end loop;

  v_relics := coalesce(v_stats.relics, '[]'::jsonb);
  for v_relic in select jsonb_array_elements_text(coalesce(p_result->'relics', '[]'::jsonb)) loop
    if not (v_relics ? v_relic) then v_relics := v_relics || jsonb_build_array(v_relic); end if;
  end loop;

  update public.game_characters set
    level = least(100, greatest(1, (p_result->>'level')::integer)),
    xp = greatest(0, (p_result->>'xp')::bigint),
    stats = jsonb_build_object(
      'instances', coalesce((stats->>'instances')::integer, 0) + 1,
      'victories', coalesce((stats->>'victories')::integer, 0) + case when v_won then 1 else 0 end,
      'kills', coalesce((stats->>'kills')::bigint, 0) + coalesce((v_report->>'kills')::bigint, 0)),
    progress_revision = progress_revision + 1,
    updated_at = now()
  where id = v_character.id
  returning * into v_character;

  insert into public.player_wallets(user_id) values (p_actor) on conflict (user_id) do nothing;
  update public.player_wallets set salvage_alloy = salvage_alloy + v_alloy,
    revision = revision + case when v_alloy > 0 then 1 else 0 end, updated_at = now()
  where user_id = p_actor returning * into v_wallet;

  update public.player_stats set
    games_played = games_played + 1,
    wins = wins + coalesce((p_result->'stats'->>'wins')::integer, 0),
    losses = losses + coalesce((p_result->'stats'->>'losses')::integer, 0),
    total_kills = total_kills + coalesce((p_result->'stats'->>'kills')::integer, 0),
    buildings_built = buildings_built + coalesce((p_result->'stats'->>'buildingsBuilt')::integer, 0),
    best_day = greatest(best_day, coalesce((p_result->'stats'->>'bestDay')::integer, 0)),
    best_wave = greatest(best_wave, coalesce((p_result->'stats'->>'bestWave')::integer, 0)),
    favorite_hero = coalesce(nullif(p_result->'stats'->>'favoriteHero', ''), favorite_hero),
    campaign_cleared = greatest(campaign_cleared, coalesce((p_result->'progress'->>'campaignCleared')::integer, 0)),
    best_survival = greatest(best_survival, coalesce((p_result->'progress'->>'bestSurvival')::integer, 0)),
    labyrinth_clears = case when p_result->'progress'->>'labyrinthClear' is not null
      then labyrinth_clears || jsonb_build_object(p_result->'progress'->>'labyrinthClear', true) else labyrinth_clears end,
    quests_done = quests_done || v_quests,
    relics = v_relics,
    updated_at = now()
  where user_id = p_actor
  returning * into v_stats;

  insert into public.match_history(user_id, room_id, mode, rules, hero, result, day_reached, kills,
    buildings_built, duration_seconds, visibility, summary)
  values (p_actor, p_room_id, v_mode, 'continuous-siege', v_report->>'hero',
    case when v_won then 'win' else 'loss' end,
    coalesce((v_report->>'threatLevel')::integer, 0), coalesce((v_report->>'kills')::integer, 0),
    coalesce((v_report->>'built')::integer, 0), coalesce(v_duration, 0), 'private',
    jsonb_build_object('levelId', v_report->'levelId', 'difficulty', v_report->'difficulty',
      'xp', p_result->'xp_gained', 'alloy', v_alloy, 'items', v_granted, 'request_id', p_request_id));

  v_response := jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'character', jsonb_build_object('clientCharacterId', v_character.client_character_id,
      'level', v_character.level, 'xp', v_character.xp, 'stats', v_character.stats,
      'progressRevision', v_character.progress_revision),
    'xpGained', coalesce((p_result->>'xp_gained')::integer, 0),
    'levelsGained', coalesce(p_result->'levels_gained', '[]'::jsonb),
    'grantedItems', v_granted,
    'skippedItems', v_skipped,
    'relicsGranted', coalesce(p_result->'relics', '[]'::jsonb),
    'questsCompleted', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_quests) k),
    'alloyGained', v_alloy,
    'wallet', jsonb_build_object('balance', v_wallet.salvage_alloy),
    'stats', jsonb_build_object('gamesPlayed', v_stats.games_played, 'wins', v_stats.wins,
      'losses', v_stats.losses, 'kills', v_stats.total_kills, 'bestDay', v_stats.best_day,
      'bestWave', v_stats.best_wave, 'campaignCleared', v_stats.campaign_cleared,
      'bestSurvival', v_stats.best_survival, 'questsDone', v_stats.quests_done,
      'relics', v_stats.relics, 'labyrinthClears', v_stats.labyrinth_clears));

  insert into public.match_reports(user_id, request_id, character_id, room_id, mode, level_id,
    duration_seconds, report, response_payload)
  values (p_actor, p_request_id, v_character.id, p_room_id, v_mode,
    coalesce((v_report->>'levelId')::integer, 0), coalesce(v_duration, 0), v_report, v_response);

  return v_response;
end;
$$;

revoke all on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb) to service_role;

-- Revoke client writes -----------------------------------------------------
drop policy if exists player_stats_insert_self on public.player_stats;
drop policy if exists player_stats_update_self on public.player_stats;
drop policy if exists match_history_insert_self on public.match_history;
revoke insert, update, delete on public.player_stats from anon, authenticated;
revoke insert, update, delete on public.match_history from anon, authenticated;
-- game_characters, item_instances and player_wallets were already read-only
-- for clients (economy_mutate is the writer); restate it here.
revoke insert, update, delete on public.game_characters from anon, authenticated;
revoke insert, update, delete on public.item_instances from anon, authenticated;
revoke insert, update, delete on public.player_wallets from anon, authenticated;
