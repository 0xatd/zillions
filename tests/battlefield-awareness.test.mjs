import test from 'node:test';
import assert from 'node:assert/strict';
import {battlefieldAwareness} from '../src/battlefield-awareness.js';

test('army count excludes casualties; contacts and combat never disclose unseen enemies',()=>{
 const hero={id:1,hero:true,x:10,z:10,hp:100};
 const soldier={id:2,x:11,z:10,hp:20,key:'soldier'};
 const near={id:3,x:13,z:10,hp:20,targetU:hero};
 const far={id:4,x:100,z:100,hp:20,targetU:hero};
 const g={units:[hero,soldier,{...soldier,id:5,dead:true}],zombies:[near,far,{...near,id:6,dead:true}]};
 assert.deepEqual(battlefieldAwareness(g),{troops:1,enemies:1,composition:{soldier:1},fights:[{x:12,z:12}]});
 near.targetU=null;
 assert.equal(battlefieldAwareness(g).fights.length,0,'merely visible enemies are not battles');
 soldier.target=near;
 assert.equal(battlefieldAwareness(g).fights.length,1,'friendly attacks are also visible fights');
});
