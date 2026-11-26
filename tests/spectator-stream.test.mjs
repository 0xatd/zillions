import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIM_DT} from '../src/config.js';
import {stateHash} from '../src/lockstep-hash.js';
import {adaptiveWindowTarget,consecutiveWindowCount,hasConsecutiveWindowBuffer,rememberWindow} from '../src/multiplayer-pacing.js';

// Execute the production App methods with transport/renderer boundaries
// replaced. No source-string assertions: real Game snapshots and commands run.
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
let clock=1000;
class Peer {
 constructor(ice){this.ice=ice;this.open=false;this.sent=[];}
 async host(){return 'offer';}
 send(packet){this.sent.push(structuredClone(packet));this.deliver?.(structuredClone(packet));}
 destroy(){this.open=false;this.onClose?.();}
}
const deps={NetSession:Peer,SIM_DT,NET_STEP:2,NET_REDUNDANCY:4,NET_HISTORY:64,NET_SPECTATOR_BUFFER:1024,NET_PACE_SLOW:.94,NET_PACE_FAST:1.06,performance:{now:()=>clock},setTimeout:()=>0,clearTimeout:()=>{},adaptiveWindowTarget,consecutiveWindowCount,hasConsecutiveWindowBuffer,rememberWindow};
function method(name){
 const start=source.search(new RegExp(`^  (?:async )?${name}\\(`,'m'));assert.ok(start>=0,`method ${name} exists`);
 const rest=source.slice(start+1),next=rest.search(/\n  (?:async )?[A-Za-z_]\w*\(/);
 const body=source.slice(start,next<0?source.length:start+1+next);
 return new Function(...Object.keys(deps),`return ({${body}
}).${name}`)(...Object.values(deps));
}
function game(snap=null){const l=levelById(1);const g=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','scott',snap,1);if(!snap){g.foundCity(0,0);for(let i=0;i<60;i++)g.update(SIM_DT);}return g;}
function app(role,g=game()){
 const a={mpRole:role,netMode:true,game:g,paused:false,startBarrier:false,simFrame:0,acc:0,_netClockLast:clock,outbox:[],guestCmdQueues:[],peers:[],spectators:[],pendingSpectators:[],onlinePending:new Map(),inbox:new Map(),_recentWindows:[],_windowHistory:new Map(),hashes:{local:new Map()},netPrimed:true,netBufferTarget:1,netStallT:0,netDiagnostics:{},ui:{setWaiting(){},showBanner(){},setNetworkDiagnostics(){}},lobby:{iceServers:[{urls:'turn:qa.invalid'}],async signal(){}},_refreshDiagnosticsUI(){},_attachNetDiagnostics(){},_stateHash(){return stateHash(this.game);}};
  for(const name of ['_acceptSpectator','_broadcastSpectators','_advanceNetSim','_advanceNetSimBody','_scheduleNetDrain','_windowsBuffered','_broadcastFast','_requestMissingWindow','issue'])a[name]=method(name);
 // This hook only exists after the production regression is fixed.
 if(source.includes('  _startPendingSpectators('))a._startPendingSpectators=method('_startPendingSpectators');
 return a;
}
function step(a,windows=1){for(let i=0;i<windows;i++){a.acc=SIM_DT*2+.000001;a._netClockLast=clock;a._advanceNetSim();}}
async function connect(host){await host._acceptSpectator({from:'qa-watcher',name:'QA'});const p=host.onlinePending.get('qa-watcher');p.open=true;p.onOpen();return p;}

test('Watch receives a boundary snapshot then all buffered/live command windows without a player seat',async()=>{
 const host=app('host');host.simFrame=1;const peer=await connect(host);
 host.acc=SIM_DT+.000001;host._advanceNetSim();assert.equal(peer.sent.length,0,'snapshot must not freeze halfway through a command window');
 host.outbox=[{t:'hdir',p:0,x:1,z:0,s:false}];step(host);
 const start=peer.sent.find(p=>p.t==='spectateStart');assert.ok(start,'open spectator must receive its initial snapshot');assert.equal(start.frame,2);assert.deepEqual(peer.ice,host.lobby.iceServers);
 assert.equal(peer.sent.filter(p=>p.t==='w').length,0,'windows bank while assets load');step(host,4);
 const watcher=app('spectator',game(start.snap));watcher.simFrame=start.frame;watcher.net={send(){}};
 peer.deliver=p=>{if(p.t==='w')watcher.inbox.set(p.w,p.c);};
 peer.onMessage({t:'cmd',c:{t:'hdir',p:0,x:-1,z:0,s:false}});
 peer.onMessage({t:'spectateReady',frame:start.frame-2});assert.equal(host.spectators.length,0,'stale ready cannot activate stream');
 peer.onMessage({t:'spectateReady',frame:start.frame});assert.equal(host.spectators.length,1);assert.equal(host.peers.length,0);assert.equal(host.guestCmdQueues.length,0);
 step(host,3);while(watcher.simFrame<host.simFrame)step(watcher);
 assert.deepEqual(watcher.game.snapshot(),host.game.snapshot(),'snapshot and each command window apply exactly once');
 const before=watcher.game.snapshot();watcher.issue({t:'hdir',p:0,x:-1,z:0,s:false});assert.deepEqual(watcher.game.snapshot(),before,'watch controls cannot change gameplay');
 peer.destroy();assert.equal(host.spectators.length,0);assert.equal(host.pendingSpectators.length,0);
});

test('slow Watch loading is bounded and retries only after the old restore acknowledges',async()=>{
 const host=app('host'),peer=await connect(host);step(host);
 const original=peer.sent[0],rec=host.pendingSpectators[0];
 for(let w=1;w<=deps.NET_SPECTATOR_BUFFER+5;w++)host._broadcastSpectators({t:'w',w,c:[],p:[]});
 assert.ok(rec.overflow);assert.ok(rec.buffer.length<=deps.NET_SPECTATOR_BUFFER);
 assert.equal(peer.sent.filter(p=>p.t==='spectateStart').length,1,'do not start concurrent snapshot restores');
 peer.onMessage({t:'spectateReady',frame:original.frame});assert.equal(host.spectators.length,0);
 step(host);const retry=peer.sent.filter(p=>p.t==='spectateStart').at(-1);assert.ok(retry.frame>original.frame);assert.equal(rec.overflow,false);
 peer.onMessage({t:'spectateReady',frame:original.frame});assert.equal(host.spectators.length,0);
 peer.onMessage({t:'spectateReady',frame:retry.frame});assert.equal(host.spectators.length,1);
 const last=peer.sent.length;peer.onMessage({t:'needWindow',w:retry.frame/2});assert.equal(peer.sent.length,last+1);assert.equal(peer.sent.at(-1).w,retry.frame/2);
});

test('spectator startup restores the snapshot frame before requesting buffered windows',async()=>{
 const watcher=app('spectator');watcher._onGuestMsg=method('_onGuestMsg');
 watcher._scheduleNetDrain=()=>{};
 let complete;const loading=new Promise(resolve=>{complete=resolve;});let ready=null;
 watcher.startGame=async(diff,key,mp,snap)=>{assert.equal(mp.role,'spectator');await loading;watcher.game=game(snap);watcher.simFrame=0;watcher.inbox=new Map();};
 watcher.net={send:m=>{ready=m;}};
 const start={t:'spectateStart',snap:game().snapshot(),frame:48};
 const pending=watcher._onGuestMsg(start);assert.equal(ready,null);
 complete();await pending;assert.equal(watcher.simFrame,48);assert.deepEqual(ready,{t:'spectateReady',frame:48});
 await watcher._onGuestMsg({t:'w',w:24,c:[{t:'cast',p:0}],p:[]});assert.equal(watcher.inbox.get(24)[0].t,'cast');
});
