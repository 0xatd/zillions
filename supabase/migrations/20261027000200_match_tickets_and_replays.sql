-- ============================================================================
-- Match tickets, invite-code co-op rooms, and leaderboard review bookkeeping.
--
-- REVIEW BEFORE APPLYING. Apply manually in Supabase AFTER
-- 20261027000100_server_authoritative_progress.sql, together with a deploy
-- that ships /api/match-start and has MATCH_TICKET_SECRET set.
-- apply_match_result() now requires a ticket, so the 6-argument version is
-- dropped; a /api/match-result build older than this migration stops
-- granting rewards (reports stay queued client-side and retry).
--
-- What it does:
--   1. match_tickets: one row per started match (single use, 48 h expiry).
--   2. issue_match_ticket(): service_role only; rate limited; room tickets
--      require a seat in a room that is starting or in game.
--   3. create_manual_coop_room() / seat_manual_coop_player(): give invite-code
--      (copy/paste WebRTC) co-op a private rooms row so its players get co-op
--      credit and the one-report-per-room rule applies.
--   4. match_reports gains ticket, server-clock and review columns. Matches
--      are NOT replayed on the reward path. A leaderboard candidate keeps its
--      input log (replay_log, replay_status 'unverified') so a future
--      leaderboard can replay its top or flagged entries and record
--      'verified' / 'mismatch'; leaderboard_hidden lets an admin hide one.
--      See docs/leaderboards.md.
--   5. apply_match_result(..., p_ticket_id, p_review) replaces the 6-argument
--      version: it spends the ticket and checks match length against the
--      ticket's server issue time. Review data never blocks a payout.
-- ============================================================================

begin;

-- 1. Tickets -------------------------------------------------------------------
create table if not exists public.match_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_character_id text,
  level_id integer not null,
  mode text not null check (mode in ('campaign', 'survival', 'labyrinth')),
  difficulty text not null,
  seed bigint not null check (seed between 0 and 4294967295),
  room_id uuid references public.rooms(id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  request_id text
);
create index if not exists match_tickets_user_issued_idx on public.match_tickets(user_id, issued_at desc);
create index if not exists match_tickets_unused_room_idx on public.match_tickets(user_id, room_id) where used_at is null;

alter table public.match_tickets enable row level security;
drop policy if exists match_tickets_read_self on public.match_tickets;
create policy match_tickets_read_self on public.match_tickets
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.match_tickets from anon, authenticated;

-- 2. Issue ----------------------------------------------------------------------
create or replace function public.issue_match_ticket(
  p_actor uuid,
  p_client_character_id text,
  p_level_id integer,
  p_mode text,
  p_difficulty text,
  p_seed bigint,
  p_room_id uuid,
  p_ttl_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.match_tickets%rowtype;
  v_recent integer;
begin
  if p_actor is null or p_level_id is null or p_mode is null or p_difficulty is null or p_seed is null then
    raise exception 'invalid_ticket_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('match_ticket:' || p_actor::text, 0));
  if p_room_id is not null then
    if not exists (
      select 1 from public.room_players rp join public.rooms r on r.id = rp.room_id
      where rp.room_id = p_room_id and rp.user_id = p_actor and r.status in ('starting', 'in_game')
    ) then
      raise exception 'not_a_room_participant';
    end if;
    -- Reconnecting to the same room returns the same unused ticket.
    select * into v_ticket from public.match_tickets
    where user_id = p_actor and room_id = p_room_id and used_at is null and expires_at > now()
      and level_id = p_level_id and mode = p_mode and difficulty = p_difficulty
    order by issued_at limit 1;
    if found then
      return to_jsonb(v_ticket);
    end if;
  end if;
  select count(*) into v_recent from public.match_tickets
  where user_id = p_actor and issued_at > now() - interval '1 minute';
  if v_recent >= 6 then raise exception 'rate_limited'; end if;
  insert into public.match_tickets(user_id, client_character_id, level_id, mode, difficulty, seed, room_id, expires_at)
  values (p_actor, left(p_client_character_id, 96), p_level_id, p_mode, p_difficulty, p_seed, p_room_id,
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 0), 600), 172800)))
  returning * into v_ticket;
  return to_jsonb(v_ticket);
