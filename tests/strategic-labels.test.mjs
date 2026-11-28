import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutWorldLabels} from '../src/strategic-map-art.js';
test('co-located colony and fleets retain independent readable labels on a phone',()=>{
 const labels=[{id:'port',text:'Greenfall',kind:'port',x:126,y:421,width:80,priority:80},...Array.from({length:4},(_,i)=>({id:`f${i}`,text:`Commander ${i} · 4`,x:126,y:421,width:135,priority:i===0?100:10}))];
 const placed=layoutWorldLabels(labels,{width:390,height:844,obstacles:[{x:105,y:400,width:42,height:42}]});assert.equal(placed.length,5);
 for(const a of placed){assert.ok(a.x>=0&&a.x+a.width<=390&&a.y>=64&&a.y+a.height<=732);for(const b of placed)if(a.id!==b.id)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} overlaps ${b.id}`);}
 assert.deepEqual(layoutWorldLabels(labels,{width:390,height:844}),layoutWorldLabels(labels.reverse(),{width:390,height:844}),'stable regardless of input order');
});
test('offscreen fleets do not pin misleading nameplates to map edges',()=>{
 assert.deepEqual(layoutWorldLabels([{id:'a',text:'Off map',x:500,y:200}],{width:390,height:844}),[]);
});
