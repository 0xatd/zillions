const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const send=(res,status,value)=>{res.writeHead(status,HEADERS);res.end(JSON.stringify(value));};
async function rest(config,path,options={},fetchImpl=globalThis.fetch){const response=await fetchImpl(`${config.url}/rest/v1/${path}`,{...options,headers:{authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,'content-type':'application/json',...(options.headers||{})}});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(value?.message||'region_worker_request_failed');return value;}
async function rpc(config,name,args,fetchImpl){return rest(config,`rpc/${name}`,{method:'POST',body:JSON.stringify(args)},fetchImpl);}

export function createLivingWorldWorkerHandler(deps={}){const fetchImpl=deps.fetch||globalThis.fetch;return async(req,res)=>{try{
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('allow','GET, POST');return send(res,405,{ok:false,error:'method_not_allowed'});}
  const secret=deps.secret??process.env.CRON_SECRET;if(!secret)return send(res,503,{ok:false,error:'worker_auth_not_configured'});
  const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')||String(req.headers['x-cron-secret']||'');
  if(supplied!==secret)return send(res,401,{ok:false,error:'worker_auth_required'});
  const config=deps.config||{url:process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY};
  if(!config.url||!config.serviceKey)return send(res,503,{ok:false,error:'living_world_backend_not_configured'});
  const workerId=deps.workerId||`vercel-region-runtime:${process.env.VERCEL_REGION||'unknown'}`;
  const regions=deps.regions?await deps.regions():await rest(config,'world_region_states?select=region_id&status=eq.active&order=region_id',{},fetchImpl);
  const results=[];
  for(const region of regions){try{const lease=deps.claim?await deps.claim(region.region_id,workerId):await rpc(config,'claim_world_region_lease',{p_region:region.region_id,p_worker:workerId,p_lease_seconds:55},fetchImpl);if(lease?.ok===false||lease?.status==='lease_held'){results.push({regionId:region.region_id,status:'lease_held'});continue;}const result=deps.process?await deps.process(region.region_id,workerId,lease.leaseEpoch):await rpc(config,'process_world_region_runtime',{p_region:region.region_id,p_worker:workerId,p_lease_epoch:lease.leaseEpoch,p_command_limit:100},fetchImpl);results.push({regionId:region.region_id,status:'advanced',result});}catch(error){results.push({regionId:region.region_id,status:'failed',error:error.message});}}
  return send(res,results.some(row=>row.status==='failed')?207:200,{ok:!results.some(row=>row.status==='failed'),workerId,regions:results});
}catch(error){return send(res,500,{ok:false,error:error.message||'region_worker_failed'});}};}
export default createLivingWorldWorkerHandler();
