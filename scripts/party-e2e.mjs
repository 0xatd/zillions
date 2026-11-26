// Opt-in real-account party lifecycle. Use candidate API handlers and live Supabase.
// No fabricated results: the siege runs to defeat before the same group starts again.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,appendFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('This creates disposable live QA accounts. Run explicitly with --live and --url pointing at the candidate API server.');
const transportOnly=process.argv.includes('--transport-only');
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY'])assert.ok(process.env[key],key+' required');
const out=process.env.ZILLIONS_PARTY_QA_DIR||await mkdtemp(join(tmpdir(),'zillions-party-journey-'));await mkdir(out,{recursive:true});
const base=process.argv[process.argv.indexOf('--url')+1];assert.match(base,/^https?:\/\//);
const url=process.env.SUPABASE_URL,service=process.env.SUPABASE_SERVICE_ROLE_KEY,anon=process.env.SUPABASE_ANON_KEY;
const headers={apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'};
const users=[];let browser;const log=async(event,data={})=>{console.log(event,JSON.stringify(data));await appendFile(out+'/live-events.jsonl',JSON.stringify({at:new Date().toISOString(),event,...data})+'\n');};
async function api(path,opts={}){const r=await fetch(url+path,{...opts,headers:{...headers,...opts.headers}});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(`QA API ${r.status} ${path.split('?')[0]}`);return data;}
async function prepare(role){
 const password=`A9!${randomUUID()}`,email=`zillions-party-${Date.now()}-${role}@example.com`,handle=`zp_${role}_${Date.now().toString(36)}`;
 const u=await api('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true})});users.push({id:u.id,email,role});
 await writeFile(out+'/qa-registry.json',JSON.stringify(users),{mode:0o600});
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>console.log('browser error',role,e.message));page.on('console',m=>{if(m.type()==='error')console.log('console error',role,m.text().slice(0,180));});
 await page.addInitScript(()=>{localStorage.setItem('zillions_settings',JSON.stringify({quality:'low',sfx:false}));window.RTCPeerConnection=function(){throw Error('RTC blocked for relay proof');};});
 await page.goto(base+'/?backend=1',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__app?.auth?.ready,null,{timeout:60000});
 if(transportOnly)await page.evaluate(()=>{__app.renderer.render=()=>{};});
 const signed=await page.evaluate(async({email,password})=>{const r=await __app.auth.client.auth.signInWithPassword({email,password});return !r.error;},{email,password});assert.ok(signed);
 await page.waitForFunction(()=>__app.authStatus.signedIn,null,{timeout:60000});
 await page.evaluate(handle=>__app._claimUsername(handle),handle);
 await page.waitForFunction(()=>!__app.authStatus.needsUsername,null,{timeout:60000});
 await page.evaluate(async(role)=>{const a=__app;if(!a.profile.mmoCharacters?.length)a._createMmoCharacter({name:'QA '+role,classKey:'vanguard'});await a._selectMmoCharacter(a.profile.mmoCharacters[0].id);a.ui._showScreen('main');await a._openLobby();},role);
 await log('account-ready',{role});return {page,context,id:u.id};
}
try{
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const host=await prepare('host'),guest=await prepare('guest');const h=host.page,g=guest.page;
 await h.locator('#m-party').click();await h.getByRole('button',{name:'CREATE PARTY',exact:true}).click();
 await h.waitForFunction(()=>document.querySelector('.party-invite input'));
 const link=await h.locator('.party-invite input').inputValue(),code=new URL(link).searchParams.get('party');assert.equal(code.length,10);
 await g.locator('#m-party').click();await g.locator('[name="party-code"]').fill(code);await g.getByRole('button',{name:'JOIN PARTY',exact:true}).click();
 await g.waitForFunction(()=>document.querySelectorAll('.party-roster li').length===2);await h.waitForFunction(()=>document.querySelectorAll('.party-roster li').length===2);
 await log('real-party-create-join',{members:2});
 const denied=await g.evaluate(async()=>{const r=await __app.auth.client.rpc('friend_party_action',{p_action:'lead',p_user:__app.lobby.me.id});return r.error?.message;});assert.match(denied,/leader_only/);
 await h.getByRole('button',{name:'HOST NEXT MATCH',exact:true}).click();await h.waitForFunction(()=>__app.lobby?.game?.id).catch(async e=>{console.log('host room failure',await h.locator('body').innerText());throw e;});await log('host-room-created');
 await g.getByRole('button',{name:'OPEN PARTY ROOM',exact:true}).click().catch(async e=>{console.log('guest room missing',await g.locator('body').innerText());throw e;});await g.waitForFunction(()=>__app.net?.open,null,{timeout:60000});assert.equal(await g.evaluate(()=>__app.net.relay),true);
 assert.equal(await h.locator('#s-start').isDisabled(),true);
 await g.locator('#room-ready').click();await h.waitForFunction(()=>!document.querySelector('#s-start').disabled);
 await log('party-room-ready-transport');
 // End staging, then prove the persistent group reopens a second room.
 await g.evaluate(()=>__app._leaveOnlineRoom());await h.evaluate(()=>__app._leaveOnlineRoom());
 for(const p of [h,g])await p.evaluate(()=>__app.ui._showScreen('main'));
 await h.locator('#m-party').click();await h.getByRole('button',{name:'HOST NEXT MATCH',exact:true}).click();
 await g.locator('#m-party').click();await g.getByRole('button',{name:'OPEN PARTY ROOM',exact:true}).click().catch(async e=>{console.log('guest room missing',await g.locator('body').innerText());throw e;});await g.waitForFunction(()=>__app.net?.open,null,{timeout:60000});assert.equal(await g.evaluate(()=>__app.net.relay),true);
 await g.locator('#room-ready').click();await h.waitForFunction(()=>!document.querySelector('#s-start').disabled);
 await log('next-room-same-party');
 await h.locator('#s-start').click();
 for(const p of [h,g])await p.waitForFunction(()=>__app.netMode&&__app.game&&__app._match?.ticket,null,{timeout:120000});
 if(transportOnly)for(const p of [h,g])await p.evaluate(()=>{__app.renderer.setAnimationLoop(null);window.__qaFrame=setInterval(()=>__app.frame(),200);});
 await h.waitForFunction(()=>!__app.startBarrier&&__app.simFrame>100,null,{timeout:60000});
 await g.waitForFunction(()=>__app._match?.ticket&&!__app._resyncing&&!__app.desynced,null,{timeout:60000});
 const snap=await g.evaluate(()=>({frame:__app.simFrame,ticket:!!__app._match.ticket,desynced:__app.desynced}));assert.ok(snap.ticket&&!snap.desynced);
 await g.evaluate(()=>__app.net.destroy());await g.waitForFunction(()=>__app.net?.open&&__app.simFrame>200&&!__app.desynced,null,{timeout:60000});
 await log('party-match-start-reconnect');
 // Play the siege to a real defeat; do not manufacture a room/result row.
 await h.evaluate(()=>__app.issue({t:'found',s:0,p:0}));
 await h.waitForFunction(()=>__app.game.phase==='live');
 await h.evaluate(()=>{const a=__app,p=a.game.plots.find(p=>p.kind==='house'&&p.tier===0);if(!p)throw Error('No opening house');window.__qaOpening=p.id;a.issue({t:'horder',k:'move',x:p.cx,z:p.cz,p:0});});
 await h.waitForFunction(()=>__app.game.buildTargetFor(__app.myHero())?.plot?.id===window.__qaOpening,null,{timeout:60000});
 await h.keyboard.down('b');
 await h.waitForFunction(()=>__app.game.firstSiege?.stage!=='opening',null,{timeout:30000});await h.keyboard.up('b');
 for(const p of [h,g])await p.evaluate(()=>__app.issue({t:'hhalt',k:'stop',p:__app.myPlayer}));
 await log('opening-built');

 for(let i=0;i<24;i++){
  const state=await h.evaluate(()=>({over:__app.game.over,time:__app.game.time,hp:__app.game.hq?.hp,frame:__app.simFrame}));
  await log('siege-progress',state);if(state.over)break;await new Promise(r=>setTimeout(r,20000));
 }
 for(const p of [h,g])await p.waitForFunction(()=>__app.game?.over,null,{timeout:30000});
 for(const p of [h,g])await p.locator('.endpanel').waitFor({state:'visible'});
 const result=await Promise.all([h,g].map(p=>p.evaluate(()=>({won:__app.game.won,time:__app.game.time,pending:__app._endExtras?.pending,error:__app._endExtras?.error}))));
 assert.ok(result.every(r=>r.won===false));await log('natural-defeat-results',result);
 for(const p of [h,g])await p.waitForFunction(()=>!__app._endExtras?.pending,null,{timeout:60000});
 const parties=await Promise.all([h,g].map(p=>p.evaluate(async()=>{const r=await __app.auth.client.rpc('friend_party_snapshot');if(r.error)throw Error(r.error.message);return r.data;})));
 assert.ok(parties.every(p=>p.members.length===2&&p.room===null));await log('finished-room-preserves-party',{members:2});
 for(const p of [h,g]){await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>__app.authStatus?.signedIn);if(transportOnly)await p.evaluate(()=>{__app.renderer.render=()=>{};});await p.waitForFunction(()=>!document.querySelector('#screen-main').classList.contains('hidden'));}
 await h.locator('#m-party').click();await h.getByRole('button',{name:'HOST NEXT MATCH',exact:true}).click();
 await g.locator('#m-party').click();await g.getByRole('button',{name:'OPEN PARTY ROOM',exact:true}).click();await g.waitForFunction(()=>__app.net?.open,null,{timeout:60000});
 await g.locator('#room-ready').click();await h.waitForFunction(()=>!document.querySelector('#s-start').disabled);await h.locator('#s-start').click();
 for(const p of [h,g])await p.waitForFunction(()=>__app.netMode&&__app.game&&__app.simFrame>50&&!__app.startBarrier,null,{timeout:120000});
 await log('next-match-after-results');
 await writeFile(out+'/live-result.json',JSON.stringify({passed:true,transportOnly,scope:'real two-account party creation/join, Ready, next room, match start/tickets, guest reconnect, natural defeat/results and another match after authenticated reload'},null,2));
}catch(e){await log('failed',{message:e.message});for(const c of browser.contexts())for(const p of c.pages())console.log('failure-state',await p.evaluate(()=>({body:document.body.innerText.slice(-2500),role:__app.mpRole,game:__app.lobby?.game,net:__app.net&&{open:__app.net.open,closed:__app.net.closed,channels:__app.net.channels?.map(c=>({topic:c.topic,state:c.state}))},pending:[...(__app.onlinePending||new Map())].map(([id,p])=>({id,open:p.open,closed:p.closed,channels:p.channels?.map(c=>({topic:c.topic,state:c.state}))}))})).catch(()=>null));process.exitCode=1;}
finally{
 await browser?.close();
 for(const u of users){
  assert.ok(u.email.startsWith('zillions-party-')&&u.email.endsWith('@example.com'));
  const current=await api('/auth/v1/admin/users/'+u.id);assert.equal(current.email,u.email);
  await api('/rest/v1/rooms?host_user_id=eq.'+u.id,{method:'DELETE'});
  await api('/auth/v1/admin/users/'+u.id,{method:'DELETE'});
  const r=await fetch(url+'/auth/v1/admin/users/'+u.id,{headers});assert.equal(r.status,404);
 }
 await log('cleanup-verified',{accounts:users.length});
 await writeFile(out+'/cleanup.json',JSON.stringify({accountsDeleted:users.length,verifiedAbsent:true},null,2));
}
