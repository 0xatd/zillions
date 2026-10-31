-- Persistent parties for friend co-op.
-- NOT APPLIED to the live Supabase project. Ship this file with the PR only.
-- A party outlives a match. The match itself is still a rooms row.

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  leader_id uuid not null references public.profiles(id) on delete cascade,
  level_id integer not null default 1 check (level_id >= 1),
  mode text not null default 'campaign' check (mode in ('campaign', 'survival', 'labyrinth')),
  difficulty text not null default 'normal' check (difficulty in ('casual', 'normal', 'brutal')),
  status text not null default 'together' check (status in ('together', 'staging', 'in_match')),
  room_id uuid references public.rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists parties_touch_updated_at on public.parties;
create trigger parties_touch_updated_at
before update on public.parties
for each row
execute function public.touch_updated_at();

create table if not exists public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  hero text not null default 'scott',
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create unique index if not exists party_members_one_party
on public.party_members (user_id);

create table if not exists public.party_chat (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 160),
  created_at timestamptz not null default now()
);

create index if not exists party_chat_party_created_idx
on public.party_chat (party_id, created_at desc);

create index if not exists party_chat_user_created_idx
on public.party_chat (user_id, created_at desc);

-- Mute hides someone's chat for you. Block also refuses party joins and
-- friend requests in either direction.
create table if not exists public.player_mutes (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mute', 'block')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id, kind),
  check (blocker_id <> blocked_id)
);

-- Same word list as PROFANITY in src/social-chat.js.
create or replace function public.mask_profanity(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v text := p_text;
  w text;
  words text[] := array['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'retard'];
begin
  foreach w in array words loop
    v := regexp_replace(v, w, repeat('*', char_length(w)), 'gi');
  end loop;
  return v;
end;
$$;

create or replace function public.party_chat_guard()
returns trigger
language plpgsql
as $$
declare
  v_recent integer;
begin
  new.message := public.mask_profanity(btrim(regexp_replace(new.message, '\s+', ' ', 'g')));
  if new.message is null or char_length(new.message) < 1 then
    raise exception 'empty_chat';
  end if;
  if char_length(new.message) > 160 then
    raise exception 'chat_length';
  end if;
  select count(*) into v_recent
  from public.party_chat
  where user_id = new.user_id
    and created_at > now() - interval '10 seconds';
  if v_recent >= 4 then
    raise exception 'chat_rate';
  end if;
  return new;
end;
$$;

drop trigger if exists party_chat_guard on public.party_chat;
create trigger party_chat_guard
before insert on public.party_chat
for each row
execute function public.party_chat_guard();

create or replace function public.friend_request_block_guard()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.player_mutes
    where kind = 'block'
      and (
        (blocker_id = new.requester_id and blocked_id = new.addressee_id)
        or (blocker_id = new.addressee_id and blocked_id = new.requester_id)
      )
  ) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_block_guard on public.friendships;
create trigger friendships_block_guard
before insert on public.friendships
for each row
execute function public.friend_request_block_guard();

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_chat enable row level security;
alter table public.player_mutes enable row level security;

drop policy if exists parties_read_member on public.parties;
create policy parties_read_member
on public.parties for select
to authenticated
using (
  exists (
    select 1 from public.party_members
    where party_members.party_id = parties.id
      and party_members.user_id = auth.uid()
  )
);

drop policy if exists party_members_read_member on public.party_members;
create policy party_members_read_member
on public.party_members for select
to authenticated
using (
  exists (
    select 1 from public.party_members mine
    where mine.party_id = party_members.party_id
      and mine.user_id = auth.uid()
  )
);

drop policy if exists party_chat_read_member on public.party_chat;
create policy party_chat_read_member
on public.party_chat for select
to authenticated
using (
  exists (
    select 1 from public.party_members
    where party_members.party_id = party_chat.party_id
      and party_members.user_id = auth.uid()
  )
);

drop policy if exists party_chat_insert_member on public.party_chat;
create policy party_chat_insert_member
on public.party_chat for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.party_members
    where party_members.party_id = party_chat.party_id
      and party_members.user_id = auth.uid()
  )
);

drop policy if exists player_mutes_own on public.player_mutes;
create policy player_mutes_own
on public.player_mutes for all
to authenticated
using (auth.uid() = blocker_id)
with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

