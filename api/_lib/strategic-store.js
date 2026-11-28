const failure=(code,status=400)=>Object.assign(new Error(code),{status});
export function strategicStore({url,serviceKey,fetchImpl=fetch}){
 const headers={authorization:`Bearer ${serviceKey}`,apikey:serviceKey,'content-type':'application/json'};
 const request=async(path,body)=>{
  const response=await fetchImpl(`${url}/rest/v1/${path}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw failure(data?.message||'world_service_unavailable',response.status>=500?503:409);
  return data;
 };
 return {
  async context(actor,clientId){
   const [characters,stats,profiles]=await Promise.all([
    request(`game_characters?select=id,name&user_id=eq.${actor}&client_character_id=eq.${encodeURIComponent(clientId)}&limit=1`),
    request(`player_stats?select=campaign_cleared&user_id=eq.${actor}&limit=1`),
    request(`profiles?select=handle&id=eq.${actor}&limit=1`),
   ]);
   if(!characters?.[0])throw failure('character_not_found',404);
   const membership=await request(`friend_party_members?select=party_id&user_id=eq.${actor}&limit=1`);
   const members=membership[0]?await request(`friend_party_members?select=user_id&party_id=eq.${membership[0].party_id}`):[];
   return {allies:members.map(m=>m.user_id),character:characters[0].id,name:profiles[0]?.handle||characters[0].name,campaignCleared:stats[0]?.campaign_cleared||0};
  },
  async room(actor,id){
   if(typeof id!=='string'||! /^[0-9a-f-]{36}$/i.test(id))throw failure('invalid_encounter_room');
   const rooms=await request(`rooms?select=id,code,host_user_id,metadata,status&id=eq.${id}&limit=1`);
   const room=rooms[0];if(!room||room.host_user_id!==actor||!['open','starting'].includes(room.status))throw failure('invalid_encounter_room');
   const members=await request(`room_players?select=user_id&room_id=eq.${id}`);
   return {id,code:room.code,host:actor,level:room.metadata?.level||1,mode:room.metadata?.mode||'campaign',members:members.map(m=>m.user_id)};
  },
  async load(){const rows=await request('strategic_realms?select=state,revision&id=eq.sol-frontier&limit=1');if(!rows?.[0])throw failure('world_not_configured',503);return rows[0];},
  async receipt(actor,id){if(!id)return null;return (await request(`strategic_requests?select=response&actor=eq.${actor}&request_id=eq.${encodeURIComponent(id)}&limit=1`))[0]?.response||null;},
  commit:args=>request('rpc/strategic_commit',args),
  async acceptedBattle(actor,character,encounter){
   const links=await request(`strategic_match_links?select=ticket_id,starting_troops&actor=eq.${actor}&character_id=eq.${character}&encounter_id=eq.${encodeURIComponent(encounter)}&limit=1`);
   if(!links[0])throw failure('encounter_ticket_missing',409);
   const reports=await request(`match_reports?select=report&user_id=eq.${actor}&ticket_id=eq.${links[0].ticket_id}&limit=1`);
   if(!reports[0])throw failure('battle_report_pending',409);
   return {won:!!reports[0].report?.won,troopsLost:Math.min(links[0].starting_troops,Math.max(0,Number(reports[0].report?.expeditionLosses)||0))};
  },
 };
}
