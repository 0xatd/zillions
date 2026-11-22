import test from 'node:test';
import assert from 'node:assert/strict';
import {guestCommand} from '../src/multiplayer-command.js';

test('guest transport seat owns commands; packets cannot impersonate another hero',()=>{
 assert.deepEqual(guestCommand({t:'cast'},2,4),{t:'cast',p:2});
 assert.equal(guestCommand({t:'pay',p:0,on:true},2,4),null);
 assert.equal(guestCommand({t:'focus',p:3,id:7},2,4),null);
 for(const player of [-1,0,4,1.2,NaN]) assert.equal(guestCommand({t:'cast'},player,4),null);
});
test('valid existing guest controls and focus preserve payloads',()=>{
 for(const input of [
  {t:'hdir',x:.6,z:-.8,s:true},{t:'dodge',x:0,z:1},
  {t:'pay',on:false},{t:'stance',s:'attack'},{t:'heroUpgrade',key:'damage'},
  {t:'choose',id:9,b:'defense'},{t:'found',s:2},{t:'drop',i:-1},
  {t:'blessing',i:1},{t:'focus',id:27},{t:'focus',id:null},
  {t:'cast'},{t:'towerpri'},{t:'swapset'},
 ]) assert.deepEqual(guestCommand(input,1,2),{...input,p:1});
 assert.deepEqual(guestCommand({t:'pay',on:true,p:1,gold:999999},1,2),{t:'pay',on:true,p:1});
});
test('malformed or host-only commands cannot enter deterministic simulation',()=>{
 for(const input of [null,[],{},'cast',
  {t:'builderOrder',s:'expand'},{t:'builderPause',on:false},{t:'builderReserve',gold:0},
  {t:'hdir',x:Infinity,z:0,s:false},{t:'hdir',x:2,z:0,s:false},
  {t:'hdir',x:0,z:0,s:'true'},{t:'pay',on:'false'},{t:'stance',s:'teleport'},
  {t:'choose',id:-1,b:'x'},{t:'focus',id:NaN},{t:'focus',id:'8'},
 ]) assert.equal(guestCommand(input,1,2),null,JSON.stringify(input));
});