end;
$$;
revoke all on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer) to service_role;

-- 3. Invite-code co-op rooms ----------------------------------------------------
create or replace function public.create_manual_coop_room(
  p_actor uuid,
  p_display_name text,
  p_hero text,
  p_level_id integer,
  p_mode text,
  p_difficulty text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_recent integer;
begin
  if p_actor is null then raise exception 'invalid_room_request'; end if;
  if not exists (select 1 from public.profiles where id = p_actor) then raise exception 'profile_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manual_room:' || p_actor::text, 0));
  select count(*) into v_recent from public.rooms
  where host_user_id = p_actor and metadata->>'manual' = 'true' and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'rate_limited'; end if;
  insert into public.rooms(host_user_id, name, visibility, status, max_players, difficulty, metadata)
  values (p_actor, 'Invite co-op', 'private', 'in_game', 4, coalesce(nullif(p_difficulty, ''), 'normal'),
    jsonb_build_object('manual', true, 'levelId', p_level_id, 'mode', p_mode))
  returning id into v_room;
  insert into public.room_players(room_id, user_id, seat, display_name, hero, ready)
  values (v_room, p_actor, 1, left(coalesce(nullif(p_display_name, ''), 'Host'), 32),
    left(coalesce(nullif(p_hero, ''), 'scott'), 32), true);
  return v_room;
