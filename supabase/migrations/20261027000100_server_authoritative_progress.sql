-- ============================================================================
-- Server-authoritative progression for the siege game.
--
-- REVIEW BEFORE APPLYING. Apply manually in Supabase after review, AFTER
-- deploying the client that calls /api/match-result (older clients write
-- player_stats / match_history directly and will start getting RLS errors
-- once this runs; they keep playing, only their stat writes are refused).
--
-- What it does:
--   1. Adds server-owned progress columns:
--        game_characters.xp / stats / progress_revision
--        player_stats.campaign_cleared / best_survival / quests_done / relics /
--                     labyrinth_clears
--   2. One-time backfill of character level/XP and campaign progress from the
--      legacy client-written auth.users.raw_user_meta_data, so existing
--      players keep what they had. After this, the metadata copy is ignored.
--   3. Adds match_reports (idempotency + per-room dedupe + rate limit ledger).
--   4. Adds apply_match_result(), security definer, service_role only.
--   5. Revokes every client write path to player_stats and match_history.
--      Reads are unchanged.
-- ============================================================================

begin;

-- 1. Columns -----------------------------------------------------------------
alter table public.game_characters
  add column if not exists xp bigint not null default 0 check (xp >= 0),
  add column if not exists stats jsonb not null default '{}'::jsonb,
  add column if not exists progress_revision bigint not null default 1 check (progress_revision > 0);

alter table public.player_stats
  add column if not exists campaign_cleared integer not null default 0 check (campaign_cleared >= 0),
  add column if not exists best_survival integer not null default 0 check (best_survival >= 0),
  add column if not exists quests_done jsonb not null default '{}'::jsonb,
  add column if not exists relics jsonb not null default '[]'::jsonb,
  add column if not exists labyrinth_clears jsonb not null default '{}'::jsonb;

-- 2. One-time backfill from legacy client metadata ----------------------------
-- These values were client-written. They are trusted exactly once so nobody
-- loses their characters; every change after this goes through the server.
update public.game_characters gc
set level = least(100, greatest(gc.level, (c->>'level')::integer)),
    xp = case when coalesce(c->>'xp', '') ~ '^[0-9]{1,9}(\.[0-9]+)?$' then floor((c->>'xp')::numeric)::bigint else gc.xp end,
    updated_at = now()
from auth.users u,
     jsonb_array_elements(case when jsonb_typeof(u.raw_user_meta_data->'mmo_characters') = 'array'
                               then u.raw_user_meta_data->'mmo_characters' else '[]'::jsonb end) c
where u.id = gc.user_id
  and c->>'id' = gc.client_character_id
  and coalesce(c->>'level', '') ~ '^[0-9]{1,3}$';

update public.player_stats ps
set campaign_cleared = least(1000, (u.raw_user_meta_data->>'campaign')::integer)
from auth.users u
where u.id = ps.user_id
  and coalesce(u.raw_user_meta_data->>'campaign', '') ~ '^[0-9]{1,4}$'
  and ps.campaign_cleared = 0;

-- 3. Match report ledger ------------------------------------------------------
create table if not exists public.match_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (length(request_id) between 8 and 64),
  character_id uuid references public.game_characters(id) on delete set null,
  room_id uuid,
  mode text not null,
  level_id integer not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  report jsonb not null,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create unique index if not exists match_reports_one_per_room
  on public.match_reports(user_id, room_id) where room_id is not null;
create index if not exists match_reports_user_created_idx
  on public.match_reports(user_id, created_at desc);

alter table public.match_reports enable row level security;
drop policy if exists match_reports_read_self on public.match_reports;
create policy match_reports_read_self on public.match_reports
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.match_reports from anon, authenticated;

