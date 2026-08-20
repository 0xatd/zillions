-- Initial authoritative Earth province, durable social parties, and tutorial exit.
-- Static identifiers make the bootstrap safe to replay in preview and production.
begin;

create table public.social_parties (
  id uuid primary key default gen_random_uuid(),
  shard_id text not null references public.world_shards(id) on delete cascade,
  leader_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 48),
  status text not null default 'active' check (status in ('active','disbanded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,
  unique (id, shard_id)
);

create table public.social_party_members (
  party_id uuid not null references public.social_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','officer','member')),
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id),
  unique (user_id)
);

create table public.social_party_invites (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.social_parties(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (invited_by <> invited_user_id)
);
create unique index social_party_one_pending_invite
  on public.social_party_invites(party_id, invited_user_id) where status = 'pending';

create table public.social_party_requests (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check(length(request_id) between 1 and 96),
  action text not null,
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_user_id,request_id)
);

create table public.world_tutorial_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  character_id uuid not null unique references public.game_characters(id) on delete cascade,
  movement_complete boolean not null default false,
  town_complete boolean not null default false,
  recruitment_complete boolean not null default false,
  trade_complete boolean not null default false,
  battle_complete boolean not null default false,
  completed_at timestamptz,
  entered_world_at timestamptz,
  world_party_id uuid unique references public.world_parties(id) on delete set null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.social_parties enable row level security;
alter table public.social_party_members enable row level security;
alter table public.social_party_invites enable row level security;
alter table public.social_party_requests enable row level security;
alter table public.world_tutorial_progress enable row level security;

create or replace function public.is_social_party_member(p_party uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.social_party_members where party_id=p_party and user_id=p_user) $$;
revoke all on function public.is_social_party_member(uuid,uuid) from public,anon;
grant execute on function public.is_social_party_member(uuid,uuid) to authenticated,service_role;

create policy social_parties_member_read on public.social_parties for select to authenticated
  using (public.is_social_party_member(id,auth.uid()));
create policy social_party_members_member_read on public.social_party_members for select to authenticated
  using (public.is_social_party_member(party_id,auth.uid()));
create policy social_party_invites_participant_read on public.social_party_invites for select to authenticated
  using (invited_user_id=auth.uid() or invited_by=auth.uid() or public.is_social_party_member(party_id,auth.uid()));
create policy social_party_requests_self_read on public.social_party_requests for select to authenticated using(actor_user_id=auth.uid());
create policy world_tutorial_progress_self_read on public.world_tutorial_progress for select to authenticated
  using (user_id=auth.uid());