end;
$$;
revoke all on function public.create_manual_coop_room(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_manual_coop_room(uuid, text, text, integer, text, text) to service_role;

-- /api/match-start verifies the host-signed join token before calling this.
create or replace function public.seat_manual_coop_player(
  p_actor uuid,
  p_room_id uuid,
  p_display_name text,
  p_hero text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_seat integer;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or coalesce(v_room.metadata->>'manual', '') <> 'true' then raise exception 'room_not_found'; end if;
  if v_room.status <> 'in_game' or v_room.created_at < now() - interval '6 hours' then raise exception 'room_not_started'; end if;
  if not exists (select 1 from public.profiles where id = p_actor) then raise exception 'profile_not_found'; end if;
  select seat into v_seat from public.room_players where room_id = p_room_id and user_id = p_actor;
  if found then return v_seat; end if;
  select min(s) into v_seat from generate_series(1, v_room.max_players) s
  where not exists (select 1 from public.room_players where room_id = p_room_id and seat = s);
  if v_seat is null then raise exception 'room_full'; end if;
  insert into public.room_players(room_id, user_id, seat, display_name, hero, ready)
  values (p_room_id, p_actor, v_seat, left(coalesce(nullif(p_display_name, ''), 'Player'), 32),
    left(coalesce(nullif(p_hero, ''), 'scott'), 32), true);
  return v_seat;
end;
$$;
revoke all on function public.seat_manual_coop_player(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.seat_manual_coop_player(uuid, uuid, text, text) to service_role;

-- 4. Review bookkeeping ---------------------------------------------------------
-- replay_status: 'legacy' (before this migration), 'none' (no log kept),
-- 'unverified' (log kept, not replayed yet), 'verified' / 'mismatch' (set by
-- a future leaderboard verifier, which also fills replay_mismatch).
alter table public.match_reports
  add column if not exists ticket_id uuid references public.match_tickets(id) on delete set null,
  add column if not exists server_elapsed_seconds integer,
  add column if not exists replay_status text not null default 'legacy'
    check (replay_status in ('legacy', 'none', 'unverified', 'verified', 'mismatch')),
  add column if not exists review_reasons jsonb not null default '[]'::jsonb,
  add column if not exists replay_log jsonb,
  add column if not exists replay_mismatch jsonb not null default '[]'::jsonb,
  add column if not exists flagged boolean not null default false,
  add column if not exists leaderboard_hidden boolean not null default false;
create unique index if not exists match_reports_one_per_ticket on public.match_reports(ticket_id) where ticket_id is not null;
create index if not exists match_reports_flagged_idx on public.match_reports(created_at desc) where flagged;


-- 5. apply_match_result with a ticket ------------------------------------------
drop function if exists public.apply_match_result(uuid, text, text, uuid, bigint, jsonb);

create or replace function public.apply_match_result(
  p_actor uuid,
  p_request_id text,
  p_client_character_id text,
  p_room_id uuid,
  p_expected_progress_revision bigint,
  p_result jsonb,
  p_ticket_id uuid,
  p_review jsonb default '{}'::jsonb
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
  v_ticket public.match_tickets%rowtype;
  v_elapsed integer;
  v_report_id uuid;
  v_log jsonb := case when jsonb_typeof(p_review->'log') = 'object' then p_review->'log' end;
  v_reasons jsonb := case when jsonb_typeof(p_review->'reasons') = 'array' then p_review->'reasons' else '[]'::jsonb end;
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

  -- The match ticket: issued by /api/match-start, owned by this player, for
  -- this mission, unexpired and unused. It is spent in this transaction, so
  -- any later failure rolls the spend back too.
  if p_ticket_id is null then raise exception 'missing_ticket'; end if;
  select * into v_ticket from public.match_tickets where id = p_ticket_id for update;
  if not found or v_ticket.user_id <> p_actor then raise exception 'invalid_ticket'; end if;
  if v_ticket.used_at is not null then raise exception 'ticket_used'; end if;
  if v_ticket.expires_at <= now() then raise exception 'ticket_expired'; end if;
  if v_ticket.level_id <> coalesce((v_report->>'levelId')::integer, -1)
     or v_ticket.mode <> coalesce(v_mode, '')
     or v_ticket.difficulty <> coalesce(v_report->>'difficulty', '')
     or v_ticket.room_id is distinct from p_room_id then
    raise exception 'ticket_mismatch';
  end if;
  -- Match length comes from the server clock: solo runs at up to 2x speed,
  -- lockstep co-op at 1x.
  v_elapsed := greatest(0, extract(epoch from now() - v_ticket.issued_at)::integer);
  if coalesce(v_duration, 0) > v_elapsed * (case when p_room_id is null then 2 else 1 end) + c_clock_slack then
    raise exception 'implausible_duration';
  end if;
  update public.match_tickets set used_at = now(), request_id = p_request_id where id = v_ticket.id;

  -- Rate limit only. The duration check above uses the ticket's issue time,
  -- which is when the match started; the previous report's receipt time is
  -- not, because queued reports can be delivered late and back to back.
  select max(created_at) into v_last from public.match_reports where user_id = p_actor;
  if v_last is not null and now() - v_last < c_min_interval then raise exception 'rate_limited'; end if;

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
    duration_seconds, report, response_payload, ticket_id, server_elapsed_seconds, replay_status,
    review_reasons, replay_log, flagged)
  values (p_actor, p_request_id, v_character.id, p_room_id, v_mode,
    coalesce((v_report->>'levelId')::integer, 0), coalesce(v_duration, 0), v_report, v_response,
    v_ticket.id, v_elapsed, case when v_log is null then 'none' else 'unverified' end, v_reasons,
    v_log, coalesce(p_review->'flagged' = 'true'::jsonb, false))
  returning id into v_report_id;

  -- Invite-code rooms exist only for reward bookkeeping; close them once
  -- someone reports. Teammates can still report a finished room.
  if p_room_id is not null then
    update public.rooms set status = 'finished'
    where id = p_room_id and status <> 'finished' and coalesce(metadata->>'manual', '') = 'true';
  end if;

  return v_response;
end;
$$;

revoke all on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, text, text, uuid, bigint, jsonb, uuid, jsonb) to service_role;

commit;
