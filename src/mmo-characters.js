// Persistent player-created characters for the galaxy game. Named Zillions
// heroes remain in Custom Games; MMO characters carry their own class, level,
// equipment, appearance and last world between instances.

export const MAX_MMO_CHARACTERS = 8;

export const MMO_CLASSES = {
  berserker: { name: 'Berserker', icon: '🪓', role: 'Melee bruiser and horde breaker', proxy: 'john', resource: 'Fury' },
  vox_officer: { name: 'Vox Officer', icon: '📡', role: 'Morale, commands and squad support', proxy: 'aaron', resource: 'Command' },
  chaplain: { name: 'Chaplain', icon: '✚', role: 'Healing, wards and anti-corruption rites', proxy: 'aaron', resource: 'Conviction' },
  xenoshaper: { name: 'Xenoshaper', icon: '🧬', role: 'Mutation, living armor and battlefield growth', proxy: 'turtle', resource: 'Biomass' },
  vanguard: { name: 'Vanguard', icon: '⚔️', role: 'Weapon mastery, armor and frontline command', proxy: 'scott', resource: 'Resolve', ready: true },
  voidblade: { name: 'Voidblade', icon: '☯', role: 'Mobility, deflection and rapid strike chains', proxy: 'danny', resource: 'Focus' },
  warden: { name: 'Warden', icon: '🛡️', role: 'Powered armor, auras and execution strikes', proxy: 'turtle', resource: 'Oath' },
  recon: { name: 'Recon', icon: '🎯', role: 'Long vision, marks, traps and precision fire', proxy: 'alexander', resource: 'Focus' },
  operative: { name: 'Operative', icon: '🗡️', role: 'Stealth, sabotage and weak-point attacks', proxy: 'danny', resource: 'Edge' },
  psion: { name: 'Psion', icon: '🔮', role: 'Innate warp force and unstable control', proxy: 'tiger', resource: 'Strain' },
  voidbound: { name: 'Voidbound', icon: '👁️', role: 'Pacts, curses and summoned entities', proxy: 'tiger', resource: 'Corruption' },
  arcanist: { name: 'Arcanist', icon: '✦', role: 'Prepared technomancy and broad control', proxy: 'alexander', resource: 'Flux' },
  engineer: { name: 'Engineer', icon: '⚙️', role: 'Deployables, repairs and fortress mastery', proxy: 'aaron', resource: 'Charge' },
};

export const APPEARANCES = {
  iron: { name: 'Iron', color: '#8493a6' },
  crimson: { name: 'Crimson', color: '#b94b51' },
  cobalt: { name: 'Cobalt', color: '#4679b8' },
  bone: { name: 'Bone', color: '#b7aa8c' },
  void: { name: 'Void', color: '#6d568f' },
  forest: { name: 'Forest', color: '#4f785d' },
};

const cleanName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 18);

export function makeMmoCharacter(name, classKey = 'vanguard', appearance = 'iron') {
  const klass = MMO_CLASSES[classKey] || MMO_CLASSES.vanguard;
  const now = Date.now();
  return {
    id: `mmo_${now.toString(36)}_${Math.floor(Math.random() * 1679616).toString(36)}`,
    name: cleanName(name) || 'Nameless',
    classKey: MMO_CLASSES[classKey] ? classKey : 'vanguard',
    appearance: APPEARANCES[appearance] ? appearance : 'iron',
    proxyHero: klass.proxy,
    level: 1,
    xp: 0,
    talentPoints: 0,
    items: [],
    upgrades: {},
    lastWorld: 'earth',
    createdAt: now,
    stats: { instances: 0, victories: 0, kills: 0 },
  };
}

export function normalizeMmoCharacters(profile) {
  profile.mmoCharacters = Array.isArray(profile.mmoCharacters)
    ? profile.mmoCharacters.filter((c) => c && c.id && MMO_CLASSES[c.classKey]).slice(0, MAX_MMO_CHARACTERS)
    : [];
  for (const character of profile.mmoCharacters) {
    const klass = MMO_CLASSES[character.classKey];
    character.proxyHero = klass.proxy;
    character.level = Math.max(1, Math.min(100, Number(character.level) || 1));
    character.xp = Math.max(0, Number(character.xp) || 0);
    character.items = Array.isArray(character.items) ? character.items : [];
    character.upgrades = character.upgrades && typeof character.upgrades === 'object' ? character.upgrades : {};
    character.stats = { instances: 0, victories: 0, kills: 0, ...(character.stats || {}) };
    character.lastWorld = character.lastWorld || profile.lastWorld || 'earth';
  }
  if (!profile.mmoCharacters.some((c) => c.id === profile.mmoCharacterId)) {
    profile.mmoCharacterId = profile.mmoCharacters[0]?.id || null;
  }
  return profile.mmoCharacters;
}

export function selectedMmoCharacter(profile) {
  normalizeMmoCharacters(profile);
  return profile.mmoCharacters.find((c) => c.id === profile.mmoCharacterId) || null;
}

export function addMmoCharacter(profile, character) {
  normalizeMmoCharacters(profile);
  if (!character || profile.mmoCharacters.length >= MAX_MMO_CHARACTERS) return null;
  profile.mmoCharacters.push(character);
  profile.mmoCharacterId = character.id;
  return character;
}

export function xpToMmoLevel(level) {
  const n = Math.max(1, Math.min(99, Number(level) || 1));
  return 120 + n * 55 + Math.floor(n ** 1.55 * 18);
}

export function grantMmoExperience(character, amount) {
  if (!character) return [];
  const levels = [];
  character.xp += Math.max(0, Math.floor(Number(amount) || 0));
  while (character.level < 100 && character.xp >= xpToMmoLevel(character.level)) {
    character.xp -= xpToMmoLevel(character.level);
    character.level++;
    character.talentPoints = (character.talentPoints || 0) + 1;
    levels.push(character.level);
  }
  return levels;
}

export function characterCamp(character, relics = []) {
  return {
    level: character?.level || 1,
    xp: character?.xp || 0,
    items: [...(character?.items || [])],
    upgrades: { ...(character?.upgrades || {}) },
    relics: [...relics],
  };
}

export function recordMmoInstance(character, { won = false, kills = 0, xp = 0, world = null, items = [] } = {}) {
  if (!character) return { levels: [], items: [] };
  character.stats.instances++;
  if (won) character.stats.victories++;
  character.stats.kills += Math.max(0, kills | 0);
  if (world) character.lastWorld = world;
  const granted = [];
  for (const item of items) {
    if (item && !character.items.includes(item)) { character.items.push(item); granted.push(item); }
  }
  return { levels: grantMmoExperience(character, xp), items: granted };
}
