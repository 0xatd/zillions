-- ============================================================================
-- Campaign perks on match tickets.
--
-- REVIEW BEFORE APPLYING. Do not apply this against the live project from
-- an agent run. Apply it with the deploy that sends perks on
-- /api/match-start, before that deploy serves traffic.
--
-- What it does:
--   1. match_tickets.perks records the campaign perk stack the match ran
--      with. The signed ticket payload carries the same list.
--   2. issue_match_ticket() stores that list. A room reuses its unused
--      ticket only when the perk list matches, so every peer runs one stack.
--   3. A match_reports insert whose report.perks differ from the ticket is
--      rejected. Rewards still do not wait on a replay.
-- ============================================================================

begin;

alter table public.match_tickets
  add column if not exists perks jsonb not null default '[]'::jsonb;

-- The previous 8-argument function cannot grow a parameter in place.
drop function if exists public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer);

create or replace function public.issue_match_ticket(
  p_actor uuid,
  p_client_character_id text,
  p_level_id integer,
  p_mode text,
  p_difficulty text,
  p_seed bigint,
  p_room_id uuid,
  p_ttl_seconds integer,
  p_perks jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.match_tickets%rowtype;
  v_recent integer;
  v_perk jsonb;
begin
  if p_actor is null or p_level_id is null or p_mode is null or p_difficulty is null or p_seed is null then
    raise exception 'invalid_ticket_request';
  end if;
  if p_perks is null or jsonb_typeof(p_perks) <> 'array' or jsonb_array_length(p_perks) > 16 then
    raise exception 'invalid_ticket_request';
  end if;
  for v_perk in select value from jsonb_array_elements(p_perks) loop
    if jsonb_typeof(v_perk) <> 'string' or length(v_perk #>> '{}') > 64 or length(v_perk #>> '{}') < 1 then
      raise exception 'invalid_ticket_request';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('match_ticket:' || p_actor::text, 0));
  if p_room_id is not null then
    if not exists (
      select 1 from public.room_players rp join public.rooms r on r.id = rp.room_id
      where rp.room_id = p_room_id and rp.user_id = p_actor and r.status in ('starting', 'in_game')
    ) then
      raise exception 'not_a_room_participant';
    end if;
    -- Reconnecting to the same room returns the same unused ticket.
    -- A different perk list is a different match and is refused.
    select * into v_ticket from public.match_tickets
    where user_id = p_actor and room_id = p_room_id and used_at is null and expires_at > now()
      and level_id = p_level_id and mode = p_mode and difficulty = p_difficulty
    order by issued_at limit 1;
    if found then
      if coalesce(v_ticket.perks, '[]'::jsonb) <> p_perks then
        raise exception 'ticket_mismatch';
      end if;
      return to_jsonb(v_ticket);
    end if;
  end if;
  select count(*) into v_recent from public.match_tickets
  where user_id = p_actor and issued_at > now() - interval '1 minute';
  if v_recent >= 6 then raise exception 'rate_limited'; end if;
  insert into public.match_tickets(
    user_id, client_character_id, level_id, mode, difficulty, seed, room_id, expires_at, perks
  ) values (
    p_actor, left(p_client_character_id, 96), p_level_id, p_mode, p_difficulty, p_seed, p_room_id,
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 0), 600), 172800)),
    p_perks
  )
  returning * into v_ticket;
  return to_jsonb(v_ticket);
end;
$$;

revoke all on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.issue_match_ticket(uuid, text, integer, text, text, bigint, uuid, integer, jsonb) to service_role;

-- The report's perk list has to be the list the ticket was issued for.
-- apply_match_result() inserts the report after it has locked the ticket.
create or replace function public.match_reports_check_perk_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_perks jsonb;
  v_claim jsonb;
begin
  if new.ticket_id is null then return new; end if;
  select coalesce(perks, '[]'::jsonb) into v_ticket_perks from public.match_tickets where id = new.ticket_id;
  if v_ticket_perks is null then return new; end if;
  v_claim := case
    when jsonb_typeof(new.report->'perks') = 'array' then new.report->'perks'
    else '[]'::jsonb
  end;
  if v_ticket_perks <> v_claim then
    raise exception 'ticket_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists match_reports_check_perk_ticket on public.match_reports;
create trigger match_reports_check_perk_ticket
  before insert on public.match_reports
  for each row execute function public.match_reports_check_perk_ticket();

commit;
