import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomRelay} from '../src/room-relay.js';
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
test('private relay proves both directions; retries a dropped chunk without duplicate delivery', async()=>{
 const channels=new Map();let drop=true;
 const sb={channel(topic,options){assert.equal(options.config.private,true);const c={topic,on(_,__,fn){c.receive=fn;return c;},subscribe(fn){const a=channels.get(topic)||[];a.push(c);channels.set(topic,a);queueMicrotask(()=>fn('SUBSCRIBED'));return c;},async send({payload}){if(payload.chunk && drop){drop=false;return 'ok';}for(const other of channels.get(topic)||[])if(other!==c)queueMicrotask(()=>other.receive?.({payload}));return 'ok';}};return c;},removeChannel(c){channels.set(c.topic,(channels.get(c.topic)||[]).filter(x=>x!==c));}};
 const a=new RoomRelay(sb,{room:id(1),self:id(2),remote:id(3),session:id(4)}),b=new RoomRelay(sb,{room:id(1),self:id(3),remote:id(2),session:id(4)});
 try{
  await Promise.all([a.connect(),b.connect()]);
  await new Promise(r=>setTimeout(r,20));assert.ok(a.open&&b.open);
  const messages=[];b.onMessage=m=>messages.push(m);
  const body={t:'resync',data:'x'.repeat(25000)};a.send(body);
  await new Promise(r=>setTimeout(r,20));assert.equal(messages.length,0);
  for(const packet of a.outstanding.values())a.emit(packet);
  await new Promise(r=>setTimeout(r,20));assert.deepEqual(messages,[body]);assert.equal(a.outstanding.size,0);
  a.emit({body:{t:'spoof'},id:2});await new Promise(r=>setTimeout(r,20));assert.equal(messages.length,1);
  a.destroy();assert.equal(a.open,false);assert.equal(a.outstanding.size,0);
 }finally{a.destroy();b.destroy();}
});
test('relay refuses invalid identities before creating channels',()=>{
 assert.throws(()=>new RoomRelay({}, {room:'other:room',self:id(2),remote:id(3),session:id(4)}),/Invalid/);
});
test('rejoining a full account room restores its existing seat instead of requesting a fifth', async()=>{
 const {OnlineLobby,LOBBY_PROTOCOL_VERSION}=await import('../src/online.js');
 const lobby=new OnlineLobby();let written;
 lobby.me={id:id(3),name:'Guest',hero:'scott'};
 const room={id:id(1),host_id:id(2),status:'in_game',max_players:4,protocol_version:LOBBY_PROTOCOL_VERSION,_players:[2,3,4,5].map((n,i)=>({user_id:id(n),seat:i+1}))};
 lobby.sb={from(){return {upsert(row){written=row;return Promise.resolve({error:null});}}}};
 lobby._joinGameChannel=async()=>{};lobby._installPageHide=()=>{};lobby.refreshCurrentGame=async()=>{lobby.game=room;};lobby.signal=async()=>{};
 await lobby.joinGame(room);assert.equal(written.seat,2);assert.equal(written.user_id,id(3));assert.equal(written.ready,false);
});

test('reliable relay preserves movement then release order across loss, reordering and duplicates',()=>{
 const a=new RoomRelay({}, {room:id(1),self:id(2),remote:id(3),session:id(4)});
 const b=new RoomRelay({}, {room:id(1),self:id(3),remote:id(2),session:id(4)});
 a.open=b.open=true;const packets=[],seen=[];a.emit=p=>packets.push(p);b.emit=()=>{};b.onMessage=m=>seen.push(m);
 const move={t:'cmd',c:{t:'hdir',x:1,z:0}},stop={t:'cmd',c:{t:'hdir',x:0,z:0}};
 a.send(move);a.send(stop);
 b.receive(packets[1]);assert.deepEqual(seen,[],'release cannot overtake the missing movement command');
 b.receive(packets[0]);b.receive(packets[0]);assert.deepEqual(seen,[move,stop]);
 a.destroy();b.destroy();
});
