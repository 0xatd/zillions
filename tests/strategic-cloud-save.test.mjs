import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthClient} from '../src/auth.js';
test('cloud save keeps encounter reference for ticket recovery without uploading reward ticket',async()=>{
 let row;const query={upsert:async value=>{row=value;return {error:null};},select(){return this;},eq(){return this;},maybeSingle:async()=>({data:row,error:null})};
 const auth={user:{id:'actor'},client:{from:()=>query}};
 const world={encounter:'encounter-1',troops:4,army:[4]};
 await AuthClient.prototype.syncLatestSave.call(auth,{when:123,snap:{heroKeys:['scott'],diff:'normal',level:1},world,roomId:null,match:{ticket:'not-for-cloud'}});
 assert.deepEqual(row.summary.world,world);assert.equal(JSON.stringify(row).includes('not-for-cloud'),false);
 const restored=await AuthClient.prototype.loadLatestSave.call(auth);assert.deepEqual(restored.world,world);assert.equal(restored.snap.level,1);
});
