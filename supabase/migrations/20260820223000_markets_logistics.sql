-- Region-fenced, replay-safe markets, caravans, raids, and army logistics.
begin;

alter table public.world_markets add column target_stock numeric(16,3) not null default 100 check(target_stock>0), add column last_price_tick bigint not null default 0 check(last_price_tick>=0);
create table public.world_caravan_plans(id uuid primary key default gen_random_uuid(),party_id uuid not null unique references public.world_parties(id) on delete cascade,origin_location_id uuid not null references public.world_locations(id) on delete restrict,destination_location_id uuid not null references public.world_locations(id) on delete restrict,commodity_key text not null,target_quantity numeric(16,3) not null check(target_quantity>0),state text not null default 'buying' check(state in('buying','outbound','selling','returning','suspended')),revision bigint not null default 1,check(origin_location_id<>destination_location_id));
create table public.world_raid_orders(id uuid primary key default gen_random_uuid(),request_id text not null check(length(request_id) between 1 and 96),region_id uuid not null references public.world_provinces(id) on delete cascade,attacker_party_id uuid not null references public.world_parties(id) on delete cascade,target_party_id uuid not null references public.world_parties(id) on delete cascade,resolve_tick bigint not null check(resolve_tick>=0),state text not null default 'pending' check(state in('pending','resolved','cancelled')),result jsonb not null default '{}',resolved_at timestamptz,unique(attacker_party_id,request_id),check(attacker_party_id<>target_party_id));
create unique index world_raid_one_pending_per_attacker on public.world_raid_orders(attacker_party_id) where state='pending';
create table public.world_logistics_ticks(region_id uuid not null references public.world_provinces(id) on delete cascade,world_tick bigint not null check(world_tick>=0),worker_id text not null,lease_epoch bigint not null check(lease_epoch>0),result jsonb not null default '{}',processed_at timestamptz not null default now(),primary key(region_id,world_tick));
do $$ declare t text; begin foreach t in array array['world_caravan_plans','world_raid_orders','world_logistics_ticks'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy world_caravan_plans_visible on public.world_caravan_plans for select to authenticated using(exists(select 1 from public.world_parties p where p.id=party_id and (p.owner_user_id=auth.uid() or p.kind='caravan')));
create policy world_raid_orders_participant_read on public.world_raid_orders for select to authenticated using(exists(select 1 from public.world_parties p where p.id in(attacker_party_id,target_party_id) and p.owner_user_id=auth.uid()));

create or replace function public.create_world_raid(p_actor uuid,p_request_id text,p_attacker uuid,p_target uuid,p_expected_revision bigint,p_resolve_tick bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.world_parties%rowtype; t public.world_parties%rowtype; old public.world_raid_orders%rowtype; r public.world_raid_orders%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_resolve_tick<0 then raise exception 'invalid_raid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-raid:'||p_attacker::text,0));
  select * into old from public.world_raid_orders where attacker_party_id=p_attacker and request_id=p_request_id;
  if found then if old.target_party_id<>p_target or old.resolve_tick<>p_resolve_tick then raise exception 'idempotency_conflict'; end if; return jsonb_build_object('ok',true,'duplicate',true,'raidId',old.id,'state',old.state); end if;
  select * into a from public.world_parties where id=p_attacker for update;
  if not found or a.owner_user_id is distinct from p_actor then raise exception 'unauthorized_raid'; end if;
  select * into t from public.world_parties where id=p_target for update;
  if not found then raise exception 'raid_target_not_found'; end if;
  if a.revision<>p_expected_revision then raise exception 'stale_party'; end if;
  if a.region_id<>t.region_id or a.route_id is null or a.route_id is distinct from t.route_id then raise exception 'raid_target_not_reachable'; end if;
  if t.kind<>'caravan' then raise exception 'raid_target_not_caravan'; end if;
  insert into public.world_raid_orders(request_id,region_id,attacker_party_id,target_party_id,resolve_tick) values(p_request_id,a.region_id,a.id,t.id,p_resolve_tick) returning * into r;
  update public.world_parties set stance='hostile',revision=revision+1,updated_at=now() where id=a.id;
  return jsonb_build_object('ok',true,'duplicate',false,'raidId',r.id,'state',r.state,'partyRevision',a.revision+1);
end $$;

