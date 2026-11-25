import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {supabaseDailyStore} from '../api/daily.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('  _dropStashedDaily('),end=source.indexOf('  async _finishDailyRun(',start);
const method=source.slice(start,end);
test('an older submission cannot delete the next queued daily run',()=>{
 const older={replay:{hash:1},savedAt:1},newer={replay:{hash:2},savedAt:2};let current=newer;
 const drop=new Function('localStorage','PENDING_DAILY_KEY',`return ({${method}})._dropStashedDaily`)({removeItem(){current=null}},'daily');
 const app={_readStashedDaily:()=>current};
 drop.call(app,older);assert.deepEqual(current,newer);
 drop.call(app,newer);assert.equal(current,null);
});
test('a temporary expired login preserves the daily score for sign-in retry',async()=>{
 const begin=source.indexOf('  async _submitStashedDaily('),finish=source.indexOf('  _recordGameEnd(',begin);
 const submit=new Function('dailyScoreRequest',`return ({${source.slice(begin,finish)}})._submitStashedDaily`)(async()=>{throw new Error('sign_in_required')});
 let dropped=false;
 await submit.call({_readStashedDaily:()=>({replay:{hash:1}}),_dropStashedDaily:()=>{dropped=true},ui:{setDailyStatus(){}}});
 assert.equal(dropped,false);
});
test('leaderboard identity is a claimed handle, never a bootstrap profile label',async()=>{
 const store=supabaseDailyStore({url:'https://example.invalid',serviceKey:'test',fetchImpl:async()=>({ok:true,json:async()=>[{handle:'unclaimed_person',username_set:false}]})});
 assert.equal(await store.displayName('11111111-1111-1111-1111-111111111111'),'');
});
