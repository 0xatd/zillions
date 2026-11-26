-- Per-sender, per-connection topics prevent identity spoofing in room traffic.
-- No reward, inventory or party membership write authority is granted.
create or replace function public.room_relay_allowed(topic text, publishing boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; rid uuid; sender uuid; recipient uuid;
begin
  parts := string_to_array(topic, ':');
  if cardinality(parts) <> 5 or parts[1] <> 'zl-link' then return false; end if;
  rid := parts[2]::uuid; sender := parts[3]::uuid; recipient := parts[4]::uuid;
  perform parts[5]::uuid;
  if auth.uid() is null then return false; end if;
  if publishing and auth.uid() <> sender then return false; end if;
  -- Realtime requires read permission even on a publish-only subscription.
  if not publishing and auth.uid() not in (sender, recipient) then return false; end if;
  return sender <> recipient and exists (
    select 1 from rooms r
    join room_players a on a.room_id=r.id and a.user_id=sender
    join room_players b on b.room_id=r.id and b.user_id=recipient
    where r.id=rid and r.status in ('open','in_game')
      and r.host_user_id in (sender, recipient)
  );
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.room_relay_allowed(text,boolean) from public, anon;
grant execute on function public.room_relay_allowed(text,boolean) to authenticated;
drop policy if exists zillions_room_relay_receive on realtime.messages;
create policy zillions_room_relay_receive on realtime.messages for select to authenticated
using (extension='broadcast' and public.room_relay_allowed(realtime.topic(),false));
drop policy if exists zillions_room_relay_publish on realtime.messages;
create policy zillions_room_relay_publish on realtime.messages for insert to authenticated
with check (extension='broadcast' and public.room_relay_allowed(realtime.topic(),true));
