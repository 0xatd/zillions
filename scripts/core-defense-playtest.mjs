// Bounded command-only core playtest. No currency, health or kill mutations.
// node scripts/core-defense-playtest.mjs [develop|mobilize] [seconds=600] [levelId=1] [defensive]
import {Game} from '../src/game.js';
import {TerrainField} from '../src/terrain.js';
import {levelById,SIM_DT} from '../src/config.js';
const opening=process.argv[2]||'develop',cap=Number(process.argv[3]||600),levelId=Number(process.argv[4]||1);
const defensive=process.argv[5]==='defensive';
const level=levelById(levelId),map=new TerrainField(level.seed,level.theme,{size:level.size,nests:level.nests});
const game=new Game(map,'normal','scott',null,levelId,'campaign',{rngSeed:43});
const heroRoutes=new Map(),command=c=>game.exec(c),events=[],checkpoints=[];
  function findRoute(hero, goalX, goalZ, stopRadius = 1) {
    const size = game.map.size;
    const sx = Math.max(0, Math.min(size - 1, Math.floor(hero.x)));
    const sz = Math.max(0, Math.min(size - 1, Math.floor(hero.z)));
    const queue = new Int32Array(size * size);
    const previous = new Int32Array(size * size).fill(-2);
    let head = 0, tail = 0, end = -1;
    const start = sz * size + sx;
    queue[tail++] = start;
    previous[start] = -1;
    while (head < tail) {
      const key = queue[head++], x = key % size, z = Math.floor(key / size);
      if (Math.hypot(x + 0.5 - goalX, z + 0.5 - goalZ) <= stopRadius) { end = key; break; }
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, nz = z + dz, next = nz * size + nx;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size || previous[next] !== -2) continue;
        if (!game.map.isWalkable(nx, nz)) continue;
      const o = game.occ[next]; if (o && !game.gateIds.has(o)) continue;
        previous[next] = key;
        queue[tail++] = next;
      }
    }
    if (end < 0) return [];
    const reversed = [];
    for (let key = end; key !== -1; key = previous[key]) reversed.push([key % size + 0.5, Math.floor(key / size) + 0.5]);
    return reversed.reverse().slice(1);
  }
  function moveHeroToward(hero, x, z, sprint = true, stopRadius = 1) {
    let {route=[],routeGoal=''}=heroRoutes.get(hero.id)||{};
    const player=game.heroes.indexOf(hero);
    const goal = `${Math.floor(x)},${Math.floor(z)},${stopRadius}`;
    // A cached route is stale once something was built across it (the hero
    // paid for a wall standing on its line, then walked into the new stone).
    const blocked = route.length && route.slice(0, 3).some(([rx, rz]) => {
      const o = game.occ[(rz | 0) * game.map.size + (rx | 0)];
      return o && !game.gateIds.has(o);
    });
    if (blocked || routeGoal !== goal || !route.length || Math.hypot(route[0][0] - hero.x, route[0][1] - hero.z) > 1.6) {
      routeGoal = goal;
      route = findRoute(hero, x, z, stopRadius);
      // Goal ringed by buildings (a plot built shut on every side): settle
      // for the nearest reachable tile instead of pressing into the stone.
      for (let r = stopRadius + 1; !route.length && r <= stopRadius + 4; r++) route = findRoute(hero, x, z, r);
    }
    while (route.length && Math.hypot(route[0][0] - hero.x, route[0][1] - hero.z) < 0.5) route.shift();
    const [tx, tz] = route[0] || [x, z];
    const dx = tx - hero.x;
    const dz = tz - hero.z;
    const distance = Math.hypot(dx, dz) || 1;
    command({ t: 'hdir', x: dx / distance, z: dz / distance, s: sprint, p: player });
    heroRoutes.set(hero.id,{route,routeGoal});
    return Math.hypot(x - hero.x, z - hero.z);
  }
