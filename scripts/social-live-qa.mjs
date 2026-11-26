// Opt-in real-account party lifecycle. Use candidate API handlers and live Supabase.
// Verifies persisted friends, real invitations, Ready barrier and relay ordering.
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
 await page.evaluate(async(role)=>{const a=__app;if(!a.profile.mmoCharacters?.length)await a._createMmoCharacter({name:'QA '+role,classKey:'vanguard'});await a._selectMmoCharacter(a.profile.mmoCharacters[0].id);a.ui._showScreen('main');},role);
 await page.waitForFunction(()=>__app.lobby?.connected,null,{timeout:60000});
 await log('account-ready',{role});return {page,context,id:u.id,handle};
}
try{
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const host=await prepare('host'),guest=await prepare('guest');const h=host.page,g=guest.page;
 await h.locator('#social-toggle').click();await h.waitForFunction(()=>!document.querySelector('#l-friendadd').disabled);
 await h.locator('#l-friendcode').fill(guest.handle);await h.locator('#l-friendadd').click();
 await g.locator('#social-toggle').click();await g.waitForFunction(()=>document.querySelector('.friendrow.pending'));
 await g.getByTitle('Accept friend request',{exact:true}).click();
 await h.waitForFunction(()=>document.querySelector('.friendrow.accepted'));
 await g.reload({waitUntil:'domcontentloaded',timeout:60000});await g.waitForFunction(()=>window.__app?._authenticatedEntryHandled && !document.querySelector('#screen-main').classList.contains('hidden'),null,{timeout:60000});await g.locator('#social-toggle').click();await g.waitForFunction(()=>document.querySelector('.friendrow.accepted'));
 await log('friendship-persists-after-reload');
 await h.getByTitle('Invite to your persistent party',{exact:true}).click();
 await g.getByRole('button',{name:'Join party',exact:true}).click();
 await g.getByRole('button',{name:'JOIN PARTY',exact:true}).click();await g.waitForFunction(()=>document.querySelectorAll('.party-roster li').length===2);
 await g.locator('#friend-party-dialog [data-close]').click();await g.locator('#social-close').click();
 await h.locator('#social-refresh').click();await h.waitForFunction(()=>document.querySelectorAll('.social-member').length===2);
 await log('real-party-invite-and-accept');
 await h.screenshot({path:out+'/friends-real-laptop.png'});
 await h.locator('#social-close').click();await h.evaluate(()=>__app._openCustomGames());
 await h.locator('#cu-create').click();await h.locator('#cu-name').fill('QA custom social');await h.locator('#cu-visibility').selectOption('private');await h.locator('#cu-map').selectOption('lv-1');await h.locator('#cu-confirm').click();
 await h.waitForFunction(()=>__app.lobby?.game?.custom);
 await h.locator('#social-toggle').click();await h.getByTitle('Invite to current battle lobby',{exact:true}).click();
 await g.getByRole('button',{name:'Join',exact:true}).click();await g.waitForFunction(()=>__app.net?.open,null,{timeout:60000});
 await h.locator('#social-close').click();assert.equal(await h.locator('#s-start').isDisabled(),true);
 await g.locator('#room-ready').click();await h.waitForFunction(()=>!document.querySelector('#s-start').disabled);
 assert.equal(await h.evaluate(()=>__app._isCustomBattle()),true);assert.equal(await g.evaluate(()=>__app._isCustomBattle()),true);
 const seats=await h.locator('#room-roster').boundingBox();assert.ok(seats.y+seats.height<768,'player seats must be visible without scrolling on laptop');
 await h.screenshot({path:out+'/custom-lobby-real-laptop.png'});
 await h.setViewportSize({width:390,height:844});await h.screenshot({path:out+'/custom-lobby-real-phone.png'});assert.ok((await h.locator('#room-roster').boundingBox()).y<500);await h.setViewportSize({width:1366,height:768});
 await log('party-room-ready-transport');
 await h.evaluate(()=>{const peer=__app.peers[0],receive=peer.onMessage;window.__qaOrder=[];peer.onMessage=m=>{if(m.t==='qa-order')window.__qaOrder.push(m.n);else receive?.(m);};});
 await g.evaluate(()=>{const peer=__app.net,emit=peer.emit.bind(peer);let lost=false;peer.emit=packet=>{if(!lost&&packet.body?.t==='qa-order'&&packet.body.n===1){lost=true;return;}emit(packet);};peer.send({t:'qa-order',n:1});peer.send({t:'qa-order',n:2});});
 await h.waitForFunction(()=>window.__qaOrder?.length===2,null,{timeout:15000});
 assert.deepEqual(await h.evaluate(()=>window.__qaOrder),[1,2]);
 await log('real-private-relay-loss-order-passed');
 await writeFile(out+'/live-result.json',JSON.stringify({passed:true,scope:'real persisted friendship, party invitation, private custom room invitation, Ready gate, ordered relay delivery',transportOnly},null,2));
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
