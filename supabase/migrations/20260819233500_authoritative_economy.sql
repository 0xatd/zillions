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
