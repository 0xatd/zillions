// Presentation only: never mutate hero definitions, progression or simulation.
export function heroCopy(def, character) {
  if (!character || character.chapterLeader) return def;
  const clean = value => typeof value === 'string' ? value.replaceAll(def.name, 'the commander')
    .replace(new RegExp(`\\b${def.name.split(' ')[0]}\\b`, 'g'), 'the commander')
    .replace(/shotgun/gi, 'weapon') : value;
  const ability = a => a ? { ...a, desc: clean(a.desc) } : a;
  return { ...def, name: character.name, desc: clean(def.desc), tagline: clean(def.tagline),
    aura: ability(def.aura), ability: ability(def.ability),
    passives: def.passives?.map(ability), abilities: def.abilities?.map(ability) };
}

export function bearing(from, to) {
  if (!from || !to) return '';
  const dx = to.x - from.x, dz = to.z - from.z;
  if (!Number.isFinite(dx + dz)) return '';
  if (Math.hypot(dx, dz) < 5) return 'nearby';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(Math.atan2(dx, -dz) / (Math.PI / 4) + 8) % 8];
}
