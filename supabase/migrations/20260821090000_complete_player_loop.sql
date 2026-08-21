-- Complete the server-owned seams needed by the persistent player loop.
begin;

-- Group travel historically wrote queued orders, but no active region runtime
-- consumed that state. Activate the order and party in the same transaction.
create function public.activate_group_movement_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.world_parties%rowtype; r public.world_routes%rowtype;
begin
  if new.status<>'queued' or new.issued_by is null then return new; end if;
  select * into p from public.world_parties where id=new.party_id for update;
  select * into r from public.world_routes where id=new.route_id;
  if p.location_id is distinct from r.origin_id or p.route_id is not null then raise exception 'route_not_reachable'; end if;
  new.status:='moving';
  update public.world_parties set location_id=null,route_id=r.id,route_progress=0,revision=revision+1,updated_at=now() where id=p.id;
  return new;
end $$;
create trigger activate_group_movement_order before insert on public.world_movement_orders
for each row execute function public.activate_group_movement_order();
revoke all on function public.activate_group_movement_order() from public,anon,authenticated;

-- Give an ownerless opponent a deterministic decision at contact creation. The
-- human decision then resolves immediately and the existing engagement trigger
-- opens exactly one tactical assignment.
create function public.seed_ai_encounter_decision()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare ai public.world_parties%rowtype; ai_choice text;
begin
  select * into ai from public.world_parties where id=new.attacker_party_id and owner_user_id is null;
  if not found then select * into ai from public.world_parties where id=new.defender_party_id and owner_user_id is null; end if;
  if not found then return new; end if;
  ai_choice:='fight';
  insert into public.world_encounter_decisions(encounter_id,party_id,request_id,encounter_revision,choice,snapshot)
    values(new.id,ai.id,'ai:'||new.id::text,new.revision,ai_choice,
      jsonb_build_object('authority','deterministic-ai','tick',new.created_tick));
  if ai.id=new.attacker_party_id then update public.world_encounters set attacker_choice=ai_choice,revision=revision+1 where id=new.id;
  else update public.world_encounters set defender_choice=ai_choice,revision=revision+1 where id=new.id; end if;
  return new;
end $$;
create trigger seed_ai_encounter_decision after insert on public.world_encounters
for each row execute function public.seed_ai_encounter_decision();
revoke all on function public.seed_ai_encounter_decision() from public,anon,authenticated;

-- Seed domain offers for immutable-manifest settlements, both when this
-- migration sees an existing Earth and when a later dormant activation inserts it.
create function public.seed_world_location_player_services()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.world_provinces where id=new.province_id and planet_id='earth') then return new; end if;
  if new.kind not in('town','fort','port') then return new; end if;
  if coalesce((new.services->>'recruit')::boolean,false) then
    insert into public.world_recruitment_offers(location_id,recruit_key,name,role,tier,price,wage,available)
      values(new.id,'local_militia','Local Militia','infantry',1,60,2,20) on conflict do nothing;
  end if;
  insert into public.world_town_services(location_id,service_key,price)
    values(new.id,'rest',15),(new.id,'heal_company',35),(new.id,'repair_equipment',25) on conflict do nothing;
  insert into public.world_supply_offers(location_id,supply_key,unit_price,stock)
    values(new.id,'food',2,500),(new.id,'ammunition',4,300),(new.id,'medicine',8,100),(new.id,'parts',6,150) on conflict do nothing;
  return new;
