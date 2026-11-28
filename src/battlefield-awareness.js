import {fogVisionSources, visibleInFog} from './fog-of-war.js';
// Presentation only. Enemy information is bounded by actual allied sight.
export function battlefieldAwareness(game) {
 const vision=fogVisionSources(game),composition={},fights=[];
 const living=game.units.filter(u=>!u.dead&&u.hp>0);
 for(const u of living)if(!u.hero){const name=u.def?.name||u.key||'Troops';composition[name]=(composition[name]||0)+1;}
 const engagedIds = new Set(living.filter(u => u.target && Math.hypot(u.x-u.target.x,u.z-u.target.z)<(u.weapon?.range||u.def?.range||6)+1).map(u => u.target.id));
 const enemies=game.zombies.filter(e=>!e.dead&&e.hp>0&&visibleInFog(vision,e.x,e.z));
 for(const e of enemies){
  const attacking=e.targetU && !e.targetU.dead && Math.hypot(e.x-e.targetU.x,e.z-e.targetU.z)<8;
  const engaged=attacking||engagedIds.has(e.id);
  if(!engaged||fights.some(f=>Math.hypot(f.x-e.x,f.z-e.z)<12))continue;
  fights.push({x:Math.round(e.x/4)*4,z:Math.round(e.z/4)*4});if(fights.length===4)break;
 }
 return {troops:living.filter(u=>!u.hero).length,enemies:enemies.length,composition,fights};
}
