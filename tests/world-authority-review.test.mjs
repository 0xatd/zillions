import test from 'node:test';
import assert from 'node:assert/strict';
import {processMatchStart} from '../api/match-start.js';
import {verifyTicket} from '../api/_lib/match-ticket.js';
import {newWorld,joinWorld,commandWorld,ownedFleet,advanceWorld} from '../src/strategic-world.js';

const actor='11111111-1111-4111-8111-111111111111';
const now=Date.parse('2026-11-27T18:00:00Z');
const secret='review-ticket-secret-long-enough-0123456789';
// A dropped start response followed by a retry must not produce a valid MAC
// around fields that disagree with the original database ticket.
test('world ticket retry cannot re-sign an existing reservation with changed difficulty',async()=>{
 const prior={id:'44444444-4444-4444-8444-444444444444',user_id:actor,client_character_id:'pilot',level_id:1,mode:'campaign',difficulty:'normal',room_id:null,seed:18,issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString()};
 const store={
  issueTicket:async()=>({...prior,id:'55555555-5555-4555-8555-555555555555',difficulty:'brutal'}),
  linkWorld:async()=>({encounter:'encounter-1',troops:4,ticket:prior}),
 };
 let result;
 try{result=await processMatchStart({userId:actor,body:{characterId:'pilot',levelId:1,mode:'campaign',difficulty:'brutal',worldEncounter:'encounter-1'},store,secret,now});}
 catch(error){assert.match(error.message,/setup|mismatch|locked|difficulty/);return;}
 const checked=verifyTicket(result.ticket,secret,{userId:actor,now});assert.equal(checked.ok,true);
 assert.equal(checked.payload.diff,prior.difficulty,'a reused tid must preserve the authoritative original difficulty');
});

test('battle preparations remain cancellable before ticket reservation',()=>{
 let state=joinWorld(newWorld(now),{actor,character:'pilot',name:'Pilot'},now);
 state=commandWorld(state,{actor,character:'pilot',action:'siege',now}).state;
 state=commandWorld(state,{actor,character:'pilot',action:'battle',now}).state;
 state=commandWorld(state,{actor,character:'pilot',action:'retreat',now}).state;
 assert.equal(ownedFleet(state,actor,'pilot').encounter,null);
 assert.equal(ownedFleet(state,actor,'pilot').troops,4);
});

test('disconnect lease does not discard another active player movement',()=>{
 let state=joinWorld(newWorld(now),{actor,character:'pilot',name:'Pilot'},now);
 state=joinWorld(state,{actor:'other',character:'other-pilot',name:'Other'},now);
 state=commandWorld(state,{actor,character:'pilot',action:'move',target:{x:400,z:350},now}).state;
 state=commandWorld(state,{actor:'other',character:'other-pilot',action:'move',target:{x:160,z:600},now}).state;
 state=advanceWorld(state,now+2000);
 assert.equal(ownedFleet(state,actor,'pilot').x,236);
 assert.equal(ownedFleet(state,'other','other-pilot').z,426);
});

test('offline recruitment does not debit Alloy if the world save fails',async()=>{
 const {StrategicMap}=await import('../src/strategic-map.js');
 const {setMetaBackend,memoryBackend,emptyMeta,loadMeta}=await import('../src/meta.js');
 const before={...emptyMeta(),currency:24};setMetaBackend(memoryBackend(before));
 const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const state=joinWorld(newWorld(now),{actor:'offline',character:'pilot',name:'Pilot'},now);
 const records=new Map([['zillions-world-v1:pilot',JSON.stringify(state)]]);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>records.get(key)??null,setItem:(key,value)=>{if(key==='zillions-world-v1:pilot')throw Error('quota');records.set(key,value);},removeItem:key=>records.delete(key)}});
 const status={textContent:'',classList:{add(){},remove(){}}};
 const map={busy:false,character:{id:'pilot'},offline:true,generation:0,options:{cleared:()=>0},status};
 try{
  const response=await StrategicMap.prototype.send.call(map,'recruit');assert.equal(response,null);
  assert.equal(loadMeta().currency,24,'failed world commit must not charge the player');
 }finally{if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;setMetaBackend(null);}
});

test('simultaneous world polls recover CAS collisions without stranding most callers',async()=>{
 const {processWorld}=await import('../api/world.js');
 let state=newWorld(now),revision=0;
 for(let i=0;i<16;i++)state=joinWorld(state,{actor:`a${i}`,character:`c${i}`,name:`Pilot ${i}`},now);
 const store={
  context:async a=>({character:`c${a.slice(1)}`}),receipt:async()=>null,
  load:async()=>({state:structuredClone(state),revision}),
  commit:async args=>{if(args.p_revision!==revision)throw Error('world_revision_conflict');state=args.p_state;return {revision:++revision};},
 };
 const responses=await Promise.allSettled(Array.from({length:16},(_,i)=>processWorld({actor:`a${i}`,body:{characterId:`c${i}`,action:'snapshot'},store,now:now+1000})));
 assert.equal(responses.filter(r=>r.status==='fulfilled').length,16);
});

test('surrender releases a reserved fleet and a late accepted victory cannot refund or double-charge it',async()=>{
 const {settleWorldBattle}=await import('../src/strategic-world.js');
 let state=joinWorld(newWorld(now),{actor,character:'pilot',name:'Pilot'},now);
 state=commandWorld(state,{actor,character:'pilot',action:'siege',now}).state;state.encounters[0].status='battle';state.encounters[0].startedAt=now;
 state=commandWorld(state,{actor,character:'pilot',action:'surrender',now:now+1000}).state;
 const after=structuredClone(ownedFleet(state,actor,'pilot'));assert.equal(after.encounter,null);assert.equal(after.troops,0);
 state=settleWorldBattle(state,{actor,character:'pilot',encounter:'encounter-1',won:true,troopsLost:2,now:now+2000});
 assert.equal(ownedFleet(state,actor,'pilot').troops,0);assert.equal(ownedFleet(state,actor,'pilot').encounter,null);
});

test('abandoned battle reservations expire without granting rewards or blocking travel forever',()=>{
 let state=joinWorld(newWorld(now),{actor,character:'pilot',name:'Pilot'},now);
 state=commandWorld(state,{actor,character:'pilot',action:'siege',now}).state;state.encounters[0].status='battle';state.encounters[0].startedAt=now;
 state=advanceWorld(state,now+48*3600000+1);
 assert.equal(ownedFleet(state,actor,'pilot').encounter,null);assert.equal(ownedFleet(state,actor,'pilot').troops,0);
 assert.equal(state.encounters[0].status,'lost');
});
