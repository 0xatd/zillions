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
 let settings;
 const app={_shareCode:room.code,_shareSelf:id,_shareAnnounced:true,_shareGuestShown:true,net:{open:true},ui:{setRoomSettings(s){settings=s},showShareGuest(){}}};
 method('_onShareLobby','async _acceptShareGuest',{...links}).call(app,{...room,level:2,difficulty:'hard'});
 assert.equal(settings.level,2);assert.equal(settings.difficulty,'hard');
});
