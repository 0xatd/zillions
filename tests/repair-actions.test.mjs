import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIEGE} from '../src/config.js';
function fresh(){const l=levelById(5),m=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});const g=new Game(m,'normal','scott',null,5);g.foundCity(0,0);g.gold=10000;return g;}
test('damaged upgradeable building repairs first; a held repair never buys its upgrade',()=>{
 const g=fresh(),p=g.plots.find(p=>p.kind==='farm');g._construct(p,true);
 const b=g.buildings.find(b=>b.plotId===p.id);b.hp-=35;
 const h=g.heroes[0];h.x=p.cx;h.z=p.cz;
 assert.equal(g.buildTargetFor(h).plot.id,p.id);
 assert.equal(g.plotAction(p).mode,'repair');assert.ok(g.nextTier(p));
 const tier=p.tier,gold=g.gold;g.exec({t:'pay',p:0,on:true});
 for(let i=0;i<600;i++)g._updatePlots(1/60);
 assert.equal(b.hp,b.maxHp);assert.equal(p.tier,tier);assert.equal(h.payHold,false);
 assert.ok(gold-g.gold<=Math.ceil(35/SIEGE.repairHpPerGold)+1e-6);
 assert.equal(g.plotAction(p).mode,'build');
 const restored=new Game(new TerrainField(g.map.seed,levelById(5).theme,{size:g.map.size,nests:levelById(5).nests}),'normal','scott',g.snapshot(),5);
 assert.equal(restored.heroes[0].payHold,false);
 g.exec({t:'pay',p:0,on:false});g.exec({t:'pay',p:0,on:true});
 for(let i=0;i<600;i++)g._updatePlots(1/60);
 assert.equal(p.tier,tier+1,'fresh press upgrades exactly once');
});
test('wall repair distributes all purchased HP; breaches rebuild before upgrades',()=>{
 const g=fresh(),p=g.plots.find(p=>p.kind==='wall'&&p.tiles.length>5);g._construct(p,true);
 const bs=g.buildings.filter(b=>b.plotId===p.id);bs[0].hp-=1;bs[1].hp-=100;
 const before=g.plotHpState(p).hp;g._repairPlot(p,50);
 assert.ok(Math.abs(g.plotHpState(p).hp-before-50)<1e-6,'repair must not waste HP on nearly-full segments');
 g._damageBuilding(bs[2],bs[2].maxHp+1);g.buildings=g.buildings.filter(b=>b.alive);
 assert.equal(g.plotAction(p).mode,'rebuild');
 g._rebuildPlot(p);assert.equal(g.plotHpState(p).missing,0);assert.equal(g.plotAction(p).mode,'repair');
});