-- Server systems record tutorial evidence. This RPC is deliberately not exposed
-- to authenticated clients; the economy/combat/world services call it only after
-- the corresponding authoritative action succeeds.
create or replace function public.record_world_tutorial_step(p_actor uuid,p_character uuid,p_step text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_character public.game_characters%rowtype; v_progress public.world_tutorial_progress%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_step not in ('movement','town','recruitment','trade','battle') then raise exception 'invalid_tutorial_step'; end if;
  select * into v_character from public.game_characters where id=p_character and user_id=p_actor for update;
  if not found then raise exception 'character_not_found'; end if;
  insert into public.world_tutorial_progress(user_id,character_id) values(p_actor,p_character)
    on conflict(user_id) do nothing;
  execute format('update public.world_tutorial_progress set %I=true, revision=revision+1, updated_at=now() where user_id=$1',p_step||'_complete') using p_actor;
  update public.world_tutorial_progress set completed_at=coalesce(completed_at,now()),revision=revision+1,updated_at=now()
    where user_id=p_actor and movement_complete and town_complete and recruitment_complete and trade_complete and battle_complete and completed_at is null;
  select * into v_progress from public.world_tutorial_progress where user_id=p_actor;
  return jsonb_build_object('ok',true,'complete',v_progress.completed_at is not null,'revision',v_progress.revision);
end $$;
revoke all on function public.record_world_tutorial_step(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_world_tutorial_step(uuid,uuid,text) to service_role;

-- Durable invitation mutations. The API derives p_actor from authentication.
-- The request table binds retries to the same action and payload.
create or replace function public.social_party_command(p_actor uuid,p_request_id text,p_action text,p_party uuid,p_target uuid,p_invite uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.social_party_requests%rowtype; v_party public.social_parties%rowtype;
  v_invite public.social_party_invites%rowtype; v_payload jsonb; v_result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_action not in ('invite','accept','decline','revoke') then raise exception 'invalid_request'; end if;
  v_payload:=jsonb_build_object('partyId',p_party,'targetId',p_target,'inviteId',p_invite);
  perform pg_advisory_xact_lock(hashtextextended('social-party-command:'||p_actor::text||':'||p_request_id,0));
  select * into v_existing from public.social_party_requests where actor_user_id=p_actor and request_id=p_request_id;
  if found then
    if v_existing.action<>p_action or v_existing.payload<>v_payload then raise exception 'idempotency_conflict'; end if;
    return v_existing.response||jsonb_build_object('duplicate',true);
  end if;
  select * into v_party from public.social_parties where id=p_party and status='active' for update;
  if not found then raise exception 'party_not_found'; end if;
  if p_action='invite' then
    if not exists(select 1 from public.social_party_members where party_id=p_party and user_id=p_actor and role in('leader','officer')) then raise exception 'not_party_officer'; end if;
    if p_target is null or p_target=p_actor or exists(select 1 from public.social_party_members where party_id=p_party and user_id=p_target) then raise exception 'invalid_invitee'; end if;
    select * into v_invite from public.social_party_invites where party_id=p_party and invited_user_id=p_target and status='pending' for update;
    if not found then insert into public.social_party_invites(party_id,invited_by,invited_user_id,expires_at) values(p_party,p_actor,p_target,now()+interval '24 hours') returning * into v_invite; end if;
    v_result:=jsonb_build_object('ok',true,'duplicate',false,'inviteId',v_invite.id,'status',v_invite.status);
  else
    select * into v_invite from public.social_party_invites where id=p_invite and party_id=p_party for update;
    if not found or v_invite.status<>'pending' then raise exception 'invite_not_pending'; end if;
    if p_action in('accept','decline') and v_invite.invited_user_id<>p_actor then raise exception 'not_invited_user'; end if;
    if p_action='revoke' and v_invite.invited_by<>p_actor and not exists(select 1 from public.social_party_members where party_id=p_party and user_id=p_actor and role in('leader','officer')) then raise exception 'not_party_officer'; end if;
    if v_invite.expires_at<=now() then update public.social_party_invites set status='expired',responded_at=now() where id=v_invite.id; raise exception 'invite_expired'; end if;
    if p_action='accept' then
      if exists(select 1 from public.social_party_members where user_id=p_actor and party_id<>p_party) then raise exception 'already_in_party'; end if;
      insert into public.social_party_members(party_id,user_id,role) values(p_party,p_actor,'member') on conflict do nothing;
    end if;
    update public.social_party_invites set status=case p_action when 'accept' then 'accepted' when 'decline' then 'declined' else 'revoked' end,responded_at=now() where id=v_invite.id returning * into v_invite;
    v_result:=jsonb_build_object('ok',true,'duplicate',false,'inviteId',v_invite.id,'status',v_invite.status);
  end if;
  insert into public.social_party_requests(actor_user_id,request_id,action,payload,response) values(p_actor,p_request_id,p_action,v_payload,v_result);
  return v_result;
end $$;
revoke all on function public.social_party_command(uuid,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.social_party_command(uuid,text,text,uuid,uuid,uuid) to service_role;

-- Exit is idempotent. It creates exactly one player party at the Earth starter
-- town after all authoritative tutorial evidence exists.
create or replace function public.enter_living_world(p_actor uuid,p_character uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_progress public.world_tutorial_progress%rowtype; v_character public.game_characters%rowtype;
  v_location uuid; v_party uuid; v_social uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-entry:'||p_actor::text,0));
  select * into v_character from public.game_characters where id=p_character and user_id=p_actor for update;
  if not found then raise exception 'character_not_found'; end if;
  select * into v_progress from public.world_tutorial_progress where user_id=p_actor and character_id=p_character for update;
  if not found or v_progress.completed_at is null then raise exception 'tutorial_incomplete'; end if;
  if v_progress.world_party_id is not null then
    return jsonb_build_object('ok',true,'duplicate',true,'partyId',v_progress.world_party_id,'shardId','earth-1');
  end if;
  select l.id into v_location from public.world_locations l join public.world_provinces p on p.id=l.province_id
    where p.shard_id='earth-1' and p.key='greenfall' and l.key='greenfall-crossing';
  if v_location is null then raise exception 'earth_bootstrap_missing'; end if;
  insert into public.world_parties(shard_id,owner_user_id,leader_character_id,name,kind,location_id,speed,morale,stance)
    values('earth-1',p_actor,p_character,v_character.name||'''s Company','player',v_location,1.2,60,'friendly') returning id into v_party;
  insert into public.world_armies(party_id,commander_user_id,combat_power,formation) values(v_party,p_actor,0,'{}');
  insert into public.social_parties(shard_id,leader_user_id,name) values('earth-1',p_actor,v_character.name||'''s Party') returning id into v_social;
  insert into public.social_party_members(party_id,user_id,role) values(v_social,p_actor,'leader');
  update public.world_tutorial_progress set entered_world_at=now(),world_party_id=v_party,revision=revision+1,updated_at=now() where user_id=p_actor;
  return jsonb_build_object('ok',true,'duplicate',false,'partyId',v_party,'socialPartyId',v_social,'shardId','earth-1');
end $$;
revoke all on function public.enter_living_world(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enter_living_world(uuid,uuid) to service_role;

-- Earth bootstrap. All rows use stable UUIDs and upserts so this section can be replayed.
insert into public.world_shards(id,name,status,seed,ruleset_version) values('earth-1','Earth','active',20260820,1)
  on conflict(id) do update set name=excluded.name;
insert into public.world_provinces(id,shard_id,key,name,bounds,owner_faction_id)
  values('10000000-0000-4000-8000-000000000001','earth-1','greenfall','Greenfall Province','{"minX":0,"minY":0,"maxX":100,"maxY":100}','greenfall_freeholds')
  on conflict(id) do update set name=excluded.name,bounds=excluded.bounds;
insert into public.world_locations(id,province_id,key,name,kind,position,owner_faction_id,services) values
 ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','greenfall-crossing','Greenfall Crossing','town','{"x":18,"y":58}','greenfall_freeholds','{"market":true,"recruitment":true,"healer":true}'),
 ('11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','ironwood','Ironwood','town','{"x":55,"y":28}','ironwood_compact','{"market":true,"recruitment":true,"forge":true}'),
 ('11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','rotmire-watch','Rotmire Watch','fort','{"x":78,"y":67}','greenfall_freeholds','{"garrison":true,"missions":true}'),
 ('11000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','reedwater','Reedwater','village','{"x":42,"y":76}','greenfall_freeholds','{"market":true,"recruitment":true}')
on conflict(id) do update set name=excluded.name,position=excluded.position,owner_faction_id=excluded.owner_faction_id,services=excluded.services;
insert into public.world_routes(id,province_id,origin_id,destination_id,distance,terrain,danger) values
 ('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',48,'{"type":"road","cover":0.35}',0.12),
 ('12000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003',43,'{"type":"forest","cover":0.75}',0.38),
 ('12000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000004',39,'{"type":"marsh","cover":0.55}',0.48),
 ('12000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001',29,'{"type":"road","cover":0.2}',0.18)
on conflict(id) do update set distance=excluded.distance,terrain=excluded.terrain,danger=excluded.danger;
insert into public.world_markets(location_id,commodity_key,stock,base_price,buy_price,sell_price) values
 ('11000000-0000-4000-8000-000000000001','grain',800,12,14,10),('11000000-0000-4000-8000-000000000001','iron',180,35,40,30),
 ('11000000-0000-4000-8000-000000000002','grain',260,12,17,11),('11000000-0000-4000-8000-000000000002','iron',900,35,37,32),
 ('11000000-0000-4000-8000-000000000004','grain',1100,12,12,9),('11000000-0000-4000-8000-000000000004','herbs',520,24,27,20)
on conflict(location_id,commodity_key) do nothing;
insert into public.world_parties(id,shard_id,owner_faction_id,name,kind,location_id,speed,morale,stance) values
 ('13000000-0000-4000-8000-000000000001','earth-1','greenfall_freeholds','Greenfall Road Wardens','patrol','11000000-0000-4000-8000-000000000001',1.1,72,'friendly'),
 ('13000000-0000-4000-8000-000000000002','earth-1','ironwood_compact','Ironwood Caravan','caravan','11000000-0000-4000-8000-000000000002',0.8,58,'neutral'),
 ('13000000-0000-4000-8000-000000000003','earth-1','rotmire_host','Rotmire Reavers','ai','11000000-0000-4000-8000-000000000003',1.25,64,'hostile')
on conflict(id) do nothing;
insert into public.world_armies(id,party_id,combat_power,formation) values
 ('14000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001',125,'{"doctrine":"guard"}'),
 ('14000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002',55,'{"doctrine":"evade"}'),
 ('14000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003',190,'{"doctrine":"raid"}')
on conflict(id) do nothing;
insert into public.world_unit_stacks(army_id,unit_key,tier,healthy,wounded,experience) values
 ('14000000-0000-4000-8000-000000000001','freehold_spearman',1,60,0,0),
 ('14000000-0000-4000-8000-000000000002','caravan_guard',1,24,0,0),
 ('14000000-0000-4000-8000-000000000003','rotmire_raider',1,85,0,0)
on conflict(army_id,unit_key,tier) do nothing;

commit;
