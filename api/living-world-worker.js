const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const send=(res,status,value)=>{res.writeHead(status,HEADERS);res.end(JSON.stringify(value));};
async function rest(config,path,options={},fetchImpl=globalThis.fetch){const response=await fetchImpl(`${config.url}/rest/v1/${path}`,{...options,headers:{authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,'content-type':'application/json',...(options.headers||{})}});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(value?.message||'region_worker_request_failed');return value;}
async function rpc(config,name,args,fetchImpl){return rest(config,`rpc/${name}`,{method:'POST',body:JSON.stringify(args)},fetchImpl);}

export function createLivingWorldWorkerHandler(deps={}){const fetchImpl=deps.fetch||globalThis.fetch;return async(req,res)=>{try{
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('allow','GET, POST');return send(res,405,{ok:false,error:'method_not_allowed'});}
  const secret=deps.secret??process.env.CRON_SECRET;if(!secret)return send(res,503,{ok:false,error:'worker_auth_not_configured'});
  const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')||String(req.headers['x-cron-secret']||'');
  if(supplied!==secret)return send(res,401,{ok:false,error:'worker_auth_required'});
  const enabled=deps.enabled??process.env.LIVING_WORLD_RUNTIME_ENABLED==='1';
  if(!enabled)return send(res,200,{ok:true,status:'inactive',regions:[]});
  const config=deps.config||{url:process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY};
  if(!config.url||!config.serviceKey)return send(res,503,{ok:false,error:'living_world_backend_not_configured'});
  // Every invocation needs a distinct lease identity. Reused regional IDs let
  // overlapping cron deliveries share one epoch and double-advance regions.
  const invocationId=deps.invocationId||globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workerId=deps.workerId||`vercel-region-runtime:${process.env.VERCEL_REGION||'unknown'}:${invocationId}`;
  // A production invocation must cover the full pinned Earth (72 regions).
  // The database still orders oldest regions first, and the cap protects later
  // procedural planets from unbounded work in one serverless invocation.
  const regionLimit=Math.max(1,Math.min(96,Number(deps.regionLimit??process.env.LIVING_WORLD_REGION_BATCH_SIZE??72)||72));
  const regions=deps.regions?await deps.regions(regionLimit):await rpc(config,'living_world_region_runtime_batch',{p_limit:regionLimit},fetchImpl);
  const results=new Array(regions.length),concurrency=Math.max(1,Math.min(12,Number(deps.concurrency??process.env.LIVING_WORLD_WORKER_CONCURRENCY??8)||8));let cursor=0;
  const processOne=async(index)=>{const region=regions[index];let leaseEpoch=0,started=performance.now();try{const lease=deps.claim?await deps.claim(region.region_id,workerId):await rpc(config,'claim_world_region_lease',{p_region:region.region_id,p_worker:workerId,p_lease_seconds:45},fetchImpl);if(lease?.ok===false||lease?.status==='lease_held'){results[index]={regionId:region.region_id,status:'lease_held'};return;}leaseEpoch=Number(lease.leaseEpoch);const result=deps.process?await deps.process(region.region_id,workerId,leaseEpoch):await rpc(config,'process_world_region_runtime',{p_region:region.region_id,p_worker:workerId,p_lease_epoch:leaseEpoch,p_command_limit:100},fetchImpl);const duration=Math.max(0,performance.now()-started);const saturated=Number(result?.population?.present)>Number(result.actionBudget)&&Number(result?.factions?.processed)>=Number(result.actionBudget);const record=deps.record?await deps.record(region.region_id,result.tick,workerId,leaseEpoch,duration,true,null,result.actionBudget,saturated):await rpc(config,'record_world_region_runtime_health',{p_region:region.region_id,p_world_tick:result.tick,p_worker:workerId,p_lease_epoch:leaseEpoch,p_duration_ms:duration,p_success:true,p_error_code:null,p_action_budget:result.actionBudget,p_action_saturated:saturated},fetchImpl);results[index]={regionId:region.region_id,status:'advanced',result,health:record};}catch(error){const duration=Math.max(0,performance.now()-started);try{if(leaseEpoch>0){if(deps.record)await deps.record(region.region_id,0,workerId,leaseEpoch,duration,false,'region_runtime_failed',0,false);else await rpc(config,'record_world_region_runtime_health',{p_region:region.region_id,p_world_tick:0,p_worker:workerId,p_lease_epoch:leaseEpoch,p_duration_ms:duration,p_success:false,p_error_code:'region_runtime_failed',p_action_budget:0,p_action_saturated:false},fetchImpl);}}catch{}results[index]={regionId:region.region_id,status:'failed',error:error.message};}};
  await Promise.all(Array.from({length:Math.min(concurrency,regions.length)},async()=>{while(true){const index=cursor++;if(index>=regions.length)return;await processOne(index);}}));
  return send(res,results.some(row=>row.status==='failed')?207:200,{ok:!results.some(row=>row.status==='failed'),workerId,batchLimit:regionLimit,concurrency,regions:results});
}catch(error){return send(res,500,{ok:false,error:error.message||'region_worker_failed'});}};}
export default createLivingWorldWorkerHandler();
