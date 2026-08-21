-- Durable two-player parties and explicit grouped/split world travel.
begin;

alter table public.social_party_members
  add column travel_mode text not null default 'grouped'
  check (travel_mode in ('grouped','split'));

alter table public.social_party_requests drop constraint if exists social_party_requests_action_check;
alter table public.social_party_requests add constraint social_party_requests_action_check
  check (action in ('create','invite','accept','decline','revoke','leave','travel_mode','group_travel'));

create or replace function public.social_party_snapshot(p_actor uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select jsonb_build_object(
      'id',p.id,'name',p.name,'revision',p.revision,'leaderUserId',p.leader_user_id,
      'members',coalesce((select jsonb_agg(jsonb_build_object(
        'id',m.user_id,'name',coalesce(gc.name,'Commander'),
        'role',m.role,'travelMode',m.travel_mode,
        'worldPartyId',wp.id,'worldPartyRevision',wp.revision,
        'health',case when wp.id is null then 0 else 100 end,
        'status',case when wp.route_id is not null then 'Travelling' else initcap(wp.stance) end,
        'companyStrength',coalesce(a.combat_power,0),
        'locationId',wp.location_id,'routeId',wp.route_id,'location',coalesce(l.name,'Unknown')
      ) order by case m.role when 'leader' then 0 when 'officer' then 1 else 2 end,m.joined_at)
        from public.social_party_members m
        left join public.world_parties wp on wp.owner_user_id=m.user_id and wp.kind='player'
        left join public.game_characters gc on gc.id=wp.leader_character_id and gc.user_id=m.user_id
        left join public.world_armies a on a.party_id=wp.id
        left join public.world_locations l on l.id=wp.location_id
        where m.party_id=p.id),'[]'::jsonb),
      'invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'partyId',i.party_id,'invitedBy',i.invited_by,'invitedUserId',i.invited_user_id,'status',i.status,'expiresAt',i.expires_at) order by i.created_at)
        from public.social_party_invites i where i.party_id=p.id and i.status='pending' and i.expires_at>now()),'[]'::jsonb)
    ) from public.social_parties p join public.social_party_members mine on mine.party_id=p.id
      where mine.user_id=p_actor and p.status='active'
  ),jsonb_build_object('id',null,'members','[]'::jsonb,'invites','[]'::jsonb)) || jsonb_build_object(
    'pendingInvites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'partyId',i.party_id,'partyName',p.name,'invitedBy',i.invited_by,'expiresAt',i.expires_at) order by i.created_at)
      from public.social_party_invites i join public.social_parties p on p.id=i.party_id
      where i.invited_user_id=p_actor and i.status='pending' and i.expires_at>now() and p.status='active'),'[]'::jsonb));
$$;
revoke all on function public.social_party_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.social_party_snapshot(uuid) to service_role;

