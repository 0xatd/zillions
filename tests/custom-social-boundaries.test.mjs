import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OnlineLobby,isCustomGame} from '../src/online.js';
import {roomLevelEligibility} from '../src/multiplayer-eligibility.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function method(name){const a=source.search(new RegExp('^  (?:async )?'+name+'\\(', 'm'));assert.ok(a>=0);const rest=source.slice(a+1);const next=rest.search(/\n  (?:async )?[A-Za-z_]\w*\(/);return new Function('isCustomGame','persistRunTelemetry','localStorage','selectedMmoCharacter',`return ({${source.slice(a,next<0?undefined:a+1+next)}
}).${name}`)(isCustomGame,()=>{}, {removeItem:()=>{}},()=>({id:'character'}));}
test('custom battle completion grants neither local nor account progress and preserves the campaign save',()=>{
 const end=method('_recordGameEnd');
 for(const signedIn of [false,true]){
  const profile={campaign:2,games:3};let stopped=false,submitted=false;
  const app={_customBattle:true,profile,auth:{isSignedIn:()=>signedIn,clearLatestSave:async()=>{}},game:{mode:'campaign',levelId:5,heroes:[{}]},myPlayer:0,_saveProfile:()=>true,_netPumpStop:()=>{stopped=true;},_submitMatchResult:()=>{submitted=true;},_recordGuestGameEnd:()=>{profile.campaign=5;}};
  end.call(app,true);assert.deepEqual(profile,{campaign:2,games:3});assert.equal(submitted,false);assert.equal(stopped,true);assert.equal(app._endExtras.customBattle,true);
 }
});
test('custom room metadata overrides stale menu purpose and does not request reward tickets',async()=>{
 const custom=method('_isCustomBattle'),request=method('_requestMatchTicket');
 const app={lobby:{game:{custom:true}},ui:{_customBattle:false},_isCustomBattle(){return custom.call(this);},auth:{isSignedIn:()=>true}};
 assert.equal(await request.call(app,{levelId:1,mode:'campaign',difficulty:'normal'}),null);
 app.lobby.game.custom=false;app.ui._customBattle=true;assert.equal(custom.call(app),false);
});
test('custom rooms allow maps independently of conquest; campaign rooms retain eligibility',()=>{
 const game={custom:true,level:5,mode:'campaign',_players:[{user_id:'p',unlocked_level:1}]};
 assert.equal(roomLevelEligibility(game).eligible,true);
 assert.equal(roomLevelEligibility({...game,custom:false}).eligible,false);
});
test('failed social delivery never reports success and releases its channel',async()=>{
 for(const failure of ['timed out','throw']){
  const lobby=new OnlineLobby({});let removed=0;
  lobby.me={id:'self',name:'host'};lobby.game={id:'room',join_code:'ABCDEF',mode:'campaign'};
  lobby.sb={channel(){return {subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));},async send(){if(failure==='throw')throw new Error('transport failed');return failure;}}},removeChannel(){removed++;}};
  await assert.rejects(lobby.inviteFriend('friend'));assert.equal(removed,1);
 }
});