-- 4. The only writer of progression -------------------------------------------
create or replace function public.apply_match_result(
  p_actor uuid,
  p_request_id text,
  p_client_character_id text,
  p_room_id uuid,
  p_expected_progress_revision bigint,
  p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_min_interval constant interval := interval '15 seconds';
  c_clock_slack constant integer := 120;
  c_stash_cap constant integer := 60;
  v_existing public.match_reports%rowtype;
  v_character public.game_characters%rowtype;
  v_stats public.player_stats%rowtype;
  v_wallet public.player_wallets%rowtype;
  v_last timestamptz;
  v_report jsonb := p_result->'report';
  v_duration integer := (p_result->'report'->>'durationSeconds')::integer;
  v_stash integer;
  v_item jsonb;
  v_granted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_quests jsonb := '{}'::jsonb;
  v_quest text;
  v_relic text;
  v_relics jsonb;
  v_alloy bigint := greatest(0, coalesce((p_result->>'alloy')::bigint, 0));
  v_won boolean := coalesce((v_report->>'won')::boolean, false);
  v_mode text := v_report->>'mode';
  v_response jsonb;
begin
  if p_actor is null or coalesce(p_request_id, '') = '' or v_report is null then
    raise exception 'invalid_match_result';
  end if;
  -- One account, one writer at a time: serialises duplicate submits, the rate
  -- limit, and the quest ledger.
  perform pg_advisory_xact_lock(hashtextextended('match_result:' || p_actor::text, 0));

  select * into v_existing from public.match_reports where user_id = p_actor and request_id = p_request_id;
  if found then
    return coalesce(v_existing.response_payload, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  if p_room_id is not null and exists (
    select 1 from public.match_reports where user_id = p_actor and room_id = p_room_id
  ) then
    raise exception 'duplicate_room_report';
  end if;

  select max(created_at) into v_last from public.match_reports where user_id = p_actor;
  if v_last is not null then
    if now() - v_last < c_min_interval then raise exception 'rate_limited'; end if;
    -- A match cannot have lasted longer than the time since the last one ended.
    -- Solo play runs at up to 2x, so sim seconds / 2 is the wall-clock floor.
    if (v_duration + 1) / 2 > extract(epoch from now() - v_last)::integer + c_clock_slack then
      raise exception 'implausible_duration';
    end if;
  end if;

  select * into v_character from public.game_characters
  where user_id = p_actor and client_character_id = p_client_character_id
  for update;
  if not found then raise exception 'character_not_found'; end if;
  if p_expected_progress_revision is not null and v_character.progress_revision <> p_expected_progress_revision then
    raise exception 'stale_progress';
  end if;

  insert into public.player_stats(user_id) values (p_actor) on conflict (user_id) do nothing;
  select * into v_stats from public.player_stats where user_id = p_actor for update;

  -- Quests are once per account; skip any another match already completed.
  for v_quest in select jsonb_array_elements_text(coalesce(p_result->'quests_completed', '[]'::jsonb)) loop
    if not (v_stats.quests_done ? v_quest) then
      v_quests := v_quests || jsonb_build_object(v_quest, true);
    end if;
  end loop;

  -- Items: authored (non-rolled) items are unique per character; rolled items
  -- stack up to the stash cap. Anything that does not fit is reported back.
  select count(*) into v_stash from public.item_instances
  where character_id = v_character.id and location = 'stash';
  for v_item in select * from jsonb_array_elements(coalesce(p_result->'items', '[]'::jsonb)) loop
    if v_item->>'quest_id' is not null and not (v_quests ? (v_item->>'quest_id')) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'quest_already_completed'));
      continue;
    end if;
    if position(':' in v_item->>'legacy_key') = 0 and exists (
      select 1 from public.item_instances
      where character_id = v_character.id and legacy_key = v_item->>'legacy_key' and location <> 'sold'
    ) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'already_owned'));
      continue;
    end if;
    if v_stash >= c_stash_cap then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_item->>'legacy_key', 'reason', 'stash_full'));
      continue;
    end if;
    insert into public.item_instances(owner_user_id, character_id, legacy_key, base_id, slot_pool, item_level, rarity,
      affixes, sockets, binding, location, economy_data, provenance)
    values (p_actor, v_character.id, v_item->>'legacy_key', v_item->>'base_id', v_item->>'slot_pool',
      (v_item->>'item_level')::integer, (v_item->>'rarity')::integer, coalesce(v_item->'affixes', '[]'::jsonb),
      '[]'::jsonb, coalesce(v_item->>'binding', 'account'), 'stash', coalesce(v_item->'economy_data', '{}'::jsonb),
      coalesce(v_item->'provenance', '{}'::jsonb) || jsonb_build_object('granted_at', now()));
    v_stash := v_stash + 1;
    v_granted := v_granted || jsonb_build_array(v_item->>'legacy_key');
  end loop;

  v_relics := coalesce(v_stats.relics, '[]'::jsonb);
  for v_relic in select jsonb_array_elements_text(coalesce(p_result->'relics', '[]'::jsonb)) loop
    if not (v_relics ? v_relic) then v_relics := v_relics || jsonb_build_array(v_relic); end if;
  end loop;

  update public.game_characters set
    level = least(100, greatest(1, (p_result->>'level')::integer)),
    xp = greatest(0, (p_result->>'xp')::bigint),
    stats = jsonb_build_object(
      'instances', coalesce((stats->>'instances')::integer, 0) + 1,
      'victories', coalesce((stats->>'victories')::integer, 0) + case when v_won then 1 else 0 end,
      'kills', coalesce((stats->>'kills')::bigint, 0) + coalesce((v_report->>'kills')::bigint, 0)),
    progress_revision = progress_revision + 1,
    updated_at = now()
  where id = v_character.id
  returning * into v_character;

  insert into public.player_wallets(user_id) values (p_actor) on conflict (user_id) do nothing;
  update public.player_wallets set salvage_alloy = salvage_alloy + v_alloy,
    revision = revision + case when v_alloy > 0 then 1 else 0 end, updated_at = now()
  where user_id = p_actor returning * into v_wallet;

  update public.player_stats set
    games_played = games_played + 1,
    wins = wins + coalesce((p_result->'stats'->>'wins')::integer, 0),
    losses = losses + coalesce((p_result->'stats'->>'losses')::integer, 0),
    total_kills = total_kills + coalesce((p_result->'stats'->>'kills')::integer, 0),
    buildings_built = buildings_built + coalesce((p_result->'stats'->>'buildingsBuilt')::integer, 0),
    best_day = greatest(best_day, coalesce((p_result->'stats'->>'bestDay')::integer, 0)),
    best_wave = greatest(best_wave, coalesce((p_result->'stats'->>'bestWave')::integer, 0)),
    favorite_hero = coalesce(nullif(p_result->'stats'->>'favoriteHero', ''), favorite_hero),
    campaign_cleared = greatest(campaign_cleared, coalesce((p_result->'progress'->>'campaignCleared')::integer, 0)),
    best_survival = greatest(best_survival, coalesce((p_result->'progress'->>'bestSurvival')::integer, 0)),
    labyrinth_clears = case when p_result->'progress'->>'labyrinthClear' is not null
      then labyrinth_clears || jsonb_build_object(p_result->'progress'->>'labyrinthClear', true) else labyrinth_clears end,
    quests_done = quests_done || v_quests,
    relics = v_relics,
    updated_at = now()
  where user_id = p_actor
  returning * into v_stats;

  insert into public.match_history(user_id, room_id, mode, rules, hero, result, day_reached, kills,
    buildings_built, duration_seconds, visibility, summary)
  values (p_actor, p_room_id, v_mode, 'continuous-siege', v_report->>'hero',
    case when v_won then 'win' else 'loss' end,
    coalesce((v_report->>'threatLevel')::integer, 0), coalesce((v_report->>'kills')::integer, 0),
    coalesce((v_report->>'built')::integer, 0), coalesce(v_duration, 0), 'private',
    jsonb_build_object('levelId', v_report->'levelId', 'difficulty', v_report->'difficulty',
      'xp', p_result->'xp_gained', 'alloy', v_alloy, 'items', v_granted, 'request_id', p_request_id));

  v_response := jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'character', jsonb_build_object('clientCharacterId', v_character.client_character_id,
      'level', v_character.level, 'xp', v_character.xp, 'stats', v_character.stats,
      'progressRevision', v_character.progress_revision),
    'xpGained', coalesce((p_result->>'xp_gained')::integer, 0),
    'levelsGained', coalesce(p_result->'levels_gained', '[]'::jsonb),
    'grantedItems', v_granted,
    'skippedItems', v_skipped,
    'relicsGranted', coalesce(p_result->'relics', '[]'::jsonb),
    'questsCompleted', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_quests) k),
    'alloyGained', v_alloy,
    'wallet', jsonb_build_object('balance', v_wallet.salvage_alloy),
    'stats', jsonb_build_object('gamesPlayed', v_stats.games_played, 'wins', v_stats.wins,
      'losses', v_stats.losses, 'kills', v_stats.total_kills, 'bestDay', v_stats.best_day,
      'bestWave', v_stats.best_wave, 'campaignCleared', v_stats.campaign_cleared,
      'bestSurvival', v_stats.best_survival, 'questsDone', v_stats.quests_done,
      'relics', v_stats.relics, 'labyrinthClears', v_stats.labyrinth_clears));

  insert into public.match_reports(user_id, request_id, character_id, room_id, mode, level_id,
    duration_seconds, report, response_payload)
  values (p_actor, p_request_id, v_character.id, p_room_id, v_mode,
    coalesce((v_report->>'levelId')::integer, 0), coalesce(v_duration, 0), v_report, v_response);

  return v_response;
end;
$$;

revoke all on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb) to service_role;

-- 5. Revoke client writes -----------------------------------------------------
drop policy if exists player_stats_insert_self on public.player_stats;
drop policy if exists player_stats_update_self on public.player_stats;
drop policy if exists match_history_insert_self on public.match_history;
revoke insert, update, delete on public.player_stats from anon, authenticated;
revoke insert, update, delete on public.match_history from anon, authenticated;
-- game_characters, item_instances and player_wallets were already read-only
-- for clients (economy_mutate is the writer); restate it here.
revoke insert, update, delete on public.game_characters from anon, authenticated;
revoke insert, update, delete on public.item_instances from anon, authenticated;
revoke insert, update, delete on public.player_wallets from anon, authenticated;

commit;
