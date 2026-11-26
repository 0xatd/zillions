import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as links from '../src/share-link.js';
import {defaultBinds,loadBinds,setKeybindBackend,KEYBIND_VERSION} from '../src/keybinds.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function method(name,next,bindings={}) {
 const code=source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
 return new Function(...Object.keys(bindings),`return ({${code}}).${name}`)(...Object.values(bindings));
}
test('fresh begin survives clock skew; previous-page begin cannot restart a guest',()=>{
 let calls=0;
 const app={mpRole:'guest',_shareSelf:'guest',_shareSession:'new-page',_shareSeen:new Set(),_acceptShareBegin(){calls++}};
 const receive=method('_onShareMessage','_onShareLobby');
 receive.call(app,{id:'old',t:'begin',from:'host',to:'guest',session:'old-page',at:Date.now()+999999,start:{}});
 assert.equal(calls,0);
 receive.call(app,{id:'fresh',t:'begin',from:'host',to:'guest',session:'new-page',at:1,start:{}});
 assert.equal(calls,1);
});
test('a closed relay tab is not launch-ready and expires despite its old linked flag',()=>{
 const id='22222222-2222-4222-8222-222222222222';
 let room=links.createLobby({code:'abc2345678',hostId:'11111111-1111-4111-8111-111111111111',hostName:'Host',hero:'scott',now:Date.now()-100000});
 room=links.seatGuest(room,{id,name:'Guest',ready:true},Date.now()-100000).lobby;
 room.seats[1].linked=true;
 const open=method('_shareOpenIds','_shareCanLaunch').call({_shareLobby:room,_shareHands:new Map([[id,{open:true,relay:true}]])});
 assert.equal(open.size,0);
 assert.equal(links.shareLaunchReady(room,open).ready,false);
 assert.equal(links.reapStaleSeats(room,Date.now(),{openIds:open,presentIds:new Set([room.hostId])}).dropped.length,1);
});
test('adding Keep camera preserves a previously customized K movement key',()=>{
 const binds={...defaultBinds(),move_up:'k'};delete binds.camera_keep;
 setKeybindBackend({load:()=>({v:KEYBIND_VERSION,binds,feel:{}})});
 const next=loadBinds({force:true});
 assert.equal(next.move_up,'k');assert.notEqual(next.camera_keep,'k');
 setKeybindBackend(null);
});
test('room roster treats guest and host names as text',()=>{
 const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
 const code=ui.slice(ui.indexOf('  roomRoster('),ui.indexOf('  addPing('));
 const escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const roster=new Function('levelById','DIFFICULTY','HEROES','escapeHtml',`return ({${code}}).roomRoster`)(()=>({name:'Map'}),{normal:{label:'Normal'}},{scott:{name:'Scott'}},escapeHtml);
 let html='';const box={classList:{remove(){}},set innerHTML(v){html=v},querySelector(){return null},querySelectorAll(){return []}};
 roster.call({root:{querySelector(){return box}},cb:{},_heroName(){return 'Scott'}},[{seat:1,host:true,name:'<svg onload=top.x=1>',hero:'scott'},{seat:2,name:'<img src=x onerror=x=1>',hero:'scott',state:'connected'}]);
 assert.ok(!html.includes('<svg'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;svg'));assert.ok(html.includes('&lt;img'));
});

test('Ready retries until the host confirms, but setup changes cancel the vote',()=>{
 const sent=[];const app={_shareReadyIntent:{ready:true,setup:'old'},_shareSelf:'guest',_shareLobby:{seats:[{id:'guest',ready:false}]},_shareReadySetup:()=> 'old',_sharePublish:m=>sent.push(m)};
 const retry=method('_retryShareReady','_renderShareHost');
 retry.call(app);retry.call(app);assert.equal(sent.length,2);
 app._shareLobby.seats[0].ready=true;retry.call(app);assert.equal(app._shareReadyIntent,null);
 app._shareReadyIntent={ready:true,setup:'older'};app._shareLobby.seats[0].ready=false;
 retry.call(app);assert.equal(sent.length,2);assert.equal(app._shareReadyIntent,null);
});
test('automatic connection retry preserves the chosen hero and Ready vote',()=>{
 let join;
 const app={_shareLobby:{seats:[{id:'guest',hero:'alexander',ready:true}]},_shareHands:new Map(),_acceptShareGuest:m=>{join=m}};
 method('_shareKickLink','_shareSendPing',{LOBBY_PROTOCOL_VERSION:24,CLIENT_VERSION:'test'}).call(app,{from:'guest',t:'here',name:'Guest'});
 assert.equal(join.hero,'alexander');assert.equal(join.ready,true);
});
test('failed account-room handshake reports the error instead of throwing a ReferenceError',async()=>{
 // Bound at the next method rather than a comment inside the method.
 const start=source.indexOf('  async _onSignal('),end=source.indexOf('\n  }',start)+4;
 const receive=new Function('NetSession',`return ({${source.slice(start,end)}})._onSignal`)(class{joinTrickle(){return Promise.reject(new Error('blocked'))}});
 let status='';
 const app={mpRole:'guest',netMode:false,lobby:{},_attachNetDiagnostics(){},ui:{onlineStatus:s=>{status=s}}};
 await receive.call(app,{t:'offer',from:'host',sdp:'offer'});
 assert.match(status,/Handshake failed: blocked/);
});
test('a lost reload join is retried until the host echoes this page session',()=>{
 const id='22222222-2222-4222-8222-222222222222';
 let room=links.createLobby({code:'abc2345678',hostId:'11111111-1111-4111-8111-111111111111',hostName:'Host',hero:'scott',now:Date.now()});
 room=links.seatGuest(room,{id,name:'Guest'},Date.now()).lobby;
 room.seats[1].session='old-page';
 const sent=[];
 const app={_shareCode:room.code,_shareSelf:id,_shareSession:'new-page',_shareAnnounced:true,_shareGuestShown:true,net:{open:true},_shareDisplayName:()=> 'Guest',_sharePublish:m=>sent.push(m),_shareSendPing(){},ui:{selectedHero:'scott',setRoomSettings(){},showShareGuest(){}}};
 const receive=method('_onShareLobby','async _acceptShareGuest',{...links,highestUnlockedLevel:()=>1,LOBBY_PROTOCOL_VERSION:24,CLIENT_VERSION:'test'});
 receive.call(app,room);receive.call(app,room);
 assert.equal(sent.filter(m=>m.t==='join').length,2);
 room.seats[1].session='new-page';receive.call(app,room);
 assert.equal(sent.filter(m=>m.t==='join').length,2);
 assert.equal(links.publicShareLobby(room).seats[1].session,'new-page');
});
test('account room retries an acknowledged but lost knock until the peer opens, then stops',()=>{
 let tick,cleared=0,sent=0;
 const arm=method('_armLobbyConnectionWatchdog','_handleRoomClosed',{
  setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared++;},setTimeout:()=>2,clearTimeout:()=>{},
 });
 const app={mpRole:'guest',netMode:false,lobby:{game:{id:'room'},signal:()=>{sent++;return Promise.resolve();}},_publicName:()=> 'Guest'};
 arm.call(app);assert.equal(typeof tick,'function');tick();tick();assert.equal(sent,2);
 app.net={open:true};tick();assert.equal(sent,2);assert.ok(cleared>=2);assert.equal(app._roomDialRetry,null);
});
test('battlefield graphics preparation cannot advance host lockstep before loading completes',()=>{
 const app={_preparingBattlefield:true,get netMode(){throw Error('simulation inspected while graphics are loading');}};
 // Extract the method with its true adjacent boundary when runtime helpers move.
 const start=source.indexOf('  _advanceNetSim()');let depth=0,end=start;
 const brace=source.indexOf('{',start);
 for(let i=brace;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0){end=i+1;break;}}
 const fn=new Function(`return ({${source.slice(start,end)}})._advanceNetSim`)();
 assert.doesNotThrow(()=>fn.call(app));
});
test('same-room reconnect retains this guest ticket, including an in-flight issuance',async()=>{
 const begin=method('_beginMatchRecord','async startGame');
 let requests=0;
 const app={_match:{roomId:'room',ticket:'own-ticket',seed:5},_requestMatchTicket:()=>{requests++;return Promise.resolve({ok:true,ticket:'new'});},auth:{isSignedIn:()=>true}};
 const args={snap:{},mp:{role:'guest',match:{roomId:'room',seed:5}},heroKeys:['scott'],levelId:1,mode:'campaign',difficulty:'normal'};
 assert.equal(begin.call(app,args).ticket,'own-ticket');assert.equal(requests,0);
 app._match={roomId:'room',ticket:null,ticketPromise:Promise.resolve({ok:true,ticket:'pending-own',seed:5})};
 const result=begin.call(app,args);await result.ticketPromise;assert.equal(result.ticket,'pending-own');assert.equal(requests,0);
 const other=begin.call(app,{...args,mp:{role:'guest',match:{roomId:'different',seed:5}}});await other.ticketPromise;assert.equal(requests,1,'another room must request its own ticket');
});
test('reconnect during startup acknowledges loaded only after the snapshot rebuild finishes',async()=>{
 const start=source.indexOf('  async _onGuestMsg('),end=source.indexOf('  _stateHash()',start);
 const receive=new Function('NET_STEP',`return ({${source.slice(start,end)}})._onGuestMsg`)(2);
 let complete;const loading=new Promise(r=>{complete=r;});const sent=[];
 const app={startGame:()=>loading,_sharedMatch:m=>m,net:{open:true,send:m=>sent.push(m)},ui:{setWaiting(){},showBanner(){}}};
 await receive.call(app,{t:'resync',snap:{diff:'normal'},you:1,frame:0,match:{},awaitStart:true});
 assert.deepEqual(sent,[],'loading is not a Ready acknowledgment');
 complete();await new Promise(r=>setImmediate(r));
 assert.deepEqual(sent,[{t:'startReady'}]);assert.equal(app._resyncing,false);
});
