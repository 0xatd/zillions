import {newWorld,joinWorld,commandWorld,settleWorldBattle,worldView} from '../src/strategic-world.js';
import {strategicStore} from './_lib/strategic-store.js';
const ACTIONS=new Set(['enter','snapshot','move','stop','recruit','siege','intercept','retreat','battle','resolve','join','room','surrender']);
const error=(code,status=400)=>Object.assign(new Error(code),{status});
export async function processWorld({actor,body,store,now=Date.now()}){
 if(!actor)throw error('sign_in_required',401);
 const action=body?.action;if(!ACTIONS.has(action))throw error('invalid_world_action');
 if(typeof body.characterId!=='string'||body.characterId.length>96)throw error('invalid_character');
 const read=['enter','snapshot'].includes(action);
 const requestId=read?null:body.requestId;
 if(!read&&(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,96}$/.test(requestId)))throw error('invalid_request_id');
 const context=await store.context(actor,body.characterId);
 const receipt=await store.receipt(actor,requestId);
 if(receipt){const current=await store.load();return {ok:true,...receipt,duplicate:true,world:worldView(current.state,actor,context.character)};}
 const room=action==='room'?await store.room(actor,body.target?.id):null;
 const accepted=action==='resolve'?await store.acceptedBattle(actor,context.character,body.encounter):null;
 for(let attempt=0;attempt<16;attempt++){
  const current=await store.load();const clock=Math.max(now,current.state?.at||0);
  let state=current.state||newWorld(clock),charge=0,result={};
  if(action==='enter')state=joinWorld(state,{actor,character:context.character,name:context.name},clock);
  else if(action==='resolve')state=settleWorldBattle(state,{actor,character:context.character,encounter:body.encounter,...accepted,now:clock});
  else ({state,charge,result}=commandWorld(state,{actor,character:context.character,action,target:body.target,now:clock,campaignCleared:context.campaignCleared,allies:context.allies,room}));
  try{
   const committed=await store.commit({p_actor:actor,p_character:context.character,p_revision:current.revision,p_state:state,p_request_id:requestId,p_charge:charge,p_result:result});
   if(committed.duplicate)state=(await store.load()).state;
   return {ok:true,...committed,world:worldView(state,actor,context.character)};
  }catch(e){if(e.message!=='world_revision_conflict'||attempt===15)throw e;await new Promise(resolve=>setTimeout(resolve,10+Math.floor(Math.random()*Math.min(250,20*(attempt+1)))));}
 }
}
export default async function handler(req,res){
 const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
 if(req.method!=='POST'){res.setHeader('allow','POST');return send(405,{ok:false,error:'method_not_allowed'});}
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_ANON_KEY;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anon||!serviceKey)throw error('world_not_configured',503);
  const authorization=String(req.headers.authorization||'');if(!authorization.startsWith('Bearer '))throw error('sign_in_required',401);
  const userResponse=await fetch(`${url}/auth/v1/user`,{headers:{authorization,apikey:anon}});const user=userResponse.ok?await userResponse.json():null;if(!user?.id)throw error('sign_in_required',401);
  let body=req.body;
  if(!body||typeof body!=='object'){const chunks=[];let length=0;for await(const chunk of req){length+=Buffer.byteLength(chunk);if(length>8192)throw error('body_too_large',413);chunks.push(Buffer.from(chunk));}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('invalid_json');}}
  const answer=await processWorld({actor:user.id,body,store:strategicStore({url,serviceKey})});return send(200,answer);
 }catch(e){const known=/^(sign_in_required|world_|fleet_|arrival_|campaign_|encounter_|invalid_|character_|army_|out_of_range|not_retreatable|battle_report_|insufficient_alloy|unauthorized_ownership)/.test(e.message||'');return send(e.status||409,{ok:false,error:known?e.message:'world_service_unavailable'});}
}
