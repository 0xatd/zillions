import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAPTER_LEADERS,chapterIdentity,chapterCities,chapterFounder,leaderAvailable,recruitmentAllowed} from '../src/chapter.js';
import {makeMmoCharacter,normalizeMmoCharacters,characterCamp,addMmoCharacter,ensureDeployedLeader} from '../src/mmo-characters.js';
import {AuthClient} from '../src/auth.js';
import {HEROES,levelById} from '../src/config.js';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {stateHash} from '../src/lockstep-hash.js';

test('chapter cosmetics cannot invent captures or unlock companions',()=>{
 const identity=chapterIdentity({name:'  Dawnward\n ',color:'bogus',emblem:'bogus',campaign:99,cities:[1,2,3]});
 assert.equal(identity.name,'Dawnward');assert.equal(identity.color,'cobalt');assert.equal(identity.campaign,undefined);
 const p={chapter:identity,campaign:0};assert.equal(chapterCities(p).filter(c=>c.status==='held').length,0);assert.equal(leaderAvailable(p,'scott'),false);
 assert.deepEqual(chapterCities(p).map(c=>c.status),['frontier','locked','locked','locked','locked']);
 p.campaign=1;assert.equal(leaderAvailable(p,'scott'),true);assert.equal(leaderAvailable(p,'alexander'),true);assert.equal(leaderAvailable(p,'aaron'),false);
 p.campaign=5;assert.ok(CHAPTER_LEADERS.every(l=>leaderAvailable(p,l.key)));assert.ok(chapterCities(p).every(c=>c.status==='held'));
});

test('eight legacy commanders plus all implemented companions preserve every identity and build',()=>{
 const roster=Array.from({length:8},(_,i)=>makeMmoCharacter('Legacy '+i));const p={mmoCharacters:roster,mmoCharacterId:roster[3].id,chapter:{founderId:roster[3].id}};
 const before=structuredClone(roster);
 for(const l of CHAPTER_LEADERS){const c=makeMmoCharacter(HEROES[l.key].name,l.classKey);c.chapterLeader=l.key;c.id='chapter_'+l.key+'_v1';assert.ok(addMmoCharacter(p,c));}
 normalizeMmoCharacters(p);assert.equal(p.mmoCharacters.length,8+CHAPTER_LEADERS.length);assert.equal(chapterFounder(p).id,before[3].id);
 for(let i=0;i<8;i++){assert.equal(p.mmoCharacters[i].id,before[i].id);assert.deepEqual(p.mmoCharacters[i].equipment,before[i].equipment);assert.equal(p.mmoCharacters[i].level,before[i].level);}
});

test('cloud hydration uses server conquest and preserves chapter/founder metadata',()=>{
 const a=new AuthClient();a.session={user:{user_metadata:{chapter:{name:'Dawnward',founderId:'founder'},campaign:99,mmo_characters:[]}}};
 const p=a.profileFromBundle({profile:{username_set:true,handle:'test_user'},stats:{campaign_cleared:1},characters:[]});
 assert.equal(p.campaign,1);assert.equal(p.chapter.name,'Dawnward');assert.equal(p.chapter.founderId,'founder');assert.equal(leaderAvailable(p,'tiger'),false);
});

test('founder keeps appearance; each companion brings its named hero kit through restore',()=>{
 const founder=makeMmoCharacter('Founder');assert.ok(characterCamp(founder).characterStyle);
 const level=levelById(1);
 for(const l of CHAPTER_LEADERS){const c=makeMmoCharacter(HEROES[l.key].name,l.classKey);c.chapterLeader=l.key;normalizeMmoCharacters({mmoCharacters:[c]});const camp=characterCamp(c);
 assert.equal(c.proxyHero,l.key);assert.equal(camp.characterStyle,null);
 const terrain=()=>new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
 const game=new Game(terrain(),'normal',[{k:l.key,camp}],null,1);assert.equal(game.heroes[0].key,l.key);assert.equal(game.heroes[0].def.ability.name,HEROES[l.key].ability.name);
 const restored=new Game(terrain(),'normal',l.key,game.snapshot(),1);assert.equal(stateHash(restored),stateHash(game));
 }
});

