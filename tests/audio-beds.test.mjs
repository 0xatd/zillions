import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreFor} from '../src/audio-beds.js';
test('score follows menu, mission, local fighting and match outcome without leaking ambience into menus',()=>{
 assert.deepEqual(scoreFor(),{music:'menu',ambient:null});
 assert.deepEqual(scoreFor({select:true}),{music:'select',ambient:null});
 assert.deepEqual(scoreFor({inMatch:true,phase:'found',combat:true,biome:'fen'}),{music:'build',ambient:'swamp'});
 assert.deepEqual(scoreFor({inMatch:true,phase:'live',combat:true,biome:'vale'}),{music:'combat',ambient:'valley'});
 assert.deepEqual(scoreFor({inMatch:true,phase:'live',combat:false,biome:'hills'}),{music:'build',ambient:'snow'});
 assert.deepEqual(scoreFor({inMatch:true,over:true,won:true}),{music:'victory',ambient:null});
 assert.deepEqual(scoreFor({inMatch:true,over:true,won:false}),{music:'defeat',ambient:null});
});