-- Membership changes go through these functions so a member cannot rewrite
-- the leader, the roster, or someone else's hero.

create or replace function public.create_party()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if exists (select 1 from public.party_members where user_id = auth.uid()) then
    raise exception 'already_in_party';
  end if;
  select handle into v_name from public.profiles where id = auth.uid();
  insert into public.parties (leader_id) values (auth.uid()) returning id into v_id;
  insert into public.party_members (party_id, user_id, display_name, hero, ready)
  values (v_id, auth.uid(), coalesce(v_name, 'commander'), 'scott', false);
  return v_id;
end;
$$;

create or replace function public.join_party(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party public.parties%rowtype;
  v_name text;
  v_hero text;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select * into v_party from public.parties where code = upper(substr(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'), 1, 6));
  if not found then raise exception 'no_party'; end if;
  if exists (select 1 from public.party_members where user_id = auth.uid() and party_id = v_party.id) then
    return v_party.id;
  end if;
  if exists (select 1 from public.party_members where user_id = auth.uid()) then
    raise exception 'already_in_party';
  end if;
  select count(*) into v_count from public.party_members where party_id = v_party.id;
  if v_count >= 4 then raise exception 'party_full'; end if;
  if exists (
    select 1
    from public.player_mutes m
    join public.party_members pm on pm.party_id = v_party.id
    where m.kind = 'block'
      and (
        (m.blocker_id = auth.uid() and m.blocked_id = pm.user_id)
        or (m.blocker_id = pm.user_id and m.blocked_id = auth.uid())
      )
  ) then
    raise exception 'blocked';
  end if;
  select pick into v_hero
  from unnest(array['scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron']) as pick
  where not exists (
    select 1 from public.party_members
    where party_id = v_party.id and party_members.hero = pick
  )
  limit 1;
  if v_hero is null then raise exception 'party_full'; end if;
  select handle into v_name from public.profiles where id = auth.uid();
  insert into public.party_members (party_id, user_id, display_name, hero, ready)
  values (v_party.id, auth.uid(), coalesce(v_name, 'commander'), v_hero, false);
  return v_party.id;
end;
$$;

create or replace function public.leave_party()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
  v_leader uuid;
  v_next uuid;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select party_id into v_party from public.party_members where user_id = auth.uid();
  if v_party is null then return; end if;
  select leader_id into v_leader from public.parties where id = v_party;
  delete from public.party_members where party_id = v_party and user_id = auth.uid();
  if not exists (select 1 from public.party_members where party_id = v_party) then
    delete from public.parties where id = v_party;
    return;
  end if;
  if v_leader = auth.uid() then
    select user_id into v_next from public.party_members
    where party_id = v_party
    order by joined_at asc
    limit 1;
    update public.parties set leader_id = v_next where id = v_party;
  end if;
end;
$$;

create or replace function public.kick_party_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then
    raise exception 'not_self';
  end if;
  select id into v_party from public.parties where leader_id = auth.uid();
  if v_party is null then raise exception 'not_leader'; end if;
  delete from public.party_members where party_id = v_party and user_id = p_user;
end;
$$;

create or replace function public.handoff_party(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then
    raise exception 'already';
  end if;
  select id into v_party from public.parties where leader_id = auth.uid();
  if v_party is null then raise exception 'not_leader'; end if;
  if not exists (
    select 1 from public.party_members where party_id = v_party and user_id = p_user
  ) then
    raise exception 'missing';
  end if;
  update public.parties set leader_id = p_user where id = v_party;
end;
$$;

create or replace function public.set_party_hero(p_hero text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
  v_leader uuid;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_hero not in ('scott', 'alexander', 'danny', 'turtle', 'john', 'tiger', 'aaron') then
    raise exception 'bad_hero';
  end if;
  select party_id into v_party from public.party_members where user_id = auth.uid();
  if v_party is null then raise exception 'missing'; end if;
  if exists (
    select 1 from public.party_members
    where party_id = v_party and user_id <> auth.uid() and hero = p_hero
  ) then
    raise exception 'hero_taken';
  end if;
  select leader_id into v_leader from public.parties where id = v_party;
  update public.party_members
  set hero = p_hero,
      ready = case when auth.uid() = v_leader then ready else false end
  where party_id = v_party and user_id = auth.uid();
end;
$$;

create or replace function public.set_party_ready(p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
  v_leader uuid;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select m.party_id, p.leader_id into v_party, v_leader
  from public.party_members m
  join public.parties p on p.id = m.party_id
  where m.user_id = auth.uid();
  if v_party is null then raise exception 'missing'; end if;
  if auth.uid() = v_leader then return; end if;
  update public.party_members set ready = coalesce(p_ready, false)
  where party_id = v_party and user_id = auth.uid();
end;
$$;

create or replace function public.set_party_setup(p_level integer, p_mode text, p_difficulty text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
  v_mode text;
  v_diff text;
  v_level integer;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  select id into v_party from public.parties
  where leader_id = auth.uid() and status = 'together';
  if v_party is null then raise exception 'not_leader'; end if;
  v_mode := coalesce(p_mode, 'campaign');
  v_diff := coalesce(p_difficulty, 'normal');
  if v_mode not in ('campaign', 'survival', 'labyrinth') then raise exception 'bad_mode'; end if;
  if v_diff not in ('casual', 'normal', 'brutal') then raise exception 'bad_difficulty'; end if;
  v_level := coalesce(p_level, 1);
  if v_mode = 'labyrinth' then
    if v_level < 9001 then v_level := 9001; end if;
  elsif v_level < 1 or v_level >= 9001 then
    v_level := 1;
  end if;
  update public.parties
  set level_id = v_level, mode = v_mode, difficulty = v_diff
  where id = v_party;
  update public.party_members set ready = false
  where party_id = v_party and user_id <> auth.uid();
end;
$$;

create or replace function public.set_party_room(p_room uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if p_status not in ('together', 'staging', 'in_match') then raise exception 'bad_status'; end if;
  select id into v_party from public.parties where leader_id = auth.uid();
  if v_party is null then raise exception 'not_leader'; end if;
  update public.parties
  set status = p_status,
      room_id = case when p_status = 'together' then null else p_room end
  where id = v_party;
  if p_status = 'together' then
    update public.party_members set ready = false where party_id = v_party;
  end if;
end;
$$;

-- Public commander card. Character rows stay private; this returns only the
-- level, the chosen hero, and the server-owned match counters.
create or replace function public.public_commander(p_user uuid)
returns table (
  id uuid,
  handle text,
  display_name text,
  selected_hero text,
  favorite_hero text,
  level integer,
  games_played integer,
  wins integer,
  campaign_cleared integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.handle,
    p.display_name,
    p.selected_hero,
    s.favorite_hero,
    coalesce((select max(c.level) from public.game_characters c where c.user_id = p.id), 1),
    coalesce(s.games_played, 0),
    coalesce(s.wins, 0),
    coalesce(s.campaign_cleared, 0)
  from public.profiles p
  left join public.player_stats s on s.user_id = p.id
  where p.id = p_user;
$$;

revoke all on function public.mask_profanity(text) from public;
grant execute on function public.mask_profanity(text) to authenticated;

revoke all on function public.create_party() from public, anon;
revoke all on function public.join_party(text) from public, anon;
revoke all on function public.leave_party() from public, anon;
revoke all on function public.kick_party_member(uuid) from public, anon;
revoke all on function public.handoff_party(uuid) from public, anon;
revoke all on function public.set_party_hero(text) from public, anon;
revoke all on function public.set_party_ready(boolean) from public, anon;
revoke all on function public.set_party_setup(integer, text, text) from public, anon;
revoke all on function public.set_party_room(uuid, text) from public, anon;
revoke all on function public.public_commander(uuid) from public, anon;

grant execute on function public.create_party() to authenticated;
grant execute on function public.join_party(text) to authenticated;
grant execute on function public.leave_party() to authenticated;
grant execute on function public.kick_party_member(uuid) to authenticated;
grant execute on function public.handoff_party(uuid) to authenticated;
grant execute on function public.set_party_hero(text) to authenticated;
grant execute on function public.set_party_ready(boolean) to authenticated;
grant execute on function public.set_party_setup(integer, text, text) to authenticated;
grant execute on function public.set_party_room(uuid, text) to authenticated;
grant execute on function public.public_commander(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parties'
    ) then
      alter publication supabase_realtime add table public.parties;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_members'
    ) then
      alter publication supabase_realtime add table public.party_members;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_chat'
    ) then
      alter publication supabase_realtime add table public.party_chat;
    end if;
  end if;
end;
$$;
