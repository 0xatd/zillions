const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send = (res,status,body) => { res.writeHead(status,HEADERS); res.end(JSON.stringify(body)); };

async function body(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=Buffer.byteLength(chunk); if(size>4096) throw Object.assign(new Error('body_too_large'),{status:413}); chunks.push(chunk); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('invalid_json'),{status:400}); }
}
async function authenticate(authorization,config,fetchImpl) {
  if(!authorization.startsWith('Bearer ')) return null;
  const response=await fetchImpl(`${config.url}/auth/v1/user`,{headers:{authorization,apikey:config.anonKey}});
  return response.ok ? response.json() : null;
}
async function rpc(config,name,args,fetchImpl) {
  const response=await fetchImpl(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,'content-type':'application/json'},body:JSON.stringify(args)});
  const result=await response.json().catch(()=>null);
  if(!response.ok) throw Object.assign(new Error(result?.message || 'world_entry_failed'),{status:response.status===409?409:400});
  return result;
}

export function createLivingWorldEntryHandler(deps={}) {
  const fetchImpl=deps.fetch || globalThis.fetch;
  return async function handler(req,res) {
    try {
      if(req.method!=='POST') { res.setHeader('allow','POST'); return send(res,405,{ok:false,error:'method_not_allowed'}); }
      const config=deps.config || {url:process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY};
      if(!config.url || !config.anonKey || !config.serviceKey) return send(res,503,{ok:false,error:'living_world_backend_not_configured'});
      const authorization=String(req.headers.authorization || '');
      const user=deps.authenticate ? await deps.authenticate(authorization) : await authenticate(authorization,config,fetchImpl);
      if(!user?.id) return send(res,401,{ok:false,error:'sign_in_required'});
      await enforceLivingWorldRateLimit({config,actor:user.id,scope:'world:entry',limit:6,windowSeconds:300,fetchImpl,override:deps.rateLimit});
      const input=await body(req);
      if(!input || Object.keys(input).length!==1 || !UUID.test(String(input.characterId || ''))) return send(res,400,{ok:false,error:'invalid_character'});
      if(deps.complete) await deps.complete(user.id,input.characterId);
      else await rpc(config,'complete_world_tutorial_from_campaign',{p_actor:user.id,p_character:input.characterId},fetchImpl);
      const result=deps.enter ? await deps.enter(user.id,input.characterId) : await rpc(config,'enter_living_world',{p_actor:user.id,p_character:input.characterId},fetchImpl);
      return send(res,200,result);
    } catch(error) { return send(res,error?.status || 500,{ok:false,error:error?.message || 'world_entry_failed'}); }
  };
}
export default createLivingWorldEntryHandler();
import { enforceLivingWorldRateLimit } from './living-world-rate-limit.js';
