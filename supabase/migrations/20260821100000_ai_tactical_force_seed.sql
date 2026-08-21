-- Forward-only bridge from strategic AI armies to tactical battle stacks.
begin;

create function public.seed_ai_world_force()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.world_parties%rowtype;
begin
  select * into p from public.world_parties where id=new.party_id;
  if not found or p.owner_user_id is not null or new.commander_user_id is not null
    or p.kind not in('ai','caravan','patrol','garrison') or new.combat_power<=0 then return new; end if;
  insert into public.world_unit_stacks(army_id,unit_key,tier,healthy)
    values(new.id,coalesce(nullif(p.strategic_role,''),nullif(p.kind,''),'militia'),1,least(1000000::numeric,ceil(new.combat_power))::integer)
  on conflict(army_id,unit_key,tier) do nothing;
  return new;
end $$;
create trigger seed_ai_world_force after insert on public.world_armies
for each row execute function public.seed_ai_world_force();
revoke all on function public.seed_ai_world_force() from public,anon,authenticated;

insert into public.world_unit_stacks(army_id,unit_key,tier,healthy)
select a.id,coalesce(nullif(p.strategic_role,''),nullif(p.kind,''),'militia'),1,least(1000000::numeric,ceil(a.combat_power))::integer
from public.world_armies a join public.world_parties p on p.id=a.party_id
where p.owner_user_id is null and a.commander_user_id is null
  and p.kind in('ai','caravan','patrol','garrison') and a.combat_power>0
  and not exists(select 1 from public.world_unit_stacks s where s.army_id=a.id)
on conflict(army_id,unit_key,tier) do nothing;

commit;
