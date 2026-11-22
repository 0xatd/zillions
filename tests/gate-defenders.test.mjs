import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainField} from '../src/terrain.js';
import {generatePlots} from '../src/plots.js';
import {LEVELS,PLOT_KINDS} from '../src/config.js';
for(const l of LEVELS.slice(0,5))test(`${l.name}: every entrance has close, clear flanking defenders`,()=>{
 const initial=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});
 for(let site=0;site<initial.sites.length;site++){
  const m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});
  const plots=generatePlots(m,m.sites[site],{levelId:l.id,siteIdx:site});
  for(const gate of plots.filter(p=>p.gate&&p.role==='rampart')){
   const towers=plots.filter(p=>p.kind==='tower'&&p.gateDefenses?.some(d=>d.gateId===gate.id));
   assert.equal(towers.length,2,`site ${site} gate ${gate.id}: missing paired defenders`);
   assert.deepEqual(towers.map(p=>p.gateDefenses.find(d=>d.gateId===gate.id).side).sort(),[-1,1]);
   for(const tower of towers){
    const distance=Math.hypot(tower.cx-gate.gate[0]-.5,tower.cz-gate.gate[1]-.5);
    assert.ok(distance<=(tower.gateDefenses.length>1?6:5.5),`site ${site} gate ${gate.id}: tower drifted ${distance} tiles`);
    assert.ok(distance<PLOT_KINDS.tower.tiers[0].range,'tower cannot cover its gate');
    for(const [x,z] of gate.arch)assert.ok(!(x>=tower.x&&x<tower.x+2&&z>=tower.z&&z<tower.z+2),'tower blocks aperture');
    for(let z=tower.z;z<tower.z+2;z++)for(let x=tower.x;x<tower.x+2;x++)assert.ok(m.isWalkable(x,z),'tower footprint left buildable shelf');
   }
  }
 }
});
