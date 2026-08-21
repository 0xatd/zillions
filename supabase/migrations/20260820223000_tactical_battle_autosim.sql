-- Bridge resolved strategic encounters into tactical/autosim engagements.
begin;

create or replace function public.living_world_open_engagement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tick bigint; v_mode text;
begin
  if new.state in ('battle','rearguard') and old.state is distinct from new.state then
    select simulation_tick into v_tick from public.world_shards where id=new.shard_id;
    v_mode:=case when new.attacker_choice in ('auto-command','auto_command') and new.defender_choice in ('auto-command','auto_command') then 'autosim'
      when new.attacker_choice in ('auto-command','auto_command') or new.defender_choice in ('auto-command','auto_command') then 'hybrid' else 'live_command' end;
    insert into public.world_engagements(encounter_id,seed,mode,state,started_tick)
      values(new.id,hashtextextended(new.id::text||':'||new.revision::text,0),v_mode,'active',v_tick)
      on conflict(encounter_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists world_encounter_open_engagement on public.world_encounters;
create trigger world_encounter_open_engagement after update of state on public.world_encounters
for each row execute function public.living_world_open_engagement();

create or replace function public.living_world_issue_battle(p_actor uuid,p_engagement uuid,p_encounter_revision bigint,p_request_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_eng public.world_engagements%rowtype; v_enc public.world_encounters%rowtype; v_assignment public.world_battle_assignments%rowtype; v_snapshot jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_actor is null or p_request_id is null or length(p_request_id) not between 1 and 96 then raise exception 'invalid_request'; end if;
  update public.world_battle_assignments set state='expired' where state='issued' and expires_at<=now();
  select * into v_assignment from public.world_battle_assignments where requested_by=p_actor and request_id=p_request_id;
  if found then
    if v_assignment.engagement_id<>p_engagement or v_assignment.encounter_revision<>p_encounter_revision then raise exception 'idempotency_conflict'; end if;
    return to_jsonb(v_assignment);
  end if;
  select * into v_eng from public.world_engagements where id=p_engagement for update;
  if not found or v_eng.state not in('active','retreat') then raise exception 'engagement_not_active'; end if;
  select * into v_enc from public.world_encounters where id=v_eng.encounter_id for update;
  if v_enc.revision<>p_encounter_revision or v_enc.state not in('battle','rearguard') then raise exception 'stale_encounter_revision'; end if;
  if not exists(select 1 from public.world_parties p where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id) and p.owner_user_id=p_actor) then raise exception 'not_encounter_commander'; end if;
  -- Serialize the immutable force snapshot against region movement, logistics,
  -- recruitment, and other authority mutations. The final migration installs
  -- guards that keep these rows frozen until this assignment resolves/expires.
  perform 1 from public.world_parties p where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id) order by p.id for update;
  perform 1 from public.world_armies a where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id) order by a.id for update;
  perform 1 from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id) order by s.id for update of s;
  perform 1 from public.world_supplies s where s.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id) order by s.party_id,s.supply_key for update;
  perform 1 from public.world_cargo c where c.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id) order by c.party_id,c.commodity_key for update;
  if v_eng.mode='live_command' and (select coalesce(sum(s.healthy),0) from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id))>2000 then
    raise exception 'battle_requires_autosim';
  end if;
  select jsonb_build_object(
    'engagementId',v_eng.id,'engagementMode',v_eng.mode,'encounterId',v_enc.id,'encounterRevision',v_enc.revision,'seed',v_eng.seed,'startedTick',v_eng.started_tick,'terrain',v_enc.terrain,
    'attackerPartyId',v_enc.attacker_party_id,'defenderPartyId',v_enc.defender_party_id,
    'parties',(select jsonb_agg(to_jsonb(p) order by p.id) from public.world_parties p where p.id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'armies',(select jsonb_agg(to_jsonb(a) order by a.id) from public.world_armies a where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'stacks',(select jsonb_agg(to_jsonb(s) order by s.id) from public.world_unit_stacks s join public.world_armies a on a.id=s.army_id where a.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id)),
    'cargo',(select coalesce(jsonb_agg(to_jsonb(c) order by c.party_id,c.commodity_key),'[]'::jsonb) from public.world_cargo c where c.party_id in(v_enc.attacker_party_id,v_enc.defender_party_id))
  ) into v_snapshot;
  insert into public.world_battle_assignments(engagement_id,encounter_id,encounter_revision,requested_by,request_id,force_snapshot,expires_at)
    values(v_eng.id,v_enc.id,v_enc.revision,p_actor,p_request_id,v_snapshot,now()+interval '2 hours') returning * into v_assignment;
  return to_jsonb(v_assignment);
end $$;

revoke all on function public.living_world_open_engagement() from public,anon,authenticated;
revoke all on function public.living_world_issue_battle(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.living_world_issue_battle(uuid,uuid,bigint,text) to service_role;
commit;
