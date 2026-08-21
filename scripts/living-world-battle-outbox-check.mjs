import assert from 'node:assert/strict';
import { deliverBattleOutbox, loadBattleOutbox, LIVING_WORLD_BATTLE_OUTBOX_KEY } from '../src/living-world-battle-outbox.js';
const memoryStorage=()=>{const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
const entry={assignmentToken:'signed-assignment',replay:{version:1,completedTick:42,commands:[]}};
{
  const storage=memoryStorage();let observedPersisted=false;
  const result=await deliverBattleOutbox({storage,entry,send:async()=>{observedPersisted=Boolean(storage.getItem(LIVING_WORLD_BATTLE_OUTBOX_KEY));return{ok:true,duplicate:false}}});
  assert.equal(observedPersisted,true,'battle replay must persist before its first network send');assert.equal(result.status,'committed');assert.equal(loadBattleOutbox(storage),null);
}
{
  const storage=memoryStorage();storage.setItem(LIVING_WORLD_BATTLE_OUTBOX_KEY,JSON.stringify(entry));let calls=0;
  const result=await deliverBattleOutbox({storage,send:async(payload)=>{calls++;assert.deepEqual(payload,{action:'result',...entry});return{ok:true,duplicate:false}}});
  assert.equal(calls,1,'a reload must retry the persisted replay');assert.equal(result.status,'committed');assert.equal(loadBattleOutbox(storage),null);
}
{
  const storage=memoryStorage();storage.setItem(LIVING_WORLD_BATTLE_OUTBOX_KEY,JSON.stringify(entry));
  const result=await deliverBattleOutbox({storage,send:async()=>({ok:true,duplicate:true})});
  assert.equal(result.status,'duplicate');assert.equal(loadBattleOutbox(storage),null,'idempotent authority success clears durable outbox');
}
for(const code of ['network_unavailable','battle_result_replay_conflict','battle_assignment_expired']){
  const storage=memoryStorage();storage.setItem(LIVING_WORLD_BATTLE_OUTBOX_KEY,JSON.stringify(entry));
  const result=await deliverBattleOutbox({storage,send:async()=>{throw new Error(code)}});
  assert.equal(result.status,code==='network_unavailable'?'retry':'requires_resolution');assert.deepEqual(loadBattleOutbox(storage),entry,`${code} must retain completed-battle evidence`);
}
console.log('living-world battle outbox behavioral checks passed');
