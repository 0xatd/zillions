import test from 'node:test';
import assert from 'node:assert/strict';
import {commitLocalWorld,readLocalWorld,recoverLocalWorld,LOCAL_WORLD_JOURNAL} from '../src/local-strategic-store.js';
import {emptyMeta} from '../src/meta.js';
const key='zillions-world-v1:pilot';
function fixture(){
 const before={v:1,troops:4},after={v:1,troops:5};const data=new Map([[key,JSON.stringify(before)]]);
 let meta={...emptyMeta(),currency:24};let failKey=null,failMeta=false;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(k===failKey)throw Error('quota');data.set(k,v);},removeItem:k=>data.delete(k)};
 const options={beforeState:before,storage,getMeta:()=>meta,putMeta:m=>{meta=m;return !failMeta;},locks:null};
 return {before,after,data,options,meta:()=>meta,failWorld:()=>failKey=key,failMeta:()=>failMeta=true,allow:()=>{failKey=null;failMeta=false;}};
}
test('offline recruit commits troop and debit together',async()=>{
 const f=fixture();await commitLocalWorld(key,f.after,{...f.options,charge:12});assert.equal(f.meta().currency,12);assert.equal((await readLocalWorld(key,f.options)).troops,5);assert.equal(f.data.has(LOCAL_WORLD_JOURNAL),false);
});
test('world write failure never debits Alloy and later recovery retains original fleet',async()=>{
 const f=fixture();f.failWorld();await assert.rejects(commitLocalWorld(key,f.after,{...f.options,charge:12}),/world_storage_unavailable/);assert.equal(f.meta().currency,24);f.allow();assert.deepEqual(await readLocalWorld(key,f.options),f.before);assert.equal(f.data.has(LOCAL_WORLD_JOURNAL),false);
});
test('ledger write failure rolls back soldier and refuses further writes until recovered',async()=>{
 const f=fixture();f.failMeta();await assert.rejects(commitLocalWorld(key,f.after,{...f.options,charge:12}),/world_storage_unavailable/);assert.equal(f.meta().currency,24);assert.deepEqual(JSON.parse(f.data.get(key)),f.before);await assert.rejects(readLocalWorld(key,f.options),/world_storage_unavailable/);f.allow();assert.deepEqual(await readLocalWorld(key,f.options),f.before);
});
test('tab closed after both writes recovers unconfirmed purchase from durable journal',async()=>{
 const f=fixture();f.data.set(LOCAL_WORLD_JOURNAL,JSON.stringify({v:1,key,world:JSON.stringify(f.before),meta:f.meta()}));f.data.set(key,JSON.stringify(f.after));f.options.putMeta({...f.meta(),currency:12});recoverLocalWorld(f.options);assert.equal(f.meta().currency,24);assert.deepEqual(await readLocalWorld(key,f.options),f.before);
});
test('malformed journal is preserved and blocks mutation instead of resetting progress',async()=>{
 const f=fixture();f.data.set(LOCAL_WORLD_JOURNAL,'broken');await assert.rejects(commitLocalWorld(key,f.after,{...f.options,charge:12}),/world_storage_unavailable/);assert.equal(f.data.get(LOCAL_WORLD_JOURNAL),'broken');assert.equal(f.meta().currency,24);
});
test('a second tab with stale world state cannot overwrite a recruitment or debit twice',async()=>{
 const f=fixture();await commitLocalWorld(key,f.after,{...f.options,charge:12});await assert.rejects(commitLocalWorld(key,f.after,{...f.options,charge:12}),/world_revision_conflict/);assert.equal(f.meta().currency,12);assert.equal((await readLocalWorld(key,f.options)).troops,5);
});
test('spending reloads the ledger inside the transaction instead of trusting tab cache',async()=>{
 const f=fixture();let forced=false;
 await assert.rejects(commitLocalWorld(key,f.after,{...f.options,charge:12,getMeta:options=>{forced=options?.force===true;return {...emptyMeta(),currency:forced?0:24};}}),/insufficient_alloy/);
 assert.equal(forced,true);assert.deepEqual(await readLocalWorld(key,f.options),f.before);
});
