-- Shareable replays.
--
-- Apply by hand to the Zillions project (skqggyvkblqtyggtcxbc) after
-- 20261125000100_daily_siege.sql. Do not point this file at another product.
-- No new environment variables: /api/replay uses the existing Supabase URL
-- and service role key.
--
-- Manual steps:
--   1. Open the Supabase SQL editor for skqggyvkblqtyggtcxbc.
--   2. Run this file.
--   3. Deploy the build that serves /api/replay, /api/replay-page, and /r/<id>.
--
-- What it does:
--   * public.replays stores one replay document per shared run.
--   * RLS is enabled. anon and authenticated have no grants and no policies,
--     so a client cannot list or write replays. The service role is the only
--     reader and writer, through /api/replay.
--   * publish_replay() enforces the 1.2 MB cap and 12 new replays per hour
--     per account and per IP hash. A repeated upload of the same document
--     returns the existing id. A Daily Siege board publish replaces that
--     account's board replay for the day.

create table if not exists public.replays (
  id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text not null,
  digest text not null,
  sim_version integer not null,
  mode text not null,
  seed bigint not null,
  level_id integer not null,
  difficulty text not null,
  culture text not null,
  hero text not null,
  won boolean not null default false,
  day date,
  frames integer not null,
  sim_hash integer not null,
  bytes integer not null,
  board boolean not null default false,
  body jsonb not null,
  created_at timestamptz not null default now(),
  check (id ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{8}$'),
  check (ip_hash ~ '^[0-9a-f]{64}$'),
  check (digest ~ '^[0-9a-f]{64}$'),
  check (mode in ('campaign', 'survival', 'labyrinth', 'daily')),
  check (difficulty in ('casual', 'normal', 'brutal')),
  check (culture ~ '^[a-z_]{1,32}$'),
  check (hero ~ '^[a-z0-9_]{1,32}$'),
  check (seed between 0 and 4294967295),
  check (frames between 1 and 500000),
  check (bytes between 1 and 1200000),
  check (char_length(body::text) <= 1200000)
);

create index if not exists replays_digest_user_idx
  on public.replays (user_id, digest) where user_id is not null;
create index if not exists replays_digest_ip_idx
  on public.replays (ip_hash, digest) where user_id is null;
create index if not exists replays_recent_ip_idx
  on public.replays (ip_hash, created_at desc);
create index if not exists replays_recent_user_idx
  on public.replays (user_id, created_at desc) where user_id is not null;
create index if not exists replays_board_day_idx
  on public.replays (user_id, day) where board;

alter table public.replays enable row level security;

revoke all on public.replays from anon, authenticated;

-- No select, insert, update, or delete policy. service_role bypasses RLS.

create or replace function public.publish_replay(
  p_id text,
  p_actor uuid,
  p_ip_hash text,
  p_digest text,
  p_bytes integer,
  p_board boolean,
  p_body jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.replays%rowtype;
  v_mode text;
  v_hero text;
  v_day date;
  v_seed bigint;
  v_level integer;
  v_frames integer;
  v_hash integer;
  v_sim integer;
  v_recent integer;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'invalid_replay'; end if;
  if p_id is null or p_id !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{8}$' then
    raise exception 'invalid_replay';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_replay'; end if;
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_replay'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 1200000 then raise exception 'replay_too_large'; end if;
  if octet_length(p_body::text) > 1200000 then raise exception 'replay_too_large'; end if;

  v_mode := p_body->>'mode';
  if v_mode is null or v_mode not in ('campaign', 'survival', 'labyrinth', 'daily') then
    raise exception 'invalid_replay';
  end if;
  if coalesce(p_body->>'difficulty', '') not in ('casual', 'normal', 'brutal') then raise exception 'invalid_replay'; end if;
  if coalesce(p_body->>'culture', '') !~ '^[a-z_]{1,32}$' then raise exception 'invalid_replay'; end if;
  if jsonb_typeof(p_body->'leaders'->0) = 'string' then
    v_hero := p_body->'leaders'->>0;
  else
    v_hero := p_body->'leaders'->0->>'k';
  end if;
  if v_hero is null or v_hero !~ '^[a-z0-9_]{1,32}$' then raise exception 'invalid_replay'; end if;
  v_day := null;
  if v_mode = 'daily' then
    if coalesce(p_body->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_replay'; end if;
    v_day := (p_body->>'day')::date;
  end if;
  v_seed := (p_body->>'seed')::bigint;
  v_level := (p_body->>'levelId')::integer;
  v_frames := (p_body->>'frames')::integer;
  v_hash := (p_body->>'hash')::integer;
  v_sim := (p_body->>'sim')::integer;
  if v_seed is null or v_seed < 0 or v_seed > 4294967295 then raise exception 'invalid_replay'; end if;
  if v_level is null or v_frames is null or v_frames < 1 or v_frames > 500000 then raise exception 'invalid_replay'; end if;
  if v_hash is null or v_sim is null then raise exception 'invalid_replay'; end if;

  perform pg_advisory_xact_lock(hashtextextended('replay:' || coalesce(p_actor::text, '') || ':' || p_ip_hash, 44021));

  if coalesce(p_board, false) and p_actor is not null and v_day is not null then
    select * into existing from public.replays
    where user_id = p_actor and day = v_day and board
    for update;
    if found then
      update public.replays set
        ip_hash = p_ip_hash,
        digest = p_digest,
        sim_version = v_sim,
        mode = v_mode,
        seed = v_seed,
        level_id = v_level,
        difficulty = p_body->>'difficulty',
        culture = p_body->>'culture',
        hero = v_hero,
        won = coalesce((p_body->>'won')::boolean, false),
        frames = v_frames,
        sim_hash = v_hash,
        bytes = p_bytes,
        body = p_body
      where id = existing.id;
      return jsonb_build_object('id', existing.id, 'duplicate', false, 'replaced', true);
    end if;
  end if;

  select * into existing from public.replays
  where digest = p_digest
    and (
      (p_actor is not null and user_id = p_actor)
      or (p_actor is null and user_id is null and ip_hash = p_ip_hash)
    )
  limit 1;
  if found then
    if coalesce(p_board, false) and not existing.board and p_actor is not null then
      update public.replays set board = true, day = coalesce(v_day, day) where id = existing.id;
    end if;
    return jsonb_build_object('id', existing.id, 'duplicate', true, 'replaced', false);
  end if;

  select count(*) into v_recent from public.replays
  where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_recent >= 12 then raise exception 'rate_limited'; end if;
  if p_actor is not null then
    select count(*) into v_recent from public.replays
    where user_id = p_actor and created_at > now() - interval '1 hour';
    if v_recent >= 12 then raise exception 'rate_limited'; end if;
  end if;

  insert into public.replays (
    id, user_id, ip_hash, digest, sim_version, mode, seed, level_id, difficulty, culture,
    hero, won, day, frames, sim_hash, bytes, board, body
  ) values (
    p_id, p_actor, p_ip_hash, p_digest, v_sim, v_mode, v_seed, v_level, p_body->>'difficulty', p_body->>'culture',
    v_hero, coalesce((p_body->>'won')::boolean, false), v_day, v_frames, v_hash, p_bytes, coalesce(p_board, false), p_body
  );
  return jsonb_build_object('id', p_id, 'duplicate', false, 'replaced', false);
exception
  when unique_violation then
    raise exception 'replay_id_taken';
  when invalid_text_representation then
    raise exception 'invalid_replay';
end;
$$;

revoke all on function public.publish_replay(text, uuid, text, text, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.publish_replay(text, uuid, text, text, integer, boolean, jsonb) to service_role;
