import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBrowserHub,createSupabaseHub} from '../src/share-bus.js';
import * as links from '../src/share-link.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function method(name,next,bindings={}) {
 const code=source.slice(source.indexOf(`  ${name}(`),source.indexOf(`  ${next}(`));
 return new Function(...Object.keys(bindings),`return ({${code}}).${name}`)(...Object.values(bindings));
}
test('leaving closes signaling resources instead of leaking channels',()=>{
 let closed=0,removed=0;
 class Channel {close(){closed++} postMessage(){}}
 const local=createBrowserHub({storage:null,Channel});
 const stop=local.subscribe('abc',()=>{});stop();assert.equal(closed,1);
 const channel={on(){return this},subscribe(){return this},send(){return Promise.resolve()}};
 const relay=createSupabaseHub({channel:()=>channel,removeChannel(c){assert.equal(c,channel);removed++;}});
 relay.subscribe('abc',()=>{})();assert.equal(removed,1);
});
test('a guest sees subsequent host difficulty and mission changes',()=>{
 const id='22222222-2222-4222-8222-222222222222';
 let room=links.createLobby({code:'abc2345678',hostId:'11111111-1111-4111-8111-111111111111',hostName:'Host',hero:'scott',now:Date.now()});
 room=links.seatGuest(room,{id,name:'Guest'},Date.now()).lobby;
 let settings,rendered;
 const app={_shareCode:room.code,_shareSelf:id,_shareAnnounced:true,_shareGuestShown:true,net:{open:true},ui:{setRoomSettings(s){settings=s},showShareGuest(s){rendered=s}}};
 method('_onShareLobby','async _acceptShareGuest',{...links}).call(app,{...room,level:2,difficulty:'hard'});
 assert.equal(settings.level,2);assert.equal(settings.difficulty,'hard');
 method('_onShareLobby','async _acceptShareGuest',{...links}).call(app,{...room,level:2,difficulty:'brutal'});
 assert.equal(rendered.difficulty,'brutal','difficulty-only update must refresh the visible room summary');
});
test('an unacked guest blocks the start and the host keeps resending',()=>{
 const launch=source.slice(source.indexOf('  async _launchHostMatch('),source.indexOf('  _sharedMatchFields('));
 const waitAt=launch.indexOf('if (seated.length)');
 const sealAt=launch.indexOf('this._sealShareLobby()');
 assert.ok(waitAt>0&&sealAt>waitAt,'the lobby is sealed only after a share guest is not waiting');
 const poll=source.slice(source.indexOf('  _sharePollBegin('),source.indexOf('  async _acceptShareBegin('));
 assert.ok(poll.lastIndexOf('this._shareFanBegin()')>poll.indexOf('did not enter the match'));
 const calls=[];
 const app={
  _shareBeginNeed:new Set(['guest-1']),
  _shareBegan:new Set(),
  _shareBeginFinished:false,
  _shareBeginAt:Date.now()-21000,
  _shareBeginReminded:false,
  _shareLobby:{seats:[{id:'guest-1',name:'Guest ABCD',host:false}]},
  _shareFanBegin(){calls.push('fan')},
  _renderShareHost(){calls.push('render')},
  ui:{showBanner(){calls.push('banner')}},
 };
 method('_sharePollBegin','async _acceptShareBegin').call(app);
 assert.ok(calls.includes('fan'));
 assert.ok(calls.includes('banner'));
 assert.equal(app._shareBeginFinished,false);
 assert.equal(app.startBarrier,undefined);
 app._shareLobby={seats:[]};
 method('_sharePollBegin','async _acceptShareBegin').call(app);
 assert.equal(app._shareBeginNeed,null);
 assert.equal(app.startBarrier,false);
});

test('repeated begin waits for battlefield loading before acknowledging',async()=>{
 const start=source.indexOf('  async _acceptShareBegin('),end=source.indexOf('  _shareSendCatchup(',start);
 const accept=new Function(`return ({${source.slice(start,end)}})._acceptShareBegin`)();
 let finish,loads=0;const sent=[];
 const app={mpRole:'guest',_sharedMatch:m=>m,ui:{setWaiting(){},showBanner(){}},_sharePublish:m=>sent.push(m),net:{open:true,send:m=>sent.push(m)},startGame(){loads++;this.game={};this.netMode=true;return new Promise(r=>finish=r);}};
 const first=accept.call(app,{d:'normal'});
 await accept.call(app,{d:'normal'});
 assert.equal(loads,1);assert.deepEqual(sent,[],'a retry must not release the host while shaders load');
 finish();await first;assert.equal(sent.filter(m=>m.t==='began').length,1);
 await accept.call(app,{d:'normal'});assert.equal(loads,1);assert.equal(sent.filter(m=>m.t==='began').length,2,'loaded guest can repeat a lost acknowledgment');
});

test('stale host presence ends the waiting relay lobby instead of waiting forever',()=>{
 let tick,failure;
 const heartbeat=method('_startShareHeartbeat','_stopShareHeartbeat',{...links,Worker:class{constructor(){throw Error('no worker')}},setInterval:fn=>{tick=fn;return 1;}});
 const id='22222222-2222-4222-8222-222222222222';
 const room=links.createLobby({code:'abc2345678',hostId:'11111111-1111-4111-8111-111111111111',hostName:'Host',hero:'scott',now:Date.now()-120000});
 const app={mpRole:'guest',_shareSelf:id,_shareLobby:room,net:{open:true,relay:true},_stopShareHeartbeat(){},_tabSession:()=>({touch(){}}),_retryShareReady(){},_shareSendCatchup(){},_shareDisplayName:()=>'Guest',_shareLiveness:()=>({receivedAt:Date.now()-120000,hostPresent:false}),_failShare:r=>{failure=r},_sharePublish(){},_shareTrackPresence(){}};
 heartbeat.call(app);tick();assert.equal(failure,'host_left');
});

test('refreshing a started invite closes its stale lobby and leaves saved-game recovery accessible',()=>{
 const hostId='11111111-1111-4111-8111-111111111111',code='abc2345678';
 const lobby={...links.createLobby({code,hostId,hostName:'Host',hero:'scott',now:Date.now()}),started:true};
 const storage=new Map([[`zillions.share.${code}`,JSON.stringify({lobby})],['zillions_save','original-save']]);
 let heartbeat=false,published,screen;
 const bindings={...links,localStorage:{getItem:k=>storage.get(k)},sessionStorage:{removeItem(){}},history:{replaceState(){}},location:{origin:'https://game.invalid',pathname:'/'},chapterFounder:()=>true};
 const app={_shareSelfId:()=>hostId,profile:{},ui:{showSetup(){},setRoomSettings(){},showBanner(){},_showScreen:s=>{screen=s}},_bindShareTransport(){},_sharePublishLobby(){published=this._shareLobby},_startShareHeartbeat(){heartbeat=true},_renderShareHost(){},_rememberShareHost(){},_teardownShare(){this._shareLobby=null;this._shareCode=null;},_openShareLobby(){throw Error('must not create a new room silently')}};
 app._leaveShareLink=method('_leaveShareLink','_onShareLinkLost',bindings);
 method('_resumeShareHost','async _requestShareInvite',bindings).call(app,code);
 assert.equal(heartbeat,false,'dead host cannot advertise a live match');
 assert.equal(published?.closed,true);assert.equal(app.mpRole,null);assert.equal(screen,'main');
 assert.equal(storage.get('zillions_save'),'original-save');
});
