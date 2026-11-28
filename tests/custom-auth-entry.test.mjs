import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_PLAY_ENABLED} from '../src/modes.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=source.indexOf('  async _applyAuth('),end=source.indexOf('\n  _restartOrReturn()',begin);
function fixture({character=null,replay=false,handled=false,username=false}={}) {
 const routes=[],stored=new Map(),status={ready:true,signedIn:true,needsUsername:username};
 const deps={WORLD_PLAY_ENABLED,normalizeMmoCharacters(){},selectedMmoCharacter:()=>character,quarantineForAuthoritativeLoad(){},sessionStorage:{getItem:key=>stored.get(key)||null,removeItem:key=>stored.delete(key)},setTimeout:fn=>fn()};
 const apply=new Function(...Object.keys(deps),`return ({${source.slice(begin,end)}})._applyAuth`)(...Object.values(deps));
 const app={profile:{mmoCharacters:character?[character]:[]},_replayBoot:replay,_authenticatedEntryHandled:handled,
  auth:{ensureProfile:async()=>{},loadProfileBundle:async()=>null,profileFromBundle:()=>null,status:()=>status,loadLatestSave:async()=>null},
  ui:{setProfile(){},setCampaign(){},setAccount(){},preselectHero(){},_showScreen:screen=>routes.push(screen),showCharacterCreator:()=>routes.push('creator')},
  _ensureAuthoritativeEconomy:async()=>{},_flushPendingMatches:async()=>{},_flushPendingDaily:async()=>{},_syncAccountUpgrades:async()=>{},_storeProfileLocally(){},_openLobby:async()=>{},_consumeBootRetry:()=>null,_openCustomGames:()=>routes.push('custom')};
 return {app,routes,stored,apply:()=>apply.call(app,status)};
}
test('signed-in custom-only entry does not require creating or selecting a world character',async()=>{
 for(const character of [null,{id:'saved',proxyHero:'scott'}]) {
  const f=fixture({character});await f.apply();assert.deepEqual(f.routes,['custom']);
  assert.equal(f.app._authenticatedEntryHandled,true);
  assert.equal(f.app.profile.mmoCharacters.length,character?1:0,'world roster is preserved');
 }
});
test('custom-only auth entry respects replay ownership, username setup, and repeated hydration',async()=>{
 for(const flags of [{replay:true},{username:true},{handled:true}]) {
  const f=fixture(flags);await f.apply();assert.deepEqual(f.routes,[]);
 }
});

test('signing in during a custom battle does not navigate away from the match',async()=>{
 const f=fixture();f.app.game={over:false};await f.apply();assert.deepEqual(f.routes,[]);
});

test('custom hero selection never rebinds a saved world leader',async()=>{
 const begin=source.indexOf('  async _pickHero('),end=source.indexOf('\n  _roomRosterFromGame(',begin);
 const pick=new Function('leaderHeroKey',`return ({${source.slice(begin,end)}})._pickHero`)(()=> 'scott');
 const bound=[],sent=[];
 const app={ui:{selectedMode:'campaign',selectedLeader:'vanguard'},_isCustomBattle:()=>true,
  _bindDeployedLeader:async key=>{bound.push(key);return{proxyHero:'scott'};},_heroPayload:key=>({k:key}),net:{open:true,send:msg=>sent.push(msg)},mpRole:'guest'};
 await pick.call(app,'scott');assert.deepEqual(bound,[]);assert.deepEqual(sent,[{k:'scott'}]);
 app._isCustomBattle=()=>false;await pick.call(app,'scott');assert.deepEqual(bound,['vanguard'],'world deployment retains identity binding');
});
