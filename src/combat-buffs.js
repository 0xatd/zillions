// Timed friendly modifiers. Same named buffs from multiple casters use the
// strongest contribution, not additive stacking; different buffs can combine.
export function applyUnitBuff(unit,kind,source,duration,mods) {
  unit.spellBuffs ||= {};
  unit.spellBuffs[`${kind}:${source}`]={kind,t:duration,mods:{...mods}};
}
export function tickUnitBuffs(unit,dt) {
  for(const [key,buff] of Object.entries(unit.spellBuffs||{})) {
    buff.t=Math.max(0,buff.t-dt);
    if(!buff.t)delete unit.spellBuffs[key];
  }
}
export function unitBuffMod(unit,mod) {
  const groups=new Map();
  for(const buff of Object.values(unit.spellBuffs||{})) {
    if(buff.t<=0)continue;
    const value=buff.mods[mod]||0,prior=groups.get(buff.kind)||0;
    if(Math.abs(value)>Math.abs(prior))groups.set(buff.kind,value);
  }
  let total=0;for(const value of groups.values())total+=value;
  return total;
}
