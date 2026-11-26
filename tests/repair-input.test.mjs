import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById} from '../src/config.js';
import {defaultBinds,isHeld} from '../src/keybinds.js';
import {settleBuildToggle} from '../src/combat-input.js';

// Run the actual browser input method without constructing a WebGL renderer.
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf('  _updateHeroInput() {'),source.indexOf('\n  myHero() {'));
const updateInput=new Function('isHeld','document','settleBuildToggle',`return ({${method}})._updateHeroInput`)(isHeld,{activeElement:null},settleBuildToggle);
function fixture(input) {
 const l=levelById(5),map=new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests});
 const g=new Game(map,'normal','scott',null,5);g.foundCity(0,0);g.gold=10000;
 const p=g.plots.find(p=>p.kind==='tower');g._construct(p,true);g._construct(p,true);
 const h=g.heroes[0];h.x=p.cx;h.z=p.cz;
 const b=g.buildings.find(b=>b.plotId===p.id);b.hp-=35;
 const commands=[],binds=defaultBinds();
 const app={game:g,myPlayer:0,keys:new Set(),buttonPay:false,controlMode:'build',lastPay:false,lastDir:{x:0,z:0,s:false},binds:()=>binds,myHero:()=>h,issue:c=>{commands.push(c);g.exec(c);}};
 const held=on=>{app.keys.clear();app.buttonPay=input==='button'&&on;if(on&&input!=='button')app.keys.add(input);};
 const frame=()=>{updateInput.call(app);g._updatePlots(1/60);};
 return {g,p,b,app,commands,held,frame};
}
for(const input of ['b', defaultBinds().dodge, 'button'])test(`repair + branch selection cannot rearm the same physical ${JSON.stringify(input)} hold`,()=>{
 const {g,p,b,commands,held,frame}=fixture(input);
 assert.equal(p.tier,2);assert.equal(g.plotAction(p).mode,'repair');
 held(true);for(let i=0;i<120;i++)frame();
 assert.equal(b.hp,b.maxHp);assert.equal(g.plotAction(p).mode,'branch');
 assert.equal(g.heroes[0].payHold,false);
 g.exec({t:'choose',id:p.id,b:'ballista',p:0});
 const gold=g.gold;
 for(let i=0;i<600;i++)frame();
 assert.equal(p.tier,2,'choosing a specialization must not spend the unreleased repair press');
 assert.equal(g.gold,gold);assert.equal(commands.filter(c=>c.t==='pay'&&c.on).length,1);
 held(false);frame();held(true);for(let i=0;i<600;i++)frame();
 assert.equal(p.tier,3,'release and fresh press must fund the selected specialization');
});
test('holding before approaching starts one job, but moving away cannot rearm that press',()=>{
 const {g,p,app,held,frame}=fixture('b');
 const h=g.heroes[0],x=h.x,z=h.z;h.x=0;h.z=0;
 held(true);frame();assert.equal(!!h.payHold,false);
 h.x=x;h.z=z;frame();assert.equal(h.payHold,true,'first eligible job may begin without releasing');
 h.x=0;h.z=0;frame();assert.equal(h.payHold,false);
 h.x=x;h.z=z;frame();assert.equal(h.payHold,false,'changing eligibility is not a fresh press');
 held(false);frame();held(true);frame();assert.equal(h.payHold,true);
 assert.equal(g.buildTargetFor(h).plot.id,p.id);
});