end $$;
create trigger seed_world_location_player_services after insert or update of services,kind on public.world_locations
for each row execute function public.seed_world_location_player_services();
revoke all on function public.seed_world_location_player_services() from public,anon,authenticated;
insert into public.world_recruitment_offers(location_id,recruit_key,name,role,tier,price,wage,available)
select l.id,'local_militia','Local Militia','infantry',1,60,2,20 from public.world_locations l join public.world_provinces p on p.id=l.province_id
where p.planet_id='earth' and l.kind in('town','fort','port') and coalesce((l.services->>'recruit')::boolean,false) on conflict do nothing;
insert into public.world_town_services(location_id,service_key,price)
select l.id,s.key,s.price from public.world_locations l join public.world_provinces p on p.id=l.province_id cross join(values('rest',15),('heal_company',35),('repair_equipment',25))s(key,price)
where p.planet_id='earth' and l.kind in('town','fort','port') on conflict do nothing;
insert into public.world_supply_offers(location_id,supply_key,unit_price,stock)
select l.id,s.key,s.price,s.stock from public.world_locations l join public.world_provinces p on p.id=l.province_id cross join(values('food',2,500::numeric),('ammunition',4,300::numeric),('medicine',8,100::numeric),('parts',6,150::numeric))s(key,price,stock)
where p.planet_id='earth' and l.kind in('town','fort','port') on conflict do nothing;

-- Recruitment becomes battle authority immediately; one company member is one
-- healthy strategic unit. Battle-force guards reject recruitment while issued.
create function public.sync_recruit_to_world_force()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a uuid;
begin
  select id into a from public.world_armies where party_id=new.party_id for update;
  if a is null then raise exception 'company_army_missing'; end if;
  insert into public.world_unit_stacks(army_id,unit_key,tier,healthy)
    values(a,new.recruit_key,new.tier,1)
  on conflict(army_id,unit_key,tier) do update set healthy=public.world_unit_stacks.healthy+1,revision=public.world_unit_stacks.revision+1;
  update public.world_armies set combat_power=(select coalesce(sum(healthy*tier),0) from public.world_unit_stacks where army_id=a),revision=revision+1 where id=a;
  return new;
end $$;
create trigger sync_recruit_to_world_force after insert on public.world_company_members
for each row execute function public.sync_recruit_to_world_force();
revoke all on function public.sync_recruit_to_world_force() from public,anon,authenticated;

