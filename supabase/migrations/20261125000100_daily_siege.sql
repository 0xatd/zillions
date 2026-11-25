-- Daily Siege leaderboard.
--
-- One row per account per UTC day: that account's best verified score.
-- The API (api/daily.js) replays the input log before it calls
-- submit_daily_score(). Clients cannot insert, update, or delete.
--
-- Apply by hand to the Zillions project (skqggyvkblqtyggtcxbc). Do not point
-- this file at another product. No new environment variables are required:
-- the route uses the existing Supabase URL, anon key, and service role key.

create table if not exists public.daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seed bigint not null,
  score integer not null check (score >= 0),
  waves integer not null check (waves >= 0 and waves <= 64),
  city_hp integer not null check (city_hp >= 0),
  city_max_hp integer not null check (city_max_hp >= 1 and city_hp <= city_max_hp),
  duration_seconds integer not null check (duration_seconds >= 0 and duration_seconds <= 3600),
  won boolean not null default false,
  hero text not null,
  display_name text not null,
  sim_hash integer not null,
  replay_log jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  check (char_length(hero) between 1 and 32),
  check (hero ~ '^[a-z0-9_]+$'),
  check (char_length(display_name) between 3 and 32),
  check (display_name ~ '^[a-z0-9_]+$')
);

create index if not exists daily_scores_day_score_idx
  on public.daily_scores (day, score desc, created_at asc);

alter table public.daily_scores enable row level security;

revoke all on public.daily_scores from anon, authenticated;

-- The board is public. The input log and the sim hash are not.
grant select (
  day, score, waves, city_hp, city_max_hp, duration_seconds, won, hero, display_name, created_at
) on public.daily_scores to anon, authenticated;

drop policy if exists daily_scores_read_board on public.daily_scores;
create policy daily_scores_read_board on public.daily_scores
  for select to anon, authenticated
  using (true);

-- No insert, update, or delete policy. service_role bypasses RLS and is the
-- only role granted the write function below.

create or replace function public.submit_daily_score(
  p_actor uuid,
  p_day date,
  p_seed bigint,
  p_score integer,
  p_waves integer,
  p_city_hp integer,
  p_city_max_hp integer,
  p_duration integer,
  p_won boolean,
  p_hero text,
  p_display_name text,
  p_sim_hash integer,
  p_replay jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.daily_scores%rowtype;
  stored public.daily_scores%rowtype;
  rnk integer;
begin
  if p_actor is null then raise exception 'sign_in_required'; end if;
  if p_score is null or p_score < 0 or p_waves is null or p_waves < 0 or p_waves > 64 then
    raise exception 'invalid_daily_score';
  end if;
  if p_city_hp is null or p_city_hp < 0 or p_city_max_hp is null or p_city_max_hp < 1 or p_city_hp > p_city_max_hp then
    raise exception 'invalid_daily_score';
  end if;
  if p_duration is null or p_duration < 0 or p_duration > 3600 then raise exception 'invalid_daily_score'; end if;
  if p_hero is null or p_hero !~ '^[a-z0-9_]{1,32}$' then raise exception 'invalid_daily_score'; end if;
  if p_display_name is null or p_display_name !~ '^[a-z0-9_]{3,32}$' then raise exception 'invalid_daily_score'; end if;
  if p_replay is null or jsonb_typeof(p_replay) <> 'object' then raise exception 'invalid_daily_score'; end if;

  -- One writer per account per day, including two tabs submitting at once.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_day::text, 90210));
  select * into existing from public.daily_scores where user_id = p_actor and day = p_day for update;

  if existing.user_id is not null and existing.score >= p_score then
    stored := existing;
  else
    insert into public.daily_scores (
      user_id, day, seed, score, waves, city_hp, city_max_hp, duration_seconds, won,
      hero, display_name, sim_hash, replay_log, created_at, updated_at
    ) values (
      p_actor, p_day, p_seed, p_score, p_waves, p_city_hp, p_city_max_hp, p_duration, coalesce(p_won, false),
      p_hero, p_display_name, p_sim_hash, p_replay, now(), now()
    )
    on conflict (user_id, day) do update set
      seed = excluded.seed,
      score = excluded.score,
      waves = excluded.waves,
      city_hp = excluded.city_hp,
      city_max_hp = excluded.city_max_hp,
      duration_seconds = excluded.duration_seconds,
      won = excluded.won,
      hero = excluded.hero,
      display_name = excluded.display_name,
      sim_hash = excluded.sim_hash,
      replay_log = excluded.replay_log,
      created_at = now(),
      updated_at = now()
    where public.daily_scores.score < excluded.score
    returning * into stored;
    if stored.user_id is null then
      select * into stored from public.daily_scores where user_id = p_actor and day = p_day;
    end if;
  end if;

  select count(*)::integer + 1 into rnk
  from public.daily_scores
  where day = p_day
    and (
      score > stored.score
      or (score = stored.score and created_at < stored.created_at)
      or (score = stored.score and created_at = stored.created_at and user_id < stored.user_id)
    );

  return jsonb_build_object(
    'score', stored.score,
    'waves', stored.waves,
    'cityHp', stored.city_hp,
    'cityMaxHp', stored.city_max_hp,
    'seconds', stored.duration_seconds,
    'won', stored.won,
    'rank', rnk,
    'improved', existing.user_id is null or p_score > existing.score
  );
end;
$$;

revoke all on function public.submit_daily_score(uuid, date, bigint, integer, integer, integer, integer, integer, boolean, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.submit_daily_score(uuid, date, bigint, integer, integer, integer, integer, integer, boolean, text, text, integer, jsonb) to service_role;
