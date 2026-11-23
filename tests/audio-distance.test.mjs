import test from 'node:test';
import assert from 'node:assert/strict';
import {hearingGain,eventHearingGain} from '../src/audio-distance.js';
import {visibleInFog,fogVisionSources} from '../src/fog-of-war.js';
test('combat hearing fades with hero distance and is silent beyond range',()=>{
 const h={x:10,z:10};assert.equal(hearingGain(h,h),1);
 assert.ok(hearingGain(h,{x:22,z:10})<1);assert.equal(hearingGain(h,{x:34,z:10}),0);
 assert.equal(hearingGain(null,h),0);assert.equal(hearingGain(h,{}),0);
 assert.equal(eventHearingGain(h,{type:'shot',fx:40,fz:10,x:10,z:10}),0,'shot is heard from shooter, not target');
 assert.equal(eventHearingGain(h,{type:'underattack',x:90,z:90}),1,'strategic warning remains global');
});
test('enemy contacts disappear when allies move away or die, including allied shared sight',()=>{
 const g={units:[{hero:true,x:10,z:10},{x:70,z:70}]};
 assert.equal(visibleInFog(fogVisionSources(g),72,70),true);
 g.units[1].dead=true;assert.equal(visibleInFog(fogVisionSources(g),72,70),false);
 assert.equal(visibleInFog(fogVisionSources(g),10,10),true);
 g.units[0].x=50;assert.equal(visibleInFog(fogVisionSources(g),10,10),false);
});

test('scheduled audio retains originating attenuation and restores UI sound context',async()=>{
 const {AudioSys}=await import('../src/audio.js');
 const audio=Object.create(AudioSys.prototype);audio.eventGain=.25;
 const observed=[];audio._later(()=>observed.push(audio.eventGain),0);
 audio.eventGain=1;await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(observed,[.25]);assert.equal(audio.eventGain,1);
});
