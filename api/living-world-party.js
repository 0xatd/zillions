const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const BODY_LIMIT = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['create','invite','accept','decline','revoke','leave','travel_mode','group_travel']);
const KEYS = new Set(['requestId','action','partyId','targetId','inviteId','payload']);
const PAYLOAD_KEYS = { create: ['name','shardId'], travel_mode: ['mode'], group_travel: ['routeId','expectedRevisions'] };
const send = (res,status,body) => { res.writeHead(status,JSON_HEADERS); res.end(JSON.stringify(body)); };
async function parseBody(req) { const chunks=[]; let size=0; for await(const chunk of req){ size+=Buffer.byteLength(chunk); if(size>BODY_LIMIT) throw Object.assign(new Error('body_too_large'),{status:413}); chunks.push(Buffer.from(chunk)); } try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{throw Object.assign(new Error('invalid_json'),{status:400});} }
async function authenticate(authorization,config,fetchImpl){ if(!authorization.startsWith('Bearer ')) return null; const response=await fetchImpl(`${config.url}/auth/v1/user`,{headers:{authorization,apikey:config.anonKey}}); return response.ok?response.json():null; }
async function rpc(config,name,args,fetchImpl){ const response=await fetchImpl(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,'content-type':'application/json'},body:JSON.stringify(args)}); const result=await response.json().catch(()=>null); if(!response.ok) throw Object.assign(new Error(result?.message||'party_command_failed'),{status:response.status===409?409:400}); return result; }
export function validatePartyBody(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some((key)=>!KEYS.has(key))) throw Object.assign(new Error('invalid_party_command'),{status:400});
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9:_-]{1,96}$/.test(body.requestId)||!ACTIONS.has(body.action)) throw Object.assign(new Error('invalid_party_command'),{status:400});
  for(const key of ['partyId','targetId','inviteId']) if(body[key]!=null&&!UUID.test(body[key])) throw Object.assign(new Error(`invalid_${key}`),{status:400});
  const payload=body.payload??{}; if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw Object.assign(new Error('invalid_payload'),{status:400});
  const allowed=PAYLOAD_KEYS[body.action]||[]; if(Object.keys(payload).some((key)=>!allowed.includes(key))) throw Object.assign(new Error('unsupported_payload_field'),{status:400});
  if(body.action==='travel_mode'&&!['grouped','split'].includes(payload.mode)) throw Object.assign(new Error('invalid_travel_mode'),{status:400});
  if(body.action==='group_travel'&&(!UUID.test(payload.routeId)||!payload.expectedRevisions||typeof payload.expectedRevisions!=='object'||Array.isArray(payload.expectedRevisions))) throw Object.assign(new Error('invalid_group_travel'),{status:400});
  if(Object.keys(payload.expectedRevisions||{}).some((id)=>!UUID.test(id)||!Number.isSafeInteger(payload.expectedRevisions[id])||payload.expectedRevisions[id]<1)) throw Object.assign(new Error('invalid_expected_revisions'),{status:400});
  return { requestId:body.requestId,action:body.action,partyId:body.partyId||null,targetId:body.targetId||null,inviteId:body.inviteId||null,payload };
}
export function createLivingWorldPartyHandler(deps={}){
  const fetchImpl=deps.fetch||globalThis.fetch;
  return async function handler(req,res){ try{
    if(!['GET','POST'].includes(req.method)){res.setHeader('allow','GET, POST');return send(res,405,{ok:false,error:'method_not_allowed'});}
    const config=deps.config||{url:process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_ANON_KEY,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY};
    if(!config.url||!config.anonKey||!config.serviceKey)return send(res,503,{ok:false,error:'living_world_backend_not_configured'});
    const authorization=String(req.headers.authorization||''); const user=deps.authenticate?await deps.authenticate(authorization):await authenticate(authorization,config,fetchImpl);
    if(!user?.id)return send(res,401,{ok:false,error:'sign_in_required'});
    if(req.method==='GET'){const snapshot=deps.snapshot?await deps.snapshot(user.id):await rpc(config,'social_party_snapshot',{p_actor:user.id},fetchImpl);return send(res,200,{ok:true,party:snapshot});}
    const command=validatePartyBody(await parseBody(req));
    const result=deps.command?await deps.command(user.id,command):await rpc(config,'social_party_command',{p_actor:user.id,p_request_id:command.requestId,p_action:command.action,p_party:command.partyId,p_target:command.targetId,p_invite:command.inviteId,p_payload:command.payload},fetchImpl);
    return send(res,200,result);
  }catch(error){return send(res,error?.status||500,{ok:false,error:error?.message||'party_backend_error'});} };
}
export default createLivingWorldPartyHandler();