create table public.world_trade_requests(
  actor_user_id uuid not null references auth.users(id) on delete cascade,request_id text not null,
  party_id uuid not null references public.world_parties(id),expected_revision bigint not null,payload jsonb not null,response jsonb not null,
  created_at timestamptz not null default now(),primary key(actor_user_id,request_id)
);
alter table public.world_trade_requests enable row level security;
create policy world_trade_request_actor_read on public.world_trade_requests for select to authenticated using(actor_user_id=auth.uid());
create function public.living_world_trade_market(p_actor uuid,p_request_id text,p_party uuid,p_expected_revision bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.world_trade_requests%rowtype;p public.world_parties%rowtype;m public.world_markets%rowtype;w public.player_wallets%rowtype;q numeric;cost bigint;side text;result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-trade:'||p_actor::text||':'||p_request_id,0));
  select * into old from public.world_trade_requests where actor_user_id=p_actor and request_id=p_request_id;
  if found then if old.party_id<>p_party or old.expected_revision<>p_expected_revision or old.payload<>p_payload then raise exception 'idempotency_conflict';end if;return old.response||jsonb_build_object('duplicate',true);end if;
  select * into p from public.world_parties where id=p_party for update;
  if not found or p.owner_user_id is distinct from p_actor then raise exception 'unauthorized_ownership';end if;
  if p.revision<>p_expected_revision then raise exception 'stale_revision';end if;
  if p.location_id is null or p.location_id is distinct from (p_payload->>'locationId')::uuid then raise exception 'party_not_at_market';end if;
  q:=(p_payload->>'quantity')::numeric;side:=p_payload->>'side';if q<=0 or trunc(q)<>q or side not in('buy','sell') then raise exception 'invalid_trade';end if;
  select * into m from public.world_markets where location_id=p.location_id and commodity_key=p_payload->>'commodityKey' for update;if not found then raise exception 'market_offer_not_found';end if;
  insert into public.player_wallets(user_id) values(p_actor) on conflict do nothing;select * into w from public.player_wallets where user_id=p_actor for update;
  cost:=(case when side='buy' then m.buy_price else m.sell_price end*q)::bigint;
  if side='buy' then
    if m.stock<q or w.salvage_alloy<cost then raise exception 'trade_unavailable';end if;
    update public.world_markets set stock=stock-q,revision=revision+1 where location_id=m.location_id and commodity_key=m.commodity_key;
    insert into public.world_cargo(party_id,commodity_key,quantity) values(p.id,m.commodity_key,q) on conflict(party_id,commodity_key) do update set quantity=world_cargo.quantity+excluded.quantity,revision=world_cargo.revision+1;
    update public.player_wallets set salvage_alloy=salvage_alloy-cost,revision=revision+1,updated_at=now() where user_id=p_actor returning * into w;
  else
    update public.world_cargo set quantity=quantity-q,revision=revision+1 where party_id=p.id and commodity_key=m.commodity_key and quantity-reserved_quantity>=q;if not found then raise exception 'insufficient_cargo';end if;
    update public.world_markets set stock=stock+q,revision=revision+1 where location_id=m.location_id and commodity_key=m.commodity_key;
    update public.player_wallets set salvage_alloy=salvage_alloy+cost,revision=revision+1,updated_at=now() where user_id=p_actor returning * into w;
  end if;
  update public.world_parties set revision=revision+1,updated_at=now() where id=p.id returning * into p;
  result:=jsonb_build_object('ok',true,'duplicate',false,'side',side,'quantity',q,'cost',cost,'balance',w.salvage_alloy,'partyRevision',p.revision);
  insert into public.world_trade_requests values(p_actor,p_request_id,p.id,p_expected_revision,p_payload,result,now());return result;
end $$;
revoke all on function public.living_world_trade_market(uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.living_world_trade_market(uuid,text,uuid,bigint,jsonb) to service_role;

-- Mirror verified aggregate battle consequences into the player-company roster.
create function public.apply_company_battle_consequences()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.world_encounters%rowtype;r jsonb;pid uuid;killed integer;wounded integer;captured integer;captor uuid;m uuid;
begin
  select n.* into e from public.world_engagements g join public.world_encounters n on n.id=g.encounter_id where g.id=new.engagement_id;
  for pid in select unnest(array[e.attacker_party_id,e.defender_party_id]) loop
    select coalesce(sum((casualty.value->>'killed')::integer),0),coalesce(sum((casualty.value->>'wounded')::integer),0) into killed,wounded
      from jsonb_array_elements(new.casualties) casualty(value) join public.world_unit_stacks s on s.id=(casualty.value->>'stackId')::uuid join public.world_armies a on a.id=s.army_id where a.party_id=pid;
    for m in select id from public.world_company_members where party_id=pid and status='active' order by id limit killed loop update public.world_company_members set status='dead',health=0 where id=m;end loop;
    for m in select id from public.world_company_members where party_id=pid and status='active' order by id limit wounded loop update public.world_company_members set status='wounded',health=greatest(1,health/2) where id=m;end loop;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(new.prisoners,'[]'::jsonb)) loop
    pid:=(r->>'sourcePartyId')::uuid;captor:=(r->>'captorPartyId')::uuid;captured:=(r->>'quantity')::integer;
    for m in select id from public.world_company_members where party_id=pid and recruit_key=r->>'unitKey' and status='active' order by id limit captured loop update public.world_company_members set status='captured',captor_party_id=captor,health=greatest(1,health) where id=m;end loop;
  end loop;
  update public.world_armies a set combat_power=(select coalesce(sum(s.healthy*s.tier),0) from public.world_unit_stacks s where s.army_id=a.id),revision=a.revision+1
    where a.party_id in(e.attacker_party_id,e.defender_party_id);
  return new;
end $$;
create trigger apply_company_battle_consequences after insert on public.world_battle_results
for each row execute function public.apply_company_battle_consequences();
revoke all on function public.apply_company_battle_consequences() from public,anon,authenticated;

commit;
