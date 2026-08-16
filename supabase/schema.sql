-- Zillions Supabase backend schema.
-- Keep this schema compatible with the optional localStorage/Vercel Blob
-- fallback until the browser app is fully migrated.

create extension if not exists pgcrypto;

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
  max_players integer not null default 3 check (max_players between 1 and 3),
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
  seat integer not null check (seat between 1 and 3),
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

drop policy if exists player_stats_insert_self on public.player_stats;
create policy player_stats_insert_self
on public.player_stats for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists player_stats_update_self on public.player_stats;
create policy player_stats_update_self
on public.player_stats for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

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

drop policy if exists match_history_insert_self on public.match_history;
create policy match_history_insert_self
on public.match_history for insert
to authenticated
with check (auth.uid() = user_id);

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
