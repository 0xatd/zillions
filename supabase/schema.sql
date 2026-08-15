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
where username_set = false;

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
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create trigger room_players_touch_updated_at
before update on public.room_players
for each row
execute function public.touch_updated_at();

create table if not exists public.room_chat (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists room_chat_room_created_idx
on public.room_chat (room_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.save_slots enable row level security;
alter table public.match_history enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_chat enable row level security;

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
create policy room_chat_read_authenticated
on public.room_chat for select
to authenticated
using (true);

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
