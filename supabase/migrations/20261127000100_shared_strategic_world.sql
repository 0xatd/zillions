-- Additive shared star-system authority. No legacy world tables are restored.
create table if not exists public.strategic_realms (
 id text primary key,
 revision bigint not null default 0,
 state jsonb,
 updated_at timestamptz not null default now(),
 check (state is null or octet_length(state::text) <= 2097152)
);
insert into public.strategic_realms(id) values ('sol-frontier') on conflict do nothing;
create table if not exists public.strategic_requests (
 actor uuid not null references auth.users(id) on delete cascade,
 request_id text not null,
 response jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor,request_id)
);
create table if not exists public.strategic_match_links (
 actor uuid not null references auth.users(id) on delete cascade,
 character_id uuid not null references public.game_characters(id),
 encounter_id text not null,
 ticket_id uuid not null unique references public.match_tickets(id),
 starting_troops integer not null check(starting_troops between 0 and 40),
 created_at timestamptz not null default now(),
 primary key(character_id,encounter_id)
);
alter table public.strategic_realms enable row level security;
alter table public.strategic_requests enable row level security;
alter table public.strategic_match_links enable row level security;
revoke all on public.strategic_realms,public.strategic_requests,public.strategic_match_links from anon,authenticated;
grant all on public.strategic_realms,public.strategic_requests,public.strategic_match_links to service_role;

-- Realm CAS, treasury debit and receipt commit together. A conflict rolls back
-- before spending; a duplicate receipt is returned before any mutation.
create or replace function public.strategic_commit(
 p_actor uuid,p_character uuid,p_revision bigint,p_state jsonb,
 p_request_id text,p_charge integer,p_result jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare current_revision bigint; receipt jsonb; balance bigint; answer jsonb;
begin
 select revision into current_revision from strategic_realms where id='sol-frontier' for update;
 if p_request_id is not null then
  select response into receipt from strategic_requests where actor=p_actor and request_id=p_request_id;
  if found then return receipt || '{"duplicate":true}'::jsonb; end if;
 end if;
 if not exists(select 1 from game_characters where id=p_character and user_id=p_actor) then raise exception 'unauthorized_ownership'; end if;
 if p_revision is null or current_revision<>p_revision then raise exception 'world_revision_conflict'; end if;
 if p_charge<0 or p_charge>120 or p_charge is null then raise exception 'invalid_charge'; end if;
 if p_state is null or p_state->>'realm' is distinct from 'sol-frontier' or p_state->>'v' is distinct from '1' or jsonb_typeof(p_state->'fleets') is distinct from 'array' then raise exception 'invalid_world_state'; end if;
 if p_charge>0 then
  update player_wallets set salvage_alloy=salvage_alloy-p_charge,revision=revision+1,updated_at=now() where user_id=p_actor and salvage_alloy>=p_charge returning salvage_alloy into balance;
  if not found then raise exception 'insufficient_alloy'; end if;
 else select salvage_alloy into balance from player_wallets where user_id=p_actor; end if;
 update strategic_realms set state=p_state,revision=revision+1,updated_at=now() where id='sol-frontier';
 answer=coalesce(p_result,'{}'::jsonb)||jsonb_build_object('revision',current_revision+1,'balance',coalesce(balance,0));
 if p_request_id is not null then
  if length(p_request_id)<8 or length(p_request_id)>96 then raise exception 'invalid_request_id'; end if;
  insert into strategic_requests(actor,request_id,response) values(p_actor,p_request_id,answer);
 end if;
 return answer;
end $$;
revoke all on function public.strategic_commit(uuid,uuid,bigint,jsonb,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.strategic_commit(uuid,uuid,bigint,jsonb,text,integer,jsonb) to service_role;

create or replace function public.strategic_link_match(p_actor uuid,p_character text,p_encounter text,p_ticket uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; world jsonb; fleet jsonb; encounter jsonb; ticket match_tickets; previous strategic_match_links; army jsonb;
begin
 select id into cid from game_characters where user_id=p_actor and client_character_id=p_character;
 if cid is null then raise exception 'unauthorized_ownership'; end if;
 select state into world from strategic_realms where id='sol-frontier' for update;
 select value into fleet from jsonb_array_elements(world->'fleets') where value->>'owner'=p_actor::text and value->>'character'=cid::text;
 select value into encounter from jsonb_array_elements(world->'encounters') where value->>'id'=p_encounter;
 if fleet is null or encounter is null or fleet->>'encounter'<>p_encounter or encounter->>'status' not in ('pending','battle') then raise exception 'encounter_not_started'; end if;
 if jsonb_array_length(encounter->'participants')>1 and encounter->'room' is null then raise exception 'encounter_room_required'; end if;
 if encounter->'room' is not null then
  if not (encounter->'seats' @> jsonb_build_array(fleet->>'id')) then raise exception 'encounter_member_missing'; end if;
  if jsonb_array_length(encounter->'participants')<>jsonb_array_length(encounter->'seats') then raise exception 'encounter_member_missing'; end if;
 end if;
 select coalesce(jsonb_agg((f.value->>'troops')::integer order by seat.ordinality),'[]'::jsonb) into army
 from jsonb_array_elements_text(coalesce(encounter->'seats',jsonb_build_array(fleet->>'id'))) with ordinality seat(id,ordinality)
 join jsonb_array_elements(world->'fleets') f on f.value->>'id'=seat.id;
 army=coalesce(encounter->'army',army);
 select * into ticket from match_tickets where id=p_ticket;
 if ticket.room_id::text is distinct from (encounter->'room'->>'id') then raise exception 'ticket_mismatch'; end if;
 if ticket.id is null or ticket.user_id<>p_actor or ticket.client_character_id is distinct from p_character or ticket.level_id<>(encounter->>'level')::integer or ticket.mode<>'campaign' then raise exception 'ticket_mismatch'; end if;
 select * into previous from strategic_match_links where character_id=cid and encounter_id=p_encounter;
 if found then
  select * into ticket from match_tickets where id=previous.ticket_id;
  if ticket.used_at is not null then raise exception 'battle_report_already_accepted'; end if;
  if ticket.expires_at<=now() then raise exception 'encounter_ticket_expired'; end if;
  return jsonb_build_object('encounter',p_encounter,'troops',previous.starting_troops,'army',army,'ticket',to_jsonb(ticket));
 end if;
 insert into strategic_match_links(actor,character_id,encounter_id,ticket_id,starting_troops)
 values(p_actor,cid,p_encounter,p_ticket,(fleet->>'troops')::integer);
 update strategic_realms set state=jsonb_set(world,'{encounters}',(select jsonb_agg(case when value->>'id'=p_encounter then value || jsonb_build_object('status','battle','army',army,'startedAt',coalesce(value->'startedAt',to_jsonb((extract(epoch from now())*1000)::bigint))) else value end) from jsonb_array_elements(world->'encounters'))),revision=revision+1,updated_at=now() where id='sol-frontier';
 return jsonb_build_object('encounter',p_encounter,'troops',(fleet->>'troops')::integer,'army',army,'ticket',to_jsonb(ticket));
end $$;
revoke all on function public.strategic_link_match(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.strategic_link_match(uuid,text,text,uuid) to service_role;

grant select on public.friend_party_members to service_role;
