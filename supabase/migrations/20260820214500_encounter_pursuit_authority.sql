-- Server-owned strategic contact decisions. Tactical battle creation/results are
-- deliberately outside this migration and belong to the next integration.
begin;

alter table public.world_encounters drop constraint if exists world_encounters_state_check;
alter table public.world_encounters add constraint world_encounters_state_check
  check(state in('choosing','negotiating','battle','escaped','surrendered','resolved','scattered','awaiting_allies','rearguard'));

create table public.world_encounter_decisions(
  encounter_id uuid not null references public.world_encounters(id) on delete cascade,
  party_id uuid not null references public.world_parties(id) on delete cascade,
  request_id text not null check(length(request_id) between 1 and 96),
  encounter_revision bigint not null,
  choice text not null check(choice in('fight','auto-command','surrender','parley','escape','diversion','rearguard','fortify','call-allies','scatter')),
  response text check(response is null or response in('press-attack','demand-surrender','accept-payment','grant-safe-passage','pursue-main-force','engage-rearguard','take-prisoners-and-release','disengage')),
  snapshot jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(encounter_id,party_id),
  unique(party_id,request_id)
);
alter table public.world_encounter_decisions enable row level security;
create policy world_encounter_decisions_owner_read on public.world_encounter_decisions
  for select to authenticated using(exists(select 1 from public.world_parties p where p.id=party_id and p.owner_user_id=auth.uid()));

create or replace function public.submit_world_encounter_decision(
  p_actor uuid,p_encounter uuid,p_party uuid,p_request_id text,p_expected_revision bigint,
  p_choice text,p_response text,p_worker text,p_lease_epoch bigint
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  e public.world_encounters%rowtype; me public.world_parties%rowtype; other public.world_parties%rowtype;
  lease public.world_region_worker_leases%rowtype; prior public.world_encounter_decisions%rowtype;
  my_troops integer; other_troops integer; my_scout numeric; other_scout numeric;
  escape_chance integer; roll integer; outcome text:='battle'; answer text; v_result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world-encounter:'||p_encounter::text,0));
  select * into e from public.world_encounters where id=p_encounter for update;
  if not found or e.state not in('choosing','negotiating') then raise exception 'encounter_not_available'; end if;
  if e.revision<>p_expected_revision then raise exception 'stale_encounter'; end if;
  select * into me from public.world_parties where id=p_party and id in(e.attacker_party_id,e.defender_party_id) for update;
  if not found or me.owner_user_id is distinct from p_actor then raise exception 'unauthorized_party'; end if;
  select * into lease from public.world_region_worker_leases where region_id=me.region_id for update;
  if not found or lease.worker_id<>p_worker or lease.lease_epoch<>p_lease_epoch or lease.lease_until<=now() then raise exception 'region_lease_required'; end if;
  select * into prior from public.world_encounter_decisions where encounter_id=p_encounter and party_id=p_party;
  if found then
    if prior.request_id<>p_request_id or prior.encounter_revision<>p_expected_revision or prior.choice<>p_choice or prior.response is distinct from p_response then raise exception 'idempotency_conflict'; end if;
    return coalesce(prior.result,jsonb_build_object('ok',true,'duplicate',true,'status','waiting'))||jsonb_build_object('duplicate',true);
  end if;
  if p_choice not in('fight','auto-command','surrender','parley','escape','diversion','rearguard','fortify','call-allies','scatter') then raise exception 'invalid_encounter_choice'; end if;
  if p_response is not null and p_response not in('press-attack','demand-surrender','accept-payment','grant-safe-passage','pursue-main-force','engage-rearguard','take-prisoners-and-release','disengage') then raise exception 'invalid_pursuer_response'; end if;
  select * into other from public.world_parties where id=case when p_party=e.attacker_party_id then e.defender_party_id else e.attacker_party_id end for update;
  my_troops:=coalesce((e.scouting_snapshot#>>array[p_party::text,'troops'])::integer,1);
  other_troops:=coalesce((e.scouting_snapshot#>>array[other.id::text,'troops'])::integer,1);
  my_scout:=coalesce((e.scouting_snapshot#>>array[p_party::text,'scouting'])::numeric,0);
  other_scout:=coalesce((e.scouting_snapshot#>>array[other.id::text,'scouting'])::numeric,0);
  escape_chance:=greatest(2,least(98,50+round((me.speed-other.speed)*5+(my_scout-other_scout)*0.5-me.fatigue*0.2-ln(greatest(my_troops,1))*2+ln(greatest(other_troops,1))*2)::integer));
  if p_choice='rearguard' and my_troops<20 then raise exception 'choice_unavailable'; end if;
  if p_choice='call-allies' and coalesce((e.scouting_snapshot->>'alliesInRange')::integer,0)<1 then raise exception 'choice_unavailable'; end if;
  if p_choice='fortify' and coalesce((e.terrain->>'defense')::numeric,0)<8 then raise exception 'choice_unavailable'; end if;
  if p_choice='diversion' and coalesce((e.scouting_snapshot#>>array[p_party::text,'supplies'])::numeric,0)<=0 and my_troops<10 then raise exception 'choice_unavailable'; end if;
  if p_choice='scatter' and my_troops<10 then raise exception 'choice_unavailable'; end if;
  insert into public.world_encounter_decisions(encounter_id,party_id,request_id,encounter_revision,choice,response,snapshot)
    values(p_encounter,p_party,p_request_id,p_expected_revision,p_choice,p_response,jsonb_build_object('troops',my_troops,'opponentTroops',other_troops,'escapeChance',escape_chance));
  if p_party=e.attacker_party_id then update public.world_encounters set attacker_choice=p_choice,revision=revision+1 where id=p_encounter returning * into e;
  else update public.world_encounters set defender_choice=p_choice,revision=revision+1 where id=p_encounter returning * into e; end if;
  select choice into answer from public.world_encounter_decisions where encounter_id=p_encounter and party_id=other.id;
  if answer is null then return jsonb_build_object('ok',true,'duplicate',false,'status','waiting','encounterRevision',e.revision); end if;
  roll:=mod(abs(hashtextextended(p_encounter::text||':'||e.attacker_choice||':'||e.defender_choice,0)),100)::integer;
  if p_choice='surrender' or answer='surrender' then outcome:='surrendered';
  elsif p_choice='parley' or answer='parley' then outcome:='negotiating';
  elsif p_choice='call-allies' or answer='call-allies' then outcome:='awaiting_allies';
  elsif p_choice='rearguard' or answer='rearguard' then outcome:='rearguard';
  elsif p_choice='scatter' or answer='scatter' then outcome:=case when roll<escape_chance then 'scattered' else 'battle' end;
  elsif p_choice in('escape','diversion') or answer in('escape','diversion') then outcome:=case when roll<escape_chance then 'escaped' else 'battle' end;
  else outcome:='battle'; end if;
  v_result:=jsonb_build_object('ok',true,'duplicate',false,'status','resolved','outcome',outcome,'roll',roll,'tacticalPending',outcome in('battle','rearguard'));
  update public.world_encounters set state=outcome,revision=revision+1 where id=p_encounter returning * into e;
  update public.world_encounter_decisions set result=v_result where encounter_id=p_encounter;
  return v_result||jsonb_build_object('encounterRevision',e.revision);
end $$;

revoke all on function public.submit_world_encounter_decision(uuid,uuid,uuid,text,bigint,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.submit_world_encounter_decision(uuid,uuid,uuid,text,bigint,text,text,text,bigint) to service_role;
commit;
