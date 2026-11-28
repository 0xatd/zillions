// Shared-world rules. Executed by the authority; rendering may interpolate but
// never commits player positions. No browser clock, random source or DOM here.
export const WORLD_VERSION = 1;
export const WORLD_LIMITS = Object.freeze({width:1000,height:700,travelLeaseMs:30000,contactRadius:18,portRadius:28,armyCap:40});
export const WORLD_PORTS = Object.freeze([
 {id:'greenfall',name:'Greenfall',x:160,z:350,color:'#69a58c',level:1,role:'Landing colony'},
 {id:'rotmire',name:'Rotmire',x:390,z:170,color:'#799e76',level:2,role:'Agricultural colony'},
 {id:'cinder',name:'Cinder',x:650,z:160,color:'#c18059',level:3,role:'Industrial colony'},
 {id:'barrow',name:'Barrow',x:430,z:540,color:'#8597b1',level:4,role:'Frontier garrison'},
 {id:'blackvale',name:'Black Vale',x:820,z:440,color:'#956d99',level:5,role:'Hive stronghold'},
]);
const NPCS=[
 {id:'trader-west',name:'Meridian convoy',kind:'trader',route:['greenfall','rotmire'],speed:20,troops:14},
 {id:'trader-east',name:'Cinder hauler',kind:'trader',route:['cinder','barrow'],speed:17,troops:8},
 {id:'patrol',name:'Frontier patrol',kind:'patrol',route:['greenfall','barrow'],speed:26,troops:24},
 {id:'raiders',name:'Ash raiders',kind:'hostile',route:['cinder','blackvale'],speed:31,troops:12},
];
const clone=value=>structuredClone(value);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const port=id=>WORLD_PORTS.find(p=>p.id===id);
const fault=code=>{throw Object.assign(new Error(code),{code});};
const bounded=n=>Number.isFinite(n)&&n>=0;
export function newWorld(now){
 return {v:WORLD_VERSION,realm:'sol-frontier',at:now,nextEncounter:1,fleets:NPCS.map(n=>({...n,owner:null,x:port(n.route[0]).x,z:port(n.route[0]).z,target:clone(port(n.route[1])),routeIndex:1,encounter:null})),encounters:[]};
}
export function ownedFleet(state,actor,character){return state.fleets.find(f=>f.owner===actor&&f.character===character);}
export function arrivedPort(fleet){return WORLD_PORTS.find(p=>!fleet.target&&distance(fleet,p)<=WORLD_LIMITS.portRadius)||null;}
export function joinWorld(state,{actor,character,name},now){
 if(!actor||!character)fault('invalid_character');
 const s=advanceWorld(state,now);let fleet=ownedFleet(s,actor,character);
 if(!fleet){
  if(s.fleets.filter(f=>f.owner).length>=256)fault('realm_full');
  fleet={id:`player:${character}`,owner:actor,character,name:String(name||'Commander').slice(0,40),kind:'player',x:160,z:350,target:null,speed:38,troops:4,seen:now,encounter:null};
  // Character is the authoritative UUID, not an account-local display key.
  s.fleets.push(fleet);
 }
 fleet.seen=now;return s;
}
function move(f,dt){
 if(!f.target||f.encounter)return;
 const d=distance(f,f.target),step=Math.min(d,f.speed*dt);
 if(d>0){f.x+=(f.target.x-f.x)*step/d;f.z+=(f.target.z-f.z)*step/d;}
 if(d<=step+.00001)f.target=null;
}
// Closest approach between both swept trajectories: fast ships cannot pass
// through each other between authority requests and evade an encounter.
function contact(a0,a1,b0,b1){
 const x=a0.x-b0.x,z=a0.z-b0.z,dx=(a1.x-a0.x)-(b1.x-b0.x),dz=(a1.z-a0.z)-(b1.z-b0.z);
 const t=Math.max(0,Math.min(1,-(x*dx+z*dz)/(dx*dx+dz*dz||1)));
 return Math.hypot(x+t*dx,z+t*dz)<=WORLD_LIMITS.contactRadius;
}
function beginEncounter(s,player,npc,now){
 const id=`encounter-${s.nextEncounter++}`;
 const encounter={id,kind:'fleet',level:1,participants:[player.id],opponent:npc.id,status:'pending',at:now,x:player.x,z:player.z};
 player.target=null;player.encounter=id;npc.target=null;npc.encounter=id;s.encounters.push(encounter);
 return encounter;
}
export function advanceWorld(state,now){
 if(!Number.isFinite(now)||now<state.at)fault('invalid_server_time');
 const s=clone(state);
 // No clients present: there is no need to replay months of patrol simulation.
 // Player autopilot expires after its lease; only the final 30 seconds of NPC
 // motion matter once every player has been absent longer than that lease.
 let start=s.at;
 const latestLease=Math.max(s.at,...s.fleets.filter(f=>f.owner).map(f=>f.seen+WORLD_LIMITS.travelLeaseMs));
 const end=Math.min(now,Math.max(start+30000,latestLease));
 for(let t=start;t<end;){
  const dt=Math.min(500,end-t)/1000;t+=dt*1000;
  const previous=new Map(s.fleets.map(f=>[f.id,{x:f.x,z:f.z}]));
  for(const f of s.fleets){
   if(f.owner){if(t>f.seen+WORLD_LIMITS.travelLeaseMs){f.target=null;continue;}}
   else if(!f.encounter){
    if(f.respawnAt){if(t<f.respawnAt)continue;f.respawnAt=null;f.troops=NPCS.find(n=>n.id===f.id)?.troops||12;}
    const prey=f.kind==='hostile'?s.fleets.filter(p=>p.owner&&!p.encounter&&t<=p.seen+WORLD_LIMITS.travelLeaseMs&&(!p.safeUntil||p.safeUntil<t)&&distance(f,p)<130&&!arrivedPort(p)).sort((a,b)=>distance(f,a)-distance(f,b))[0]:null;
    if(prey)f.target={x:prey.x,z:prey.z};
    else if(!f.target){f.routeIndex=(f.routeIndex+1)%f.route.length;const goal=port(f.route[f.routeIndex]);f.target={x:goal.x,z:goal.z};}
   }
   move(f,dt);
  }
  for(const npc of s.fleets.filter(f=>f.kind==='hostile'&&!f.encounter&&!f.respawnAt)){
   for(const player of s.fleets.filter(f=>f.owner&&!f.encounter&&t<=f.seen+WORLD_LIMITS.travelLeaseMs&&(!f.safeUntil||f.safeUntil<t)&&!arrivedPort(f))){
    if(contact(previous.get(player.id),player,previous.get(npc.id),npc)){beginEncounter(s,player,npc,t);break;}
   }
  }
 }
 s.at=now;
 // Pending decisions time out without changing armies or granting rewards.
 for(const e of s.encounters.filter(e=>e.status==='pending'&&now-e.at>300000))releaseEncounter(s,e,'expired',now);
 for(const e of s.encounters.filter(e=>e.status==='battle'&&now-(e.startedAt||e.at)>48*3600000)){for(const f of s.fleets.filter(f=>f.owner&&f.encounter===e.id)){f.troops=0;f.x=WORLD_PORTS[0].x;f.z=WORLD_PORTS[0].z;}releaseEncounter(s,e,'lost',now);}
 // Completed encounters are retained for retry settlement, then compacted.
 s.encounters=s.encounters.filter(e=>['pending','battle'].includes(e.status)||now-e.at<7*86400000);
 return s;
}
function releaseEncounter(s,e,status,now){e.status=status;const opponent=s.fleets.find(f=>f.id===e.opponent);if(status==='won'&&opponent){opponent.troops=0;opponent.respawnAt=now+120000;opponent.target=null;}for(const f of s.fleets)if(f.encounter===e.id){f.encounter=null;f.safeUntil=now+15000;}}
export function commandWorld(state,{actor,character,action,target,now,campaignCleared=0,allies=[],room=null}){
 const s=advanceWorld(state,now),f=ownedFleet(s,actor,character);if(!f)fault('fleet_not_found');f.seen=now;
 let charge=0,result={};
 if(action==='snapshot')return {state:s,charge,result};
 if(f.encounter&&!['retreat','battle','resolve','room','surrender'].includes(action))fault('encounter_pending');
 if(action==='move'){
  if(!bounded(target?.x)||!bounded(target?.z)||target.x>WORLD_LIMITS.width||target.z>WORLD_LIMITS.height)fault('invalid_destination');
  f.target={x:target.x,z:target.z};
 }else if(action==='stop'){f.target=null;}
 else if(action==='recruit'){
  if(!arrivedPort(f))fault('arrival_required');
  if(f.troops>=WORLD_LIMITS.armyCap)fault('army_full');
  charge=12;f.troops++;result={recruited:1};
 }else if(action==='siege'){
  const p=arrivedPort(f);if(!p)fault('arrival_required');if(p.level>campaignCleared+1)fault('campaign_locked');
  const id=`encounter-${s.nextEncounter++}`;const e={id,kind:'siege',level:p.level,port:p.id,participants:[f.id],status:'pending',at:now,x:f.x,z:f.z};s.encounters.push(e);f.encounter=id;result={encounter:id};
 }else if(action==='intercept'){
  const other=s.fleets.find(x=>x.id===target?.id);if(!other||other.id===f.id)fault('fleet_not_found');
  if(distance(f,other)>WORLD_LIMITS.contactRadius)fault('out_of_range');
  if(other.kind==='hostile'){if(other.encounter)fault('encounter_reserved');result={encounter:beginEncounter(s,f,other,now).id};}
  else result={contact:{id:other.id,name:other.name,kind:other.kind,troops:other.troops}};
 }else if(action==='join'){
  const e=s.encounters.find(e=>e.id===target?.encounter),leader=e&&s.fleets.find(x=>x.id===e.participants[0]);
  if(!e||e.status!=='pending'||!leader)fault('encounter_not_joinable');
  if(!allies.includes(leader.owner))fault('encounter_party_required');
  if(distance(f,e)>WORLD_LIMITS.portRadius)fault('out_of_range');
  if(e.participants.length>=4)fault('encounter_full');
  if(e.level>campaignCleared+1)fault('campaign_locked');
  e.participants.push(f.id);f.encounter=e.id;f.target=null;result={encounter:e.id};
 }else if(action==='room'){
  const e=s.encounters.find(e=>e.id===f.encounter);
  if(!e||e.status!=='pending'||e.participants[0]!==f.id)fault('encounter_leader_required');
  if(!room||room.host!==actor||room.level!==e.level||room.mode!=='campaign')fault('invalid_encounter_room');
  const actors=target?.actors||[actor];
  if(!Array.isArray(actors)||!actors.length||actors.length>4||new Set(actors).size!==actors.length||actors[0]!==actor)fault('invalid_encounter_seats');
  const seats=actors.map(a=>s.fleets.find(x=>x.owner===a&&e.participants.includes(x.id)));
  if(seats.some((x,i)=>!x||!room.members.includes(actors[i])))fault('encounter_member_missing');
  e.room={id:room.id,code:room.code};e.seats=seats.map(x=>x.id);result={encounter:e.id,army:seats.map(x=>x.troops)};
 }else if(action==='surrender'){
  const e=s.encounters.find(e=>e.id===f.encounter);if(!e||e.status!=='battle')fault('encounter_not_started');
  f.troops=0;f.x=WORLD_PORTS[0].x;f.z=WORLD_PORTS[0].z;f.target=null;f.encounter=null;f.safeUntil=now+15000;
  e.outcomes={...e.outcomes,[f.id]:'surrendered'};
  if(e.participants.every(id=>e.outcomes[id]))releaseEncounter(s,e,'lost',now);
  result={surrendered:true};
 }else if(action==='retreat'){
  const e=s.encounters.find(e=>e.id===f.encounter);if(!e||e.status!=='pending')fault('not_retreatable');
  if(e.participants[0]===f.id)releaseEncounter(s,e,'retreated',now);
  else {e.participants=e.participants.filter(id=>id!==f.id);e.seats=e.seats?.filter(id=>id!==f.id);f.encounter=null;f.safeUntil=now+15000;}result={retreated:true};
 }else if(action==='battle'){
  const e=s.encounters.find(e=>e.id===f.encounter);if(!e||!['pending','battle'].includes(e.status))fault('encounter_not_found');
  result={encounter:e.id,level:e.level,troops:f.troops};
 }else fault('invalid_world_action');
 return {state:s,charge,result};
}
// Called only with an accepted matching match report, never client outcome data.
export function settleWorldBattle(state,{actor,character,encounter,won,troopsLost,now}){
 const s=advanceWorld(state,now),f=ownedFleet(s,actor,character),e=s.encounters.find(e=>e.id===encounter);
 if(!f||!e||!e.participants.includes(f.id))fault('encounter_not_found');
 if(['won','lost'].includes(e.status)||e.outcomes?.[f.id])return s;
 if(e.status!=='battle'||f.encounter!==e.id)fault('encounter_not_started');
 const loss=won?Math.min(f.troops,Math.max(0,Math.floor(troopsLost||0))):f.troops;
 f.troops-=loss;f.encounter=null;f.safeUntil=now+15000;f.seen=now;
 e.outcomes={...e.outcomes,[f.id]:won?'won':'lost'};
 if(e.participants.every(id=>e.outcomes[id]))releaseEncounter(s,e,Object.values(e.outcomes).includes('won')?'won':'lost',now);
 if(!won){f.x=WORLD_PORTS[0].x;f.z=WORLD_PORTS[0].z;}
 return s;
}
export function worldView(state,actor,character){
 const own=ownedFleet(state,actor,character);
 return {v:state.v,realm:state.realm,at:state.at,ports:WORLD_PORTS,self:own?.id||null,
  fleets:state.fleets.filter(f=>!f.respawnAt).map(({owner,character,seen,...f})=>({...f,mine:owner===actor&&character===own?.character,online:!owner||state.at-seen<WORLD_LIMITS.travelLeaseMs})),
  encounters:state.encounters.filter(e=>e.status==='pending').map(e=>({id:e.id,x:e.x,z:e.z,participants:e.participants,room:e.room||null})),
  encounter:state.encounters.find(e=>e.id===own?.encounter)||null};
}
