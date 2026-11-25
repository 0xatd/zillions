import { applyUnitBuff } from './combat-buffs.js';
// Deterministic multi-slot spell runtime. Pending casts are plain data and
// belong to the hero snapshot, never to renderer timers or DOM callbacks.
import {heroAbility, abilityCooldown, setAbilityCooldown} from './hero-abilities.js';
import {fogVisionSources} from './fog-of-war.js';
const d2=(a,b)=>(a.x-b.x)**2+(a.z-b.z)**2;
const value=(v,rank)=>Array.isArray(v)?v[Math.min(v.length-1,rank)]:v||0;
export const SPELL_UPGRADE_KEYS = ['aura','passive1','ult','passive2'];
export const spellRank=(h,slot=0)=>Math.min(2,Math.max(0,h.upgrades?.[SPELL_UPGRADE_KEYS[slot]]||0));
export function spellCooldownBase(h,slot=0) { return value(heroAbility(h.def,slot)?.cd,spellRank(h,slot)); }
export function spellManaCost(h,slot) { return value(heroAbility(h.def,slot)?.mana,spellRank(h,slot)); }
export function spellState(h) {
  return h.spells ||= {mana:h.def.mana||0,effects:[],soul:0,soulT:0,charges:{},aimT:0,aimRange:0,helixHits:0,helixCd:0,cullArmor:0};
}
export function spellTarget(g,h,ab,input={}) {
  if(ab.target==='self')return {x:h.x,z:h.z};
  const range=ab.range||12;
  if(ab.target==='enemy') {
    const id=input.id??h.focusId??h.target?.id;
    const enemy=g.zombies.find(z=>z.id===id&&!z.dead&&z.hp>0);
    const vision=fogVisionSources(g);
    return enemy&&d2(h,enemy)<=range**2&&vision.some(v=>d2(v,enemy)<v.radius**2)?enemy:null;
  }
  const x=input.x??h.x+Math.sin(h.facing)*range;
  const z=input.z??h.z+Math.cos(h.facing)*range;
  if(!Number.isFinite(x)||!Number.isFinite(z)||x<0||z<0||x>=g.map.size||z>=g.map.size)return null;
  if(d2(h,{x,z})>range**2+.01)return null;
  return {x,z};
}
function hit(g,h,e,z) {
  if(z.dead||z.hp<=0)return;
  if(e.stun)z.stunT=Math.max(z.stunT||0,e.stun);
  if(e.slow){z.slowT=Math.max(z.slowT||0,.6);z.slowMul=Math.min(z.slowMul??1,e.slow);}
  g.damageZombie(z,e.damage,h.x,h.z,e.types||null,null,!!e.pure);
  if(h.def.fierySoul){const s=spellState(h);s.soul=Math.min(7,s.soul+1);s.soulT=16;}
}
export function castSpell(g,h,slot,input={}) {
  const ab=heroAbility(h.def,slot);
  if(!ab?.spell||h.dead||abilityCooldown(h,slot)>0)return false;
  const s=spellState(h),rank=spellRank(h,slot),mana=value(ab.mana,rank);
  if(s.mana<mana)return false;
  let charge=null;
  if(ab.charges){
    s.charges ||= {};charge=s.charges[slot] ||= {count:ab.charges,t:0};
    if(charge.count<=0)return false;
  }
  const target=spellTarget(g,h,ab,input);
  if(!target)return false;
  const effect={kind:ab.spell,slot,x:target.x,z:target.z,sx:h.x,sz:h.z,
    targetId:ab.target==='enemy'?target.id:null,delay:ab.delay||0,channel:!!ab.channel,
    damage:value(ab.damage,rank),stun:value(ab.stun,rank),radius:ab.radius||0,
    slow:ab.slow||0,types:ab.types||null,pure:!!ab.pure,t:ab.duration||0,hit:[],kills:target.killCount||0};
  if(ab.projectileSpeed)effect.delay+=Math.sqrt(d2(h,target))/ab.projectileSpeed;
  if(ab.spell==='taunt'){effect.targets=g.zombies.filter(z=>!z.dead&&d2(h,z)<=ab.radius**2).map(z=>z.id);}
  if(ab.spell==='wave') {
    const distance=Math.hypot(target.x-h.x,target.z-h.z);
    if(distance<.001)return false;
    effect.dx=(target.x-h.x)/distance;effect.dz=(target.z-h.z)/distance;
    effect.x=h.x;effect.z=h.z;effect.speed=ab.speed;effect.remaining=ab.range;
  }
  s.mana-=mana;
  if(charge){charge.count--;if(!charge.t)charge.t=ab.recharge;}
  if(ab.spell==='taunt'){h.fortifyT=ab.duration;h.fortifyArmor=ab.armor;h.fortifyThorns=0;for(const z of g.zombies)if(effect.targets.includes(z.id)){z.targetU=h;z.retarget=.3;z.state=2;z.windup=null;}}
  if(ab.spell==='buff'){
    const mods=Object.fromEntries(Object.entries(ab.mods).map(([key,v])=>[key,value(v,rank)]));
    for(const ally of g.units)if(!ally.dead&&(ab.selfOnly?ally.id===h.id:d2(h,ally)<=ab.radius**2))applyUnitBuff(ally,ab.key,h.id,ab.duration,mods);
  }
  if(ab.spell==='aim'){s.aimT=ab.duration;s.aimRange=value(ab.rangeBonus,rank);}
  setAbilityCooldown(h,slot,value(ab.cd,rank)*Math.max(.15,1-h.mods.cdr));
  if(!['aim','buff'].includes(ab.spell))s.effects.push(effect);
  g.emit({type:'cast',heroId:h.id,x:h.x,z:h.z,radius:ab.radius||3,icon:ab.icon,key:ab.key});
  return true;
}
export function updateSpells(g,h,dt) {
  if(!h.def.mana&&!h.spells)return;
  const s=spellState(h);
  if(!h.dead)s.mana=Math.min(h.def.mana||0,s.mana+(h.def.manaRegen||0)*dt);
  s.helixCd=Math.max(0,(s.helixCd||0)-dt);
  s.aimT=Math.max(0,(s.aimT||0)-dt);
  for(const [slot,charge] of Object.entries(s.charges||{})){
    const ab=heroAbility(h.def,Number(slot));if(!ab?.charges||charge.count>=ab.charges)continue;
    charge.t-=dt;
    while(charge.t<=0&&charge.count<ab.charges){charge.count++;charge.t+=ab.recharge;}
    if(charge.count===ab.charges)charge.t=0;
  }
  s.soulT=Math.max(0,s.soulT-dt);if(!s.soulT)s.soul=0;
  const keep=[],zoneHits=new Map();
  for(const e of s.effects) {
    if(e.channel&&(h.dead||h.mx!==0||h.mz!==0||h.dodgeT>0))continue;
    // Spend only the portion of this tick after the wind-up ends.
    let activeDt=dt;
    if(e.delay>0){const delay=e.delay;e.delay=Math.max(0,delay-dt);activeDt=Math.max(0,dt-delay);if(!activeDt){keep.push(e);continue;}}
    if(e.kind==='taunt') {
      if(h.dead)continue;
      e.t-=activeDt;
      if(e.t>0){for(const z of g.zombies)if(!z.dead&&e.targets.includes(z.id)){z.targetU=h;z.retarget=Math.max(z.retarget||0,.3);z.state=2;}keep.push(e);}
    } else if(e.kind==='curse') {
      const z=g.zombies.find(z=>z.id===e.targetId&&!z.dead);
      if(!z||(z.killCount||0)!==e.kills)continue;
      const duration=Math.min(activeDt,e.t);e.t-=duration;hit(g,h,{...e,damage:e.damage*duration},z);
      if(e.t>0&&!z.dead)keep.push(e);
    } else if(e.kind==='wave') {
      const travel=Math.min(e.remaining,e.speed*activeDt),ax=e.x,az=e.z;
      e.x+=e.dx*travel;e.z+=e.dz*travel;e.remaining-=travel;
      for(const z of g.zombies) {
        if(z.dead||e.hit.includes(z.id))continue;
        const along=Math.max(0,Math.min(travel,(z.x-ax)*e.dx+(z.z-az)*e.dz));
        if((z.x-ax-e.dx*along)**2+(z.z-az-e.dz*along)**2<=e.radius**2){e.hit.push(z.id);hit(g,h,e,z);}
      }
      g.emit({type:'brewzone',x:e.x,z:e.z,r:e.radius});
      if(e.remaining>0)keep.push(e);
    } else if(e.kind==='zone') {
      const duration=Math.min(activeDt,e.t);e.t-=duration;
      for(const z of g.zombies)if(!z.dead&&d2(e,z)<=e.radius**2){
        const damage=e.damage*duration,prior=zoneHits.get(z.id);
        if(!prior||prior.effect.damage<damage)zoneHits.set(z.id,{target:z,effect:{...e,damage}});
      }
      if(e.t>0)keep.push(e);
      g.emit({type:'brewzone',x:e.x,z:e.z,r:e.radius});
    } else if(e.kind==='blast') {
      for(const z of g.zombies)if(d2(e,z)<=e.radius**2)hit(g,h,e,z);
      g.emit({type:'groundstrike',x:e.x,z:e.z,radius:e.radius});
    } else if(e.kind==='bolt'||e.kind==='cull') {
      const z=g.zombies.find(z=>z.id===e.targetId&&!z.dead);
      if(z){
        if(e.radius){for(const other of g.zombies)if(d2(z,other)<=e.radius**2)hit(g,h,e,other);}else hit(g,h,e,z);
        if(e.kind==='cull'&&z.boss&&z.dead){setAbilityCooldown(h,e.slot,0);s.cullArmor=(s.cullArmor||0)+.015;}g.emit({type:'shot',kind:'hero',heroKey:h.key,fromId:h.id,fx:h.x,fz:h.z,tx:z.x,tz:z.z,fy:1});}
    }
  }
  for(const {effect,target} of zoneHits.values())hit(g,h,effect,target);
  s.effects=keep;
}
export function spellAttackSpeed(h) {
  return h.def.fierySoul?1+(h.spells?.soul||0)*value(h.def.fierySoul.attackSpeed,spellRank(h,3)):1;
}
export function spellMoveSpeed(h) {
  return (h.spells?.aimT>0?.35:1) * (h.def.fierySoul?1+(h.spells?.soul||0)*value(h.def.fierySoul.moveSpeed,spellRank(h,3)):1);
}