let switched=false,lastStance=null,nextThink=0,nextLog=0;const start=Date.now();
const stance=s=>{if(lastStance!==s){command({t:'stance',s,p:0});lastStance=s;}};
while(!game.over&&game.time<cap){
 if(game.time>=nextThink){nextThink=game.time+SIM_DT*.5;const h=game.hero;
  if(game.phase==='found'){
   const site=map.sites[0];if(moveHeroToward(h,site.x,site.z,true,1.8)<2.2){command({t:'hdir',x:0,z:0,p:0});command({t:'found',s:0,p:0});command({t:'builderOrder',s:opening,p:0});command({t:'builderDoctrine',kind:'tower',branch:'flame',p:0});command({t:'builderDoctrine',kind:'wall',branch:'bastion',p:0});}
  }else if(!h.dead){
   if(game.time>60&&!switched){command({t:'builderOrder',s:'develop',p:0});switched=true;}
   const choice=game.heroUpgradeChoices(h).filter(c=>c.rank<c.max).sort((a,b)=>a.rank-b.rank)[0];if(h.skillPoints&&choice)command({t:'heroUpgrade',key:choice.key,p:0});
   const live=game.zombies.filter(z=>!z.dead),near=live.filter(z=>Math.hypot(z.x-h.x,z.z-h.z)<15).sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z));
   const atBase=live.filter(z=>Math.hypot(z.x-game.hq.cx,z.z-game.hq.cz)<12);
   const first=live.filter(z=>game.firstSiege?.waveIds.includes(z.id));
   const nest=game.nests.filter(n=>n.alive&&!n.offMap).sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0];
   const military=game.plots.filter(p=>p.kind.startsWith('camp_')&&p.tier>0&&!p.ruined).length;
   const towers=game.plots.filter(p=>p.kind==='tower'&&p.tier>0&&!p.ruined).length;
   const developed=game.time>=180&&military>=2&&towers>=3;
   const defend=defensive&&(!developed||atBase.length>0||game.hq.hp<game.hq.maxHp*.6);
   const enemy=(defend?atBase.sort((a,b)=>Math.hypot(a.x-game.hq.cx,a.z-game.hq.cz)-Math.hypot(b.x-game.hq.cx,b.z-game.hq.cz))[0]:null)||near[0]||first[0]||atBase[0]||game.boss;
   const attack=!defend&&(game.firstSiege?game.firstSiege.stage==='complete':game.time>=45);stance(attack?'attack':defensive?'defend':'guard');
   let target=enemy||(attack?nest:null)||game.hq;
   if(defend&&!atBase.length&&Math.hypot(h.x-game.hq.cx,h.z-game.hq.cz)>12)target=game.hq;
   if(h.hp<h.maxHp*.25&&Math.hypot(h.x-game.hq.cx,h.z-game.hq.cz)>8)target=game.hq;
   for(let slot=0;slot<(h.def.abilities?.length||1);slot++)command({t:'cast',p:0,slot,...(enemy?{id:enemy.id,x:enemy.x,z:enemy.z}:{})});
   const x=target.x??target.cx,z=target.z??target.cz,range=Math.max(1.5,game.heroRange(h)*.8);
   if(Math.hypot(x-h.x,z-h.z)<=range){command({t:'hdir',x:0,z:0,p:0});if(enemy)command({t:'focus',id:enemy.id,p:0});}
   else moveHeroToward(h,x,z,true,range);
  }
 }
 game.update(SIM_DT);
 for(const e of game.events)if(['firstsiege','nestdown','bossdown','victory','defeat','founded'].includes(e.type))events.push({at:Math.round(game.time),...e});
 game.events=[];
 if(game.time>=nextLog){nextLog+=60;const sample={seconds:Math.round(game.time),gold:Math.round(game.gold),hq:Math.round(game.hq?.hp||0),heroHp:Math.round(game.hero?.hp||0),heroLevel:game.hero?.level,heroX:game.hero?.x,heroZ:game.hero?.z,first:game.firstSiege?.stage,nests:game.liveNests(),kills:game.stats.kills,built:game.stats.built,crew:game.builders?.status,troops:game.units.filter(u=>!u.hero&&!u.dead).length};checkpoints.push(sample);console.log(JSON.stringify({checkpoint:sample}));}
}
console.log(JSON.stringify({result:{levelId,opening,defensive,seconds:Math.round(game.time),wallSeconds:Math.round((Date.now()-start)/1000),over:game.over,won:game.won,hives:game.nests.map(n=>({id:n.id,alive:n.alive,hp:Math.round(n.hp),offMap:!!n.offMap})),boss:game.boss?{hp:game.boss.hp}:null,heroDeaths:game.stats.heroDeaths,stats:game.stats,crew:game.builders?{jobs:game.builders.completed,spent:game.builders.spent,status:game.builders.status}:null,events,checkpoints}}));
