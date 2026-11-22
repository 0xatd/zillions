import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIEGE} from '../src/config.js';
import {updateBuilders,builderCandidates} from '../src/builders.js';
import {stateHash} from '../src/lockstep-hash.js';
function fresh(){const l=levelById(5),g=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','scott',null,5);g.foundCity(0,0);g.gold=400;g.zombies=[];return g;}
function order(g,s){g.exec({t:'builderOrder',s,p:0});}
function ticks(g,n=600){for(let i=0;i<n;i++)updateBuilders(g,1/60);}
test('crew walks, completes work and never spends protected gold',()=>{
 const g=fresh(),b=g.builders,start=[b.x,b.z];g.gold=50;g.exec({t:'builderReserve',gold:20,p:0});order(g,'prosper');ticks(g,6000);
 assert.ok(b.completed>0);assert.notDeepEqual([b.x,b.z],start);assert.ok(g.gold>=20-1e-7);assert.ok(g.plots.some(p=>['farm','house','mill','mine'].includes(p.kind)&&p.tier>0));
 assert.equal(g.plots.filter(p=>p.kind.startsWith('camp_')&&p.tier>0).length,0);
});
test('all orders choose different eligible work and Maintain never builds new plots',()=>{
 const g=fresh(),b=g.builders;
 const kinds=s=>{order(g,s);return builderCandidates(g,b).choices.map(c=>c.p.kind);};
 assert.equal(kinds('maintain').length,0);
 assert.ok(kinds('prosper').every(k=>['hq','house','farm','mill','mine'].includes(k)));
 assert.ok(kinds('mobilize').every(k=>k==='hq'||k.startsWith('camp_')));
 assert.ok(kinds('fortify').every(k=>['hq','wall','tower'].includes(k)));
 assert.ok(kinds('develop').some(k=>k.startsWith('camp_')));
 const outer=g.plots.find(p=>p.role==='outer');const h=g.heroes[0];h.x=outer.cx;h.z=outer.cz;
 order(g,'expand');assert.ok(builderCandidates(g,b).choices.some(c=>c.p.role==='outer'));
 order(g,'develop');assert.ok(builderCandidates(g,b).choices.every(c=>c.p.role!=='outer'));
});
test('Maintain repairs without upgrading, pause refunds only uncompleted construction',()=>{
 const g=fresh(),p=g.plots.find(p=>p.kind==='farm');g._construct(p,true);const building=g.buildings.find(b=>b.plotId===p.id);building.hp-=60;const tier=p.tier,before=g.gold;
 order(g,'maintain');ticks(g,5000);assert.equal(building.hp,building.maxHp);assert.equal(p.tier,tier);assert.ok(before-g.gold<=Math.ceil(60/SIEGE.repairHpPerGold)+.01);
 order(g,'mobilize');for(let i=0;i<10000&&g.builders.paid===0;i++)ticks(g,1);
 assert.ok(g.builders.paid>0);const escrow=g.builders.paid,gold=g.gold;g.exec({t:'builderPause',on:true,p:0});assert.ok(Math.abs(g.gold-gold-escrow)<1e-6);assert.equal(g.builders.job,null);const stopped=g.gold;ticks(g,100);assert.equal(g.gold,stopped);
});
test('manual work wins and a lost target refunds rather than double-purchasing',()=>{
 const g=fresh();order(g,'prosper');for(let i=0;i<10000&&g.builders.paid===0;i++)ticks(g,1);
 const b=g.builders,p=g.plots.find(p=>p.id===b.job.id),h=g.heroes[0];h.x=b.x;h.z=b.z;h.payHold=true;
 // A manual hold can target the same footprint from the crew's work point.
 assert.equal(g.buildTargetFor(h).plot.id,p.id);const gold=g.gold,escrow=b.paid;ticks(g,1);assert.equal(b.job,null);assert.ok(Math.abs(g.gold-gold-escrow)<1e-6);
 h.payHold=false;order(g,'prosper');for(let i=0;i<10000&&b.paid===0;i++)ticks(g,1);
 const target=g.plots.find(p=>p.id===b.job.id);g._construct(target,true);ticks(g,1);assert.equal(b.job,null);
});
test('builder job, escrow, route and reserve restore deterministically and affect the hash',()=>{
 const g=fresh();order(g,'develop');ticks(g,100);const snap=g.snapshot(),l=levelById(5),other=new Game(new TerrainField(l.seed,l.theme,{size:l.size,nests:l.nests}),'normal','scott',snap,5);
 assert.deepEqual(other.builders,g.builders);assert.equal(stateHash(other),stateHash(g));ticks(g,300);ticks(other,300);assert.deepEqual(other.builders,g.builders);assert.equal(other.gold,g.gold);
 const hash=stateHash(g);g.builders.reserve++;assert.notEqual(stateHash(g),hash);
});
test('only valid host commands act; threat pauses spending and a lost crew recovers',()=>{
 const g=fresh(),b=g.builders;for(const c of [{t:'builderOrder',s:'develop',p:1},{t:'builderReserve',gold:NaN,p:0},{t:'builderReserve',gold:-1,p:0},{t:'builderOrder',s:'bogus',p:0}])g.exec(c);assert.equal(b.paused,true);assert.equal(b.reserve,10);
 order(g,'develop');ticks(g,100);const gold=g.gold;b.hp=1;g.zombies=[{id:123,x:b.x,z:b.z,hp:10,dead:false,state:2,atkT:0,stunT:0,def:{dmg:60}}];ticks(g,1);assert.equal(b.hp,0);assert.ok(b.recover>0);assert.ok(g.gold>=gold);g.zombies=[];ticks(g,1600);assert.equal(b.recover,0);assert.ok(b.hp>0);
});
test('minor wall wear cannot starve development; established frontier holdings remain serviceable',()=>{
 const g=fresh(),b=g.builders,wall=g.plots.find(p=>p.kind==='wall'&&p.role!=='outer');g._construct(wall,true);const section=g.buildings.find(x=>x.plotId===wall.id);section.hp-=1;
 order(g,'develop');assert.ok(builderCandidates(g,b).choices.every(c=>c.p.id!==wall.id));
 order(g,'maintain');assert.ok(builderCandidates(g,b).choices.some(c=>c.p.id===wall.id));
 const fort=g.plots.find(p=>p.role==='outer'),same=p=>p.keep?.[0]===fort.keep[0]&&p.keep?.[1]===fort.keep[1];
 for(const p of g.plots.filter(same))if(p.kind==='wall'||p.outerDefense!=null)g._construct(p,true);
 g.heroes[0].x=fort.cx;g.heroes[0].z=fort.cz;order(g,'fortify');assert.ok(builderCandidates(g,b).choices.some(c=>same(c.p)),'Fortify should upgrade an already secured outpost');
});
test('Expand finishes one selected fort before another; configured doctrines permit upgrades',()=>{
 const g=fresh(),b=g.builders,fort=g.plots.find(p=>p.role==='outer');g.heroes[0].x=fort.cx;g.heroes[0].z=fort.cz;
 order(g,'expand');b.frontier=`fort:${fort.keep.join(',')}`;
 const other=g.plots.find(p=>p.role==='outer'&&p.keep.join(',')!==fort.keep.join(','));
 g._spawnUnit('soldier',other.cx,other.cz);
 const frontier=builderCandidates(g,b).choices.filter(c=>c.p.role==='outer');assert.ok(frontier.length);assert.ok(frontier.every(c=>c.p.keep.join(',')===fort.keep.join(',')));
 const tower=g.plots.find(p=>p.kind==='tower'&&!p.keep);g._construct(tower,true);g._construct(tower,true);order(g,'fortify');assert.ok(!builderCandidates(g,b).choices.some(c=>c.p.id===tower.id));
 g.exec({t:'builderDoctrine',kind:'tower',branch:'flame',p:0});assert.ok(builderCandidates(g,b).choices.some(c=>c.p.id===tower.id&&c.branch==='flame'));
});
test('a newly sealed route cannot teleport the worker or charge a stranded job',()=>{
 const g=fresh(),b=g.builders;order(g,'prosper');for(let i=0;i<3000&&!b.route.length;i++)ticks(g,1);assert.ok(b.job&&b.route.length);
 const original=g.map.isWalkable.bind(g.map),x=b.x|0,z=b.z|0;
 g.map.isWalkable=(nx,nz)=>Math.abs(nx-x)+Math.abs(nz-z)===1?false:original(nx,nz);
 const start=[b.x,b.z],gold=g.gold;ticks(g,300);assert.deepEqual([b.x,b.z],start);assert.equal(g.gold,gold);assert.equal(b.paid,0);
});
test('a new critical repair interrupts and refunds discretionary work',()=>{
 const g=fresh(),b=g.builders;order(g,'prosper');for(let i=0;i<3000&&!b.job;i++)ticks(g,1);assert.ok(b.job);
 const hq=g.plots.find(p=>p.kind==='hq');g.hq.hp=g.hq.maxHp*.3;
 ticks(g,122);assert.ok(b.job?.id===hq.id||g.hq.hp>g.hq.maxHp*.3,'new emergency must displace discretionary job');
});
test('an unaffordable emergency saves instead of repeatedly buying and cancelling lesser work',()=>{
 const g=fresh(),b=g.builders;g.hq.hp=g.hq.maxHp*.3;g.gold=30;order(g,'develop');const gold=g.gold;ticks(g,600);
 assert.equal(b.job,null);assert.equal(b.status,'Saving gold');assert.equal(g.gold,gold);assert.equal(b.completed,0);
});

test('host can pause and protect gold while their hero is down',()=>{
 const g=fresh();order(g,'develop');g.heroes[0].dead=true;g.exec({t:'builderPause',on:true,p:0});g.exec({t:'builderReserve',gold:100,p:0});
 assert.equal(g.builders.paused,true);assert.equal(g.builders.reserve,100);const gold=g.gold;ticks(g,120);assert.equal(g.gold,gold);
});
test('worker takes actual bites, not damage from stunned, idle, or engaged enemies',()=>{
 const g=fresh(),b=g.builders;g.exec({t:'builderPause',on:true,p:0});const e={id:777,x:b.x,z:b.z,hp:100,dead:false,state:2,atkT:0,stunT:5,def:{dmg:10}};g.zombies=[e];
 const hp=b.hp;ticks(g,1);assert.equal(b.hp,hp);e.stunT=0;e.windup={t:.4};ticks(g,1);assert.equal(b.hp,hp);e.windup=null;e.state=0;ticks(g,1);assert.equal(b.hp,hp);
 e.state=2;e.targetU={dead:false};ticks(g,1);assert.equal(b.hp,hp);e.targetU=null;e.x=b.x;e.z=b.z;ticks(g,1);
 assert.equal(b.hp,hp-10);assert.equal(e.atkT,.8);assert.ok(g.events.some(x=>x.type==='bite'&&x.fromId===777));
 ticks(g,1);assert.equal(b.hp,hp-10,'same enemy cannot double-bite without its combat cooldown elapsing');
});
test('lost node ownership cancels a queued satellite job without spending',()=>{
 const g=fresh(),b=g.builders,p=g.plots.find(p=>p.kind==='outpost'),n=g.nodes[p.nodeId];n.owner='player';b.x=p.cx+3;b.z=p.cz;order(g,'expand');
 // Keep only this eligible frontier job; captured nodes are the input contract.
 const others=g.plots;g.plots=[...others.filter(q=>q.kind==='hq'),p];ticks(g,1);assert.equal(b.job?.id,p.id);
 const gold=g.gold,escrow=b.paid;assert.ok(escrow>0);n.owner='hive';ticks(g,1);assert.equal(b.job,null);assert.equal(b.status,'Territory lost');assert.ok(Math.abs(g.gold-gold-escrow)<1e-6);
});
test('cancelling a configured branch purchase does not consume the specialisation',()=>{
 const g=fresh(),b=g.builders,p=g.plots.find(p=>p.kind==='tower'&&!p.keep);g._construct(p,true);g._construct(p,true);
 g.plots=g.plots.filter(q=>q.kind==='hq'||q===p);order(g,'fortify');g.exec({t:'builderDoctrine',kind:'tower',branch:'flame',p:0});
 for(let i=0;i<3000&&!b.paid;i++)ticks(g,1);assert.ok(b.paid>0);assert.equal(p.branch,null);
 const gold=g.gold,paid=b.paid;g.exec({t:'builderPause',on:true,p:0});assert.equal(p.branch,null);assert.ok(Math.abs(g.gold-gold-paid)<1e-6);assert.equal(p.tier,2);
});