create or replace function public.process_world_region_logistics(p_region uuid,p_world_tick bigint,p_worker text,p_lease_epoch bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.world_region_worker_leases%rowtype; prior public.world_logistics_ticks%rowtype; raid public.world_raid_orders%rowtype; caravan public.world_caravan_plans%rowtype; route public.world_routes%rowtype; attacker numeric; defender numeric; cargo_total numeric; ratio numeric; roll numeric; won boolean; stolen numeric; available numeric; moved numeric; stolen_commodity text; processed integer:=0; caravans_processed integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_world_tick<0 or p_worker is null or length(p_worker) not between 1 and 96 or p_lease_epoch<1 then raise exception 'invalid_logistics_tick'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-region:'||p_region::text,0));
  select * into l from public.world_region_worker_leases where region_id=p_region for update;
  if not found or l.worker_id<>p_worker or l.lease_epoch<>p_lease_epoch or l.lease_until<=now() then raise exception 'region_lease_required'; end if;
  select * into prior from public.world_logistics_ticks where region_id=p_region and world_tick=p_world_tick;
  if found then return prior.result||jsonb_build_object('duplicate',true); end if;
  if not exists(select 1 from public.world_region_states where region_id=p_region and simulation_tick>=p_world_tick) then raise exception 'future_logistics_tick'; end if;
  update public.world_supplies s set quantity=greatest(0,s.quantity-case s.supply_key when 'food' then (coalesce(a.combat_power,0)/1000.0)*(case when p.route_id is null then 1 else 1.5 end) when 'medicine' then coalesce((select sum(u.wounded) from public.world_unit_stacks u where u.army_id=a.id),0)*0.002 when 'parts' then case when p.route_id is null then 0 else coalesce(a.combat_power,0)/5000.0 end else 0 end),revision=s.revision+1 from public.world_parties p left join public.world_armies a on a.party_id=p.id where p.id=s.party_id and p.region_id=p_region and s.supply_key in('food','medicine','parts');
  -- A company that cannot meet wages loses morale. Empty food stores add
  -- fatigue and a stronger morale penalty. These consequences make large
  -- armies powerful but expensive to keep in the field.
  with due as(select c.party_id,c.treasury,coalesce(sum(cm.wage),0)::bigint wages from public.world_companies c left join public.world_company_members cm on cm.party_id=c.party_id and cm.status<>'dismissed' join public.world_parties p on p.id=c.party_id where p.region_id=p_region group by c.party_id,c.treasury), paid as(update public.world_companies c set treasury=c.treasury-least(c.treasury,d.wages),revision=c.revision+1,updated_at=now() from due d where c.party_id=d.party_id and d.wages>0 returning c.party_id,(d.wages<=d.treasury) fully_paid) update public.world_parties p set morale=greatest(0,p.morale-case when paid.fully_paid then 0 else 8 end),revision=p.revision+1,updated_at=now() from paid where p.id=paid.party_id;
  update public.world_parties p set morale=greatest(0,p.morale-12),fatigue=least(100,p.fatigue+10),revision=p.revision+1,updated_at=now() where p.region_id=p_region and exists(select 1 from public.world_supplies s where s.party_id=p.id and s.supply_key='food' and s.quantity<=0);

  -- Blockaded settlements price against a smaller effective stock target,
  -- causing visible scarcity without manufacturing or deleting goods.
  update public.world_markets m set buy_price=ceil(greatest(1,m.base_price*(1+greatest(-.5,least(1,((m.target_stock*(case when coalesce((loc.siege_state->>'blockaded')::boolean,false) then 1.5 else 1 end))-m.stock)/m.target_stock))*.5))*1.1),sell_price=floor(greatest(1,m.base_price*(1+greatest(-.5,least(1,((m.target_stock*(case when coalesce((loc.siege_state->>'blockaded')::boolean,false) then 1.5 else 1 end))-m.stock)/m.target_stock))*.5))*.85),last_price_tick=p_world_tick,revision=m.revision+1 from public.world_locations loc where loc.id=m.location_id and loc.province_id=p_region and m.last_price_tick<p_world_tick;

  -- Caravans move actual market stock into cargo, travel over real routes,
  -- and deliver the same commodity at the destination. Movement completion is
  -- handled by the region movement worker; this tick only advances plans when
  -- their party is physically at the required endpoint.
  for caravan in select cp.* from public.world_caravan_plans cp join public.world_parties p on p.id=cp.party_id where p.region_id=p_region and cp.state<>'suspended' order by cp.id for update loop
    if caravan.state='buying' and exists(select 1 from public.world_parties p where p.id=caravan.party_id and p.location_id=caravan.origin_location_id and p.route_id is null) then
      select greatest(0,least(caravan.target_quantity,m.stock)) into moved from public.world_markets m where m.location_id=caravan.origin_location_id and m.commodity_key=caravan.commodity_key for update;
      if coalesce(moved,0)>0 then
        update public.world_markets set stock=stock-moved,revision=revision+1 where location_id=caravan.origin_location_id and commodity_key=caravan.commodity_key;
        insert into public.world_cargo(party_id,commodity_key,quantity) values(caravan.party_id,caravan.commodity_key,moved) on conflict(party_id,commodity_key) do update set quantity=world_cargo.quantity+excluded.quantity,revision=world_cargo.revision+1;
        select * into route from public.world_routes where origin_region_id=p_region and origin_id=caravan.origin_location_id and destination_id=caravan.destination_location_id order by id limit 1 for update;
        if found and not coalesce((route.blockade_state->>'closed')::boolean,false) then update public.world_parties set location_id=null,route_id=route.id,route_progress=0,revision=revision+1,updated_at=now() where id=caravan.party_id; update public.world_caravan_plans set state='outbound',revision=revision+1 where id=caravan.id; caravans_processed:=caravans_processed+1; end if;
      end if;
    elsif caravan.state='outbound' and exists(select 1 from public.world_parties p where p.id=caravan.party_id and p.location_id=caravan.destination_location_id and p.route_id is null) then
      select greatest(0,quantity-reserved_quantity) into moved from public.world_cargo where party_id=caravan.party_id and commodity_key=caravan.commodity_key for update;
      if coalesce(moved,0)>0 then update public.world_cargo set quantity=quantity-moved,revision=revision+1 where party_id=caravan.party_id and commodity_key=caravan.commodity_key; update public.world_markets set stock=stock+moved,revision=revision+1 where location_id=caravan.destination_location_id and commodity_key=caravan.commodity_key; end if;
      update public.world_caravan_plans set state='returning',revision=revision+1 where id=caravan.id; caravans_processed:=caravans_processed+1;
    elsif caravan.state='returning' and exists(select 1 from public.world_parties p where p.id=caravan.party_id and p.location_id=caravan.origin_location_id and p.route_id is null) then update public.world_caravan_plans set state='buying',revision=revision+1 where id=caravan.id; caravans_processed:=caravans_processed+1;
    end if;
  end loop;
  for raid in select * from public.world_raid_orders where region_id=p_region and state='pending' and resolve_tick<=p_world_tick order by resolve_tick,id for update loop
    select coalesce(combat_power,0) into attacker from public.world_armies where party_id=raid.attacker_party_id; select coalesce(combat_power,0) into defender from public.world_armies where party_id=raid.target_party_id; select coalesce(sum(quantity-reserved_quantity),0) into cargo_total from public.world_cargo where party_id=raid.target_party_id;
    ratio:=attacker/greatest(1,attacker+defender); roll:=((hashtextextended(raid.id::text||':'||p_world_tick::text,0)%2001)-1000)/10000.0; won:=greatest(0,least(1,ratio+roll))>=.5; stolen:=case when won then floor(cargo_total*greatest(.2,least(.7,.2+ratio*.5))) else 0 end;
    if stolen>0 then select commodity_key,quantity-reserved_quantity into stolen_commodity,available from public.world_cargo where party_id=raid.target_party_id and quantity>reserved_quantity order by quantity-reserved_quantity desc,commodity_key limit 1 for update; stolen:=least(stolen,coalesce(available,0)); if stolen>0 then update public.world_cargo set quantity=quantity-stolen,revision=revision+1 where party_id=raid.target_party_id and commodity_key=stolen_commodity; insert into public.world_cargo(party_id,commodity_key,quantity) values(raid.attacker_party_id,stolen_commodity,stolen) on conflict(party_id,commodity_key) do update set quantity=world_cargo.quantity+excluded.quantity,revision=world_cargo.revision+1; end if; end if;
    update public.world_raid_orders set state='resolved',result=jsonb_build_object('success',won,'stolen',stolen,'tick',p_world_tick),resolved_at=now() where id=raid.id; processed:=processed+1;
  end loop;
  insert into public.world_logistics_ticks(region_id,world_tick,worker_id,lease_epoch,result) values(p_region,p_world_tick,p_worker,p_lease_epoch,jsonb_build_object('ok',true,'duplicate',false,'tick',p_world_tick,'raidsResolved',processed,'caravansProcessed',caravans_processed));
  return jsonb_build_object('ok',true,'duplicate',false,'tick',p_world_tick,'raidsResolved',processed,'caravansProcessed',caravans_processed);
end $$;
revoke all on function public.create_world_raid(uuid,text,uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.process_world_region_logistics(uuid,bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.create_world_raid(uuid,text,uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.process_world_region_logistics(uuid,bigint,text,bigint) to service_role;
insert into public.world_routes(province_id,origin_id,destination_id,distance,terrain,danger,origin_region_id,destination_region_id,owner_faction_id,control_state)
select '10000000-0000-4000-8000-000000000002',destination_id,origin_id,distance,terrain,danger,destination_region_id,origin_region_id,owner_faction_id,control_state
from public.world_routes where id='12000000-0000-4000-8000-000000000001'
on conflict(province_id,origin_id,destination_id) do nothing;
insert into public.world_caravan_plans(party_id,origin_location_id,destination_location_id,commodity_key,target_quantity) select p.id,'11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','iron',20 from public.world_parties p where p.id='13000000-0000-4000-8000-000000000002' on conflict(party_id) do nothing;
commit;
