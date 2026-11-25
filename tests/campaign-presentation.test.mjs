import test from 'node:test';
import assert from 'node:assert/strict';
import { heroCopy, bearing } from '../src/campaign-presentation.js';
import { HEROES } from '../src/config.js';
import { UI } from '../src/ui.js';

test('founder copy uses their identity without rewriting named companion mechanics',()=>{
 const original=JSON.stringify(HEROES.scott);
 const founder=heroCopy(HEROES.scott,{name:'<img src=x onerror=alert(1)>',classKey:'vanguard'});
 assert.doesNotMatch(founder.aura.desc,/Scott/);
 assert.doesNotMatch(founder.ability.desc,/shotgun/i);
 assert.equal(JSON.stringify(HEROES.scott),original);
 assert.equal(heroCopy(HEROES.scott,{name:'Scott English',chapterLeader:'scott'}),HEROES.scott);
 const ui=Object.create(UI.prototype);ui._keyLabel=()=> 'Q';
 assert.doesNotMatch(ui._heroTip(founder),/<img/);
 assert.match(ui._heroTip(founder),/&lt;img/);
});

test('directions agree with fixed north-up controls and do not invent missing contacts',()=>{
 assert.equal(bearing({x:0,z:0},{x:0,z:-10}),'N');
 assert.equal(bearing({x:0,z:0},{x:10,z:0}),'E');
 assert.equal(bearing({x:0,z:0},{x:-10,z:10}),'SW');
 assert.equal(bearing({x:0,z:0},{x:1,z:1}),'nearby');
 assert.equal(bearing({},null),'');
});
