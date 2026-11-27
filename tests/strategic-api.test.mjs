import test from 'node:test';
import assert from 'node:assert/strict';
import {processWorld} from '../api/world.js';
const fake=()=>{
 let state=null,revision=0,balance=24,conflict=false;const receipts=new Map();
 return {
 context:async(actor,id)=>{if(!['a','b'].includes(actor)||id!=='pilot')throw Error('character_not_found');return {character:`${actor}-pilot`,name:actor,campaignCleared:0};},
 receipt:async(a,id)=>receipts.get(`${a}:${id}`),load:async()=>({state:structuredClone(state),revision}),
 commit:async args=>{if(conflict){conflict=false;revision++;throw Error('world_revision_conflict');}if(args.p_revision!==revision)throw Error('world_revision_conflict');if(args.p_charge>balance)throw Error('insufficient_alloy');balance-=args.p_charge;state=args.p_state;const answer={...args.p_result,balance,revision:++revision};if(args.p_request_id)receipts.set(`${args.p_actor}:${args.p_request_id}`,answer);return answer;},
 acceptedBattle:async()=>{throw Error('battle_report_pending');},collide:()=>conflict=true,
 };
};
test('two identities share one world; CAS retry and repeat recruitment debit exactly once',async()=>{
 const store=fake();const call=(actor,action,extra={})=>processWorld({actor,body:{characterId:'pilot',action,requestId:`${actor}-request-123`,...extra},store,now:1000});
 await call('a','enter');await call('b','enter');store.collide();
 const recruited=await call('a','recruit');assert.equal(recruited.balance,12);assert.equal(recruited.world.fleets.filter(f=>f.kind==='player').length,2);
 const again=await call('a','recruit');assert.equal(again.duplicate,true);assert.equal(again.balance,12);assert.equal(again.world.fleets.find(f=>f.mine).troops,5);
 const b=await call('b','snapshot');assert.equal(b.world.fleets.find(f=>f.mine).troops,4);
 await assert.rejects(call('a','resolve',{requestId:'resolve-123',encounter:'invented',won:true,troopsLost:0}),/battle_report_pending/);
 await assert.rejects(call('intruder','snapshot'),/character_not_found/);
});
