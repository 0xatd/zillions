-- Small persistent friend groups. Existing rooms still own Ready, seats,
-- hero selection, campaign eligibility, transport and match rewards.
create table if not exists public.friend_parties (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
 leader_id uuid not null references public.profiles(id) on delete cascade,
 room_id uuid references public.rooms(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists public.friend_party_members (
 party_id uuid not null references public.friend_parties(id) on delete cascade,
 user_id uuid primary key references public.profiles(id) on delete cascade,
 joined_at timestamptz not null default now()
);
create index if not exists friend_party_members_party on public.friend_party_members(party_id);
alter table public.friend_parties enable row level security;
alter table public.friend_party_members enable row level security;
-- No client table writes or recursive membership policies. The authenticated
-- RPC checks membership once and returns only the caller's own party.
revoke all on public.friend_parties, public.friend_party_members from anon, authenticated;

create or replace function public.friend_party_snapshot()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',p.id,'code',p.code,'leaderId',p.leader_id,
   'room',case when r.id is not null and r.status in ('open','starting','in_game')
     and r.last_seen_at > now()-interval '2 minutes'
     then jsonb_build_object('id',r.id,'code',r.code,'status',r.status,'hostId',r.host_user_id) else null end,
   'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,
      'name',coalesce(nullif(pr.handle,''),'Commander')) order by m.joined_at,m.user_id),'[]'::jsonb)
      from friend_party_members m join profiles pr on pr.id=m.user_id where m.party_id=p.id))
 from friend_parties p join friend_party_members mine on mine.party_id=p.id and mine.user_id=auth.uid()
 left join rooms r on r.id=p.room_id;
$$;
revoke all on function public.friend_party_snapshot() from public, anon;
grant execute on function public.friend_party_snapshot() to authenticated;

create or replace function public.friend_party_action(p_action text,p_code text default null,p_room uuid default null,p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
 uid uuid:=auth.uid(); pid uuid; leader uuid; target uuid; active_room uuid;
begin
 if uid is null then raise exception 'sign_in_required'; end if;
 -- Serialize this account's create/join/leave across tabs. Party row locks
 -- serialize different members, including concurrent joins to the last seat.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,4831));
 select party_id into pid from friend_party_members where user_id=uid;
 if p_action='create' then
   if pid is not null then return friend_party_snapshot(); end if;
   insert into friend_parties(leader_id) values(uid) returning id into pid;
   insert into friend_party_members(party_id,user_id) values(pid,uid);
 elsif p_action='join' then
   if coalesce(p_code,'') !~ '^[A-Za-z0-9]{10}$' then raise exception 'invalid_party_code'; end if;
   select id,leader_id into target,leader from friend_parties where code=upper(p_code) for update;
   if target is null then raise exception 'party_not_found'; end if;
   if pid=target then return friend_party_snapshot(); end if;
   if pid is not null then raise exception 'leave_current_party'; end if;
   if (select count(*) from friend_party_members where party_id=target)>=4 then raise exception 'party_full'; end if;
   insert into friend_party_members(party_id,user_id) values(target,uid);
 else
   if pid is null then raise exception 'party_not_found'; end if;
   select leader_id,room_id into leader,active_room from friend_parties where id=pid for update;
   if not found then raise exception 'party_not_found'; end if;
   -- Recheck after acquiring the party lock: a leader may have removed us.
   if not exists(select 1 from friend_party_members where party_id=pid and user_id=uid) then raise exception 'party_not_found'; end if;
   if p_action='leave' then
     delete from friend_party_members where party_id=pid and user_id=uid;
     if leader=uid then
       select user_id into target from friend_party_members where party_id=pid order by joined_at,user_id limit 1;
       if target is null then delete from friend_parties where id=pid;
       else update friend_parties set leader_id=target,room_id=null where id=pid; end if;
     end if;
   elsif p_action='kick' or p_action='lead' then
     if leader<>uid then raise exception 'leader_only'; end if;
     if p_user=uid or p_user is null or not exists(select 1 from friend_party_members where party_id=pid and user_id=p_user) then raise exception 'invalid_member'; end if;
     if p_action='kick' then
       delete from friend_party_members where party_id=pid and user_id=p_user;
       update friend_parties set code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)) where id=pid;
     else update friend_parties set leader_id=p_user,room_id=null where id=pid; end if;
   elsif p_action='room' then
     if leader<>uid then raise exception 'leader_only'; end if;
     if p_room is not null and not exists(select 1 from rooms where id=p_room and host_user_id=uid and visibility='private' and status='open') then raise exception 'invalid_room'; end if;
     update friend_parties set room_id=p_room where id=pid;
   else raise exception 'invalid_party_action';
   end if;
 end if;
 return friend_party_snapshot();
end;
$$;
revoke all on function public.friend_party_action(text,text,uuid,uuid) from public, anon;
grant execute on function public.friend_party_action(text,text,uuid,uuid) to authenticated;