export function spellAttack(g,h,target,damage) {
  if(h.def.keenScope)damage*=1+Math.sqrt(d2(h,target))*h.def.keenScope;
  if(h.def.headshot&&(h.spells?.aimT>0||g.rng()<h.def.headshot.chance)) {
    damage+=value(h.def.headshot.damage,spellRank(h,3));
    target.stunT=Math.max(target.stunT||0,value(h.def.headshot.stun,spellRank(h,3)));
    if(!target.boss){const d=Math.sqrt(d2(h,target))||1;const x=target.x+(target.x-h.x)/d*.5,z=target.z+(target.z-h.z)/d*.5;
      if(g.map.isWalkable(x|0,z|0)&&g.occ[(z|0)*g.map.size+(x|0)]===0){target.x=x;target.z=z;}}
  }
  return damage;
}

export function spellOnAttackTaken(g,h,attacker) {
  if(!h.hero||!h.def.counterHelix||!attacker||h.dead)return;
  const s=spellState(h),ab=h.def.counterHelix,rank=spellRank(h,3);
  s.helixHits=(s.helixHits||0)+1;
  if(s.helixHits<value(ab.attacks,rank)||s.helixCd>0)return;
  s.helixHits=0;s.helixCd=ab.cd;
  for(const z of g.zombies)if(!z.dead&&d2(h,z)<=ab.radius**2)g.damageZombie(z,value(ab.damage,rank),h.x,h.z,null,null,true);
  g.emit({type:'cast',heroId:h.id,x:h.x,z:h.z,radius:ab.radius,icon:'↻',key:'counter_helix'});
}

export function spellAfterAttack(g,h,target,damage) {
  const cleave=h.def.cleave;if(!cleave)return;
  const distance=Math.sqrt(d2(h,target));if(distance<.001)return;
  const dx=(target.x-h.x)/distance,dz=(target.z-h.z)/distance;
  for(const z of g.zombies){
    if(z.dead||z.id===target.id)continue;
    const along=(z.x-h.x)*dx+(z.z-h.z)*dz,across=Math.abs((z.x-h.x)*dz-(z.z-h.z)*dx);
    if(along>=distance&&along<=distance+cleave.distance&&across<=cleave.width*along/(distance+cleave.distance))
      g.damageZombie(z,damage*value(cleave.share,spellRank(h,3)),h.x,h.z,{kinetic:1});
  }
}