create or replace function public.social_party_command(p_actor uuid,p_request_id text,p_action text,p_party uuid,p_target uuid,p_invite uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.social_party_requests%rowtype; v_party public.social_parties%rowtype;
  v_invite public.social_party_invites%rowtype; v_current uuid; v_payload jsonb; v_result jsonb;
  v_member public.social_party_members%rowtype; v_route public.world_routes%rowtype; v_anchor public.world_parties%rowtype;
  v_world public.world_parties%rowtype; v_tick bigint; v_count int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 96 or p_action not in ('create','invite','accept','decline','revoke','leave','travel_mode','group_travel') then raise exception 'invalid_request'; end if;
  v_payload:=jsonb_build_object('partyId',p_party,'targetId',p_target,'inviteId',p_invite,'payload',coalesce(p_payload,'{}'::jsonb));
  perform pg_advisory_xact_lock(hashtextextended('social-party-command:'||p_actor::text||':'||p_request_id,0));
  select * into v_existing from public.social_party_requests where actor_user_id=p_actor and request_id=p_request_id;
  if found then
    if v_existing.action<>p_action or v_existing.payload<>v_payload then raise exception 'idempotency_conflict'; end if;
    return v_existing.response||jsonb_build_object('duplicate',true);
  end if;
  select party_id into v_current from public.social_party_members where user_id=p_actor;

  if p_action='create' then
    if v_current is not null then raise exception 'already_in_party'; end if;
    insert into public.social_parties(shard_id,leader_user_id,name) values(coalesce(nullif(p_payload->>'shardId',''),'earth-1'),p_actor,left(coalesce(nullif(trim(p_payload->>'name'),''),'New Party'),48)) returning * into v_party;
    insert into public.social_party_members(party_id,user_id,role) values(v_party.id,p_actor,'leader');
    v_result:=jsonb_build_object('ok',true,'partyId',v_party.id,'status','active');
  elsif p_action='accept' then
    select * into v_invite from public.social_party_invites where id=p_invite and party_id=p_party for update;
    if not found or v_invite.status<>'pending' then raise exception 'invite_not_pending'; end if;
    if v_invite.invited_user_id<>p_actor then raise exception 'not_invited_user'; end if;
    if v_invite.expires_at<=now() then update public.social_party_invites set status='expired',responded_at=now() where id=v_invite.id; raise exception 'invite_expired'; end if;
    if v_current is not null and v_current<>p_party then
      if (select count(*) from public.social_party_members where party_id=v_current)<>1 then raise exception 'leave_current_party_first'; end if;
      update public.social_parties set status='disbanded',revision=revision+1,updated_at=now() where id=v_current;
      delete from public.social_party_members where party_id=v_current and user_id=p_actor;
    end if;
    insert into public.social_party_members(party_id,user_id,role) values(p_party,p_actor,'member') on conflict do nothing;
    update public.social_party_invites set status='accepted',responded_at=now() where id=v_invite.id;
    update public.social_parties set revision=revision+1,updated_at=now() where id=p_party;
    v_result:=jsonb_build_object('ok',true,'partyId',p_party,'inviteId',v_invite.id,'status','accepted');
  else
    select * into v_party from public.social_parties where id=p_party and status='active' for update;
    if not found then raise exception 'party_not_found'; end if;
    select * into v_member from public.social_party_members where party_id=p_party and user_id=p_actor for update;
    if not found and p_action not in ('decline') then raise exception 'not_party_member'; end if;
    if p_action='invite' then
      if v_member.role not in ('leader','officer') then raise exception 'not_party_officer'; end if;
      if p_target is null or p_target=p_actor or exists(select 1 from public.social_party_members where party_id=p_party and user_id=p_target) then raise exception 'invalid_invitee'; end if;
      select * into v_invite from public.social_party_invites where party_id=p_party and invited_user_id=p_target and status='pending' for update;
      if not found then insert into public.social_party_invites(party_id,invited_by,invited_user_id,expires_at) values(p_party,p_actor,p_target,now()+interval '24 hours') returning * into v_invite; end if;
      v_result:=jsonb_build_object('ok',true,'inviteId',v_invite.id,'status',v_invite.status);
    elsif p_action in ('decline','revoke') then
      select * into v_invite from public.social_party_invites where id=p_invite and party_id=p_party for update;
      if not found or v_invite.status<>'pending' then raise exception 'invite_not_pending'; end if;
      if p_action='decline' and v_invite.invited_user_id<>p_actor then raise exception 'not_invited_user'; end if;
      if p_action='revoke' and v_invite.invited_by<>p_actor and v_member.role not in ('leader','officer') then raise exception 'not_party_officer'; end if;
      update public.social_party_invites set status=case p_action when 'decline' then 'declined' else 'revoked' end,responded_at=now() where id=v_invite.id;
      v_result:=jsonb_build_object('ok',true,'inviteId',v_invite.id,'status',p_action||'d');
    elsif p_action='leave' then
      delete from public.social_party_members where party_id=p_party and user_id=p_actor;
      if not exists(select 1 from public.social_party_members where party_id=p_party) then update public.social_parties set status='disbanded',revision=revision+1,updated_at=now() where id=p_party;
      elsif v_member.role='leader' then
        update public.social_party_members set role='leader' where party_id=p_party and user_id=(select user_id from public.social_party_members where party_id=p_party order by joined_at,user_id limit 1);
        update public.social_parties set leader_user_id=(select user_id from public.social_party_members where party_id=p_party and role='leader'),revision=revision+1,updated_at=now() where id=p_party;
      end if;
      v_result:=jsonb_build_object('ok',true,'partyId',p_party,'status','left');
    elsif p_action='travel_mode' then
      if p_payload->>'mode' not in ('grouped','split') then raise exception 'invalid_travel_mode'; end if;
      update public.social_party_members set travel_mode=p_payload->>'mode' where party_id=p_party and user_id=p_actor;
      update public.social_parties set revision=revision+1,updated_at=now() where id=p_party;
      v_result:=jsonb_build_object('ok',true,'partyId',p_party,'travelMode',p_payload->>'mode');
    elsif p_action='group_travel' then
      if v_member.role not in ('leader','officer') then raise exception 'not_party_officer'; end if;
      select * into v_route from public.world_routes where id=(p_payload->>'routeId')::uuid for update;
      if not found then raise exception 'route_not_found'; end if;
      select simulation_tick into v_tick from public.world_shards where id=v_party.shard_id for update;
      for v_world in select wp.* from public.social_party_members m join public.world_parties wp on wp.owner_user_id=m.user_id and wp.kind='player' where m.party_id=p_party and m.travel_mode='grouped' order by wp.id for update loop
        if v_anchor.id is null then v_anchor:=v_world; end if;
        if v_world.shard_id<>v_party.shard_id or v_world.region_id is distinct from v_anchor.region_id or v_world.location_id is distinct from v_route.origin_id or v_world.route_id is not null then raise exception 'party_not_assembled'; end if;
        if exists(select 1 from public.world_movement_orders where party_id=v_world.id and status in ('queued','moving')) then raise exception 'party_member_already_moving'; end if;
        if (p_payload->'expectedRevisions'->>v_world.id::text)::bigint is distinct from v_world.revision then raise exception 'stale_party_member'; end if;
        insert into public.world_movement_orders(party_id,route_id,issued_by,issued_tick,start_tick,expected_arrival_tick,status)
          values(v_world.id,v_route.id,p_actor,v_tick,v_tick,v_tick+ceil(v_route.distance/greatest(v_world.speed,0.1))::bigint,'queued');
        update public.world_parties set revision=revision+1,updated_at=now() where id=v_world.id;
        v_count:=v_count+1;
      end loop;
      if v_count<1 then raise exception 'no_grouped_members'; end if;
      v_result:=jsonb_build_object('ok',true,'partyId',p_party,'status','queued','memberCount',v_count);
    end if;
  end if;
  insert into public.social_party_requests(actor_user_id,request_id,action,payload,response) values(p_actor,p_request_id,p_action,v_payload,v_result);
  return v_result||jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.social_party_command(uuid,text,text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.social_party_command(uuid,text,text,uuid,uuid,uuid,jsonb) to service_role;

commit;