test('deploying a leader selects that leader\'s persistent character', () => {
  const founder = makeMmoCharacter('Herald', 'vanguard', 'cobalt');
  const profile = { chapter: chapterIdentity({ name: 'First Landing', founderId: founder.id, color: 'cobalt' }), mmoCharacters: [founder], mmoCharacterId: founder.id };
  assert.equal(ensureDeployedLeader(profile, 'vanguard').id, founder.id);
  const alexander = ensureDeployedLeader(profile, 'alexander');
  assert.equal(alexander.chapterLeader, 'alexander');
  assert.equal(alexander.proxyHero, 'alexander');
  assert.equal(alexander.classKey, 'recon');
  assert.equal(profile.mmoCharacterId, alexander.id);
  assert.equal(chapterFounder(profile).id, founder.id, 'the founder stays the chapter founder');
  assert.equal(ensureDeployedLeader(profile, 'alexander').id, alexander.id, 'a second deployment reuses the companion');
  assert.equal(profile.mmoCharacters.filter((c) => c.chapterLeader === 'alexander').length, 1);
  const camp = characterCamp(selectedOr(profile));
  assert.equal(camp.level, 1);
  assert.equal(ensureDeployedLeader(profile, 'danny'), null);
});

function selectedOr(profile) {
  return profile.mmoCharacters.find((c) => c.id === profile.mmoCharacterId);
}

test('late auth hydration cannot erase a founder being saved',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('  async _applyAuth('),end=source.indexOf('\n  _restartOrReturn()',start);
 const apply=new Function('normalizeMmoCharacters','selectedMmoCharacter','quarantineForAuthoritativeLoad','clearRetry','sessionStorage',`return ({${source.slice(start,end)}})._applyAuth`)(normalizeMmoCharacters,()=>null,()=>{},()=>{},{getItem(){return null;}});
 let release;const bundle=new Promise(resolve=>{release=resolve;});
 const profile={mmoCharacters:[]};const app={profile,auth:{ensureProfile:async()=>{},loadProfileBundle:()=>bundle,profileFromBundle:()=>({mmoCharacters:[]}),status:()=>({}),loadLatestSave:async()=>null},ui:{setProfile(){},setCampaign(){},setAccount(){}},_flushPendingMatches:async()=>{},_syncAccountUpgrades:async()=>{},_storeProfileLocally(){}};
 const pending=apply.call(app,{signedIn:true,needsUsername:true});
 await Promise.resolve();app._founderCreating=true;const founder=makeMmoCharacter('Pending founder');app.profile.mmoCharacters.push(founder);release({});await pending;
 assert.equal(app.profile.mmoCharacters[0]?.id,founder.id,'hydration started before creation must not overwrite the pending founder');
});

test('returning from an arcade kit to campaign announces the founder kit to peers',async()=>{
 const {UI}=await import('../src/ui.js');const founder=makeMmoCharacter('Founder'),sent=[];
 const ui=Object.create(UI.prototype);ui._profile={mmoCharacters:[founder],mmoCharacterId:founder.id};ui.selectedHero='danny';ui.root={querySelectorAll:()=>[]};ui.cb={onHeroPick:key=>sent.push(key)};
 ui._syncChapterHeroChoice('campaign');assert.equal(ui.selectedHero,'scott');assert.deepEqual(sent,['scott']);
 ui._syncChapterHeroChoice('campaign');assert.deepEqual(sent,['scott'],'unchanged selection must not produce duplicate peer changes');
 ui.selectedHero='tiger';ui._syncChapterHeroChoice('survival');assert.equal(ui.selectedHero,'tiger','arcade kits remain selectable');
});

test('recruitment culture restricts new nonhuman recruits but not earned conquests',()=>{
 const p={campaign:2,chapter:{culture:'human'}};
 assert.equal(recruitmentAllowed(p,'sniper'),false);assert.equal(recruitmentAllowed(p,'lina'),true);
 assert.equal(leaderAvailable(p,'sniper'),true,'existing companion must not be erased by culture changes');
 p.chapter.culture='coalition';assert.equal(recruitmentAllowed(p,'sniper'),true);
 p.campaign=0;assert.equal(recruitmentAllowed(p,'lina'),false);
});
