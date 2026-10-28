-- ============================================================================
-- Snapshot the account upgrade tree onto each match ticket.
--
-- REVIEW BEFORE APPLYING. Apply by hand in Supabase AFTER
-- 20261027000300_account_upgrades.sql. Do not run this against a live project
-- from an agent session.
--
-- issue_match_ticket() copies the actor's owned node ids into match_tickets
-- at issue time and signs nothing itself — api/match-start.js puts that list
-- on the ticket as `ups`. A later purchase does not change a ticket already
-- issued, and a reconnect returns the original row. Costs still come from
-- account_upgrade_catalog, never from the client.
-- ============================================================================

begin;

alter table public.match_tickets
  add column if not exists upgrades text[] not null default '{}';

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
  v_upgrades text[];
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
    -- Reconnecting to the same room returns the same unused ticket, upgrades
    -- included, so a purchase during the match cannot change the siege.
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
  select coalesce(array_agg(node_id order by node_id), '{}') into v_upgrades
    from public.account_upgrades where user_id = p_actor;
  insert into public.match_tickets(user_id, client_character_id, level_id, mode, difficulty, seed, room_id, expires_at, upgrades)
  values (p_actor, left(p_client_character_id, 96), p_level_id, p_mode, p_difficulty, p_seed, p_room_id,
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 0), 600), 172800)), v_upgrades)
  returning * into v_ticket;
  return to_jsonb(v_ticket);
end;
$$;

revoke all on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer) to service_role;

commit;
