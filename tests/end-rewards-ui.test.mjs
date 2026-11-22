import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UI} from '../src/ui.js';
import {makeMmoCharacter,normalizeMmoCharacters} from '../src/mmo-characters.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('  _applyMatchResult(');
const method=source.slice(start,source.indexOf('\n  // Guest / offline play:',start));
const apply=new Function('normalizeMmoCharacters',`return ({${method}})._applyMatchResult`)(normalizeMmoCharacters);

test('confirmed rewards survive the end screen replacing the setup DOM',async()=>{
 const rewards={innerHTML:''},ui=Object.create(UI.prototype);
 // showEnd replaces the whole overlay; its reward host remains, setup does not.
 ui.root={querySelector:s=>s==='#end-rewards'?rewards:null,querySelectorAll:()=>[]};
 const character=makeMmoCharacter('Review hero'),profile={mmoCharacters:[character],campaign:0};
 let refreshed=false;
 const app={profile,ui,_ensureAuthoritativeEconomy:async()=>{refreshed=true;}};
 const result={character:{level:2,xp:337,progressRevision:1},stats:{campaignCleared:1},wallet:{balance:16},xpGained:337,alloyGained:16};
 assert.doesNotThrow(()=>apply.call(app,character,result));
 assert.equal(app._endExtras.pending,false);
 assert.match(rewards.innerHTML,/337 XP/);assert.match(rewards.innerHTML,/16 AL/);
 assert.equal(profile.campaign,1);assert.equal(ui._campaignCleared,1,'cache progress for next setup render');
 assert.equal(refreshed,true,'confirmed result must reach authoritative economy refresh');
 assert.doesNotMatch(rewards.innerHTML,/unconfirmed|Reporting the siege/);
});
