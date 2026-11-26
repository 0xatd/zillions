import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBrowserHub,createSupabaseHub} from '../src/share-bus.js';
import * as links from '../src/share-link.js';
import {shareGuestView} from '../src/lobby-reliability.js';
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
 const app={_shareCode:room.code,_shareSelf:id,_shareAnnounced:true,_shareGuestShown:true,mpRole:'guest',net:{open:true},ui:{setRoomSettings(s){settings=s},showShareGuest(s){rendered=s}}};
 app._noteShareHostBoot=method('_noteShareHostBoot','_shareResetGuestLink');
 app._shareLobbyFresh=method('_shareLobbyFresh','_shareGuestPlayerIndex');
 app._shareRejoinIntent=method('_shareRejoinIntent','_shareLobbyFresh');
 app._sharePaintGuestLobby=method('_sharePaintGuestLobby','_allowMatchScreen',{...links,shareGuestView});
 method('_onShareLobby','async _acceptShareGuest',{...links}).call(app,{...room,level:2,difficulty:'hard'});
 assert.equal(settings.level,2);assert.equal(settings.difficulty,'hard');
 method('_onShareLobby','async _acceptShareGuest',{...links}).call(app,{...room,level:2,difficulty:'brutal'});
 assert.equal(rendered.difficulty,'brutal','difficulty-only update must refresh the visible room summary');
});
test('an unacked guest is removed after 8s and the match starts without them',()=>{
 const launch=source.slice(source.indexOf('  async _launchHostMatch('),source.indexOf('  _sharedMatchFields('));
 const waitAt=launch.indexOf('if (seated.length)');
 const sealAt=launch.indexOf('this._sealShareLobby()');
 assert.ok(waitAt>0&&sealAt>waitAt,'the lobby is sealed only after a share guest is not waiting');
 const poll=source.slice(source.indexOf('  _sharePollBegin('),source.indexOf('  async _acceptShareBegin('));
 assert.ok(poll.includes('8000'));
 assert.ok(poll.includes("didn't respond"));
 const calls=[];
 const app={
  _shareBeginNeed:new Set(['guest-1']),
  _shareBegan:new Set(),
  _shareBeginFinished:false,
  _shareBeginAt:Date.now()-9000,
  _shareLobby:{seats:[{id:'guest-1',name:'Guest 65F6',host:false}]},
  _shareFanBegin(){calls.push('fan')},
  _dropShareGuest(id){calls.push(`drop:${id}`)},
  _shareFinishBegin(){calls.push('finish')},
  _renderShareHost(){},
  ui:{showBanner(text){calls.push(text)}},
 };
 method('_sharePollBegin','async _acceptShareBegin').call(app);
 assert.ok(calls.includes('drop:guest-1'));
 assert.ok(calls.includes('finish'));
 assert.ok(calls.some((line)=>String(line).includes("didn't respond")));
});
