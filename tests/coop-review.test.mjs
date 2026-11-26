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
