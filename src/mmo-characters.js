// Persistent player-created characters for the galaxy game. Named Zillions
// heroes remain in Custom Games; MMO characters carry their own class, level,
// equipment, appearance and last world between instances.

import { EQUIP_SLOTS, slotPool, isRolledKey, meetsRequirement } from './items.js';
import {
  pruneAlloc, latticePoints, treeBonuses, canAllocate, canDeallocate, LATTICE_VERSION,
} from './skilltree.js';
import { itemInfo, itemMods } from './config.js';

export const MAX_MMO_CHARACTERS = 8;
// What a character can keep between adventures. Rolled gear is unique, so
// without a cap a stash grows without bound inside the profile blob.
export const STASH_SLOTS = 60;

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

// What each class is made of. The primary attribute grows every level, the
// others slowly — so a class reaches its own weapon family on the way up and
// has to buy attribute nodes on the Lattice to wield somebody else's.
export const CLASS_ATTRS = {
  berserker: 'frame', vox_officer: 'signal', chaplain: 'signal', xenoshaper: 'frame',
  vanguard: 'frame', voidblade: 'reflex', warden: 'frame', recon: 'reflex',
  operative: 'reflex', psion: 'signal', voidbound: 'signal', arcanist: 'signal',
  engineer: 'reflex',
};

export const ATTR_BASE = 8;          // every attribute starts here
export const ATTR_PRIMARY_BASE = 12; // the class's own attribute starts higher

// Attributes from the character alone — class, level, and nothing else. Gear
// and the Lattice add to this; see characterAttributes().
export function baseAttributes(character) {
  const primary = CLASS_ATTRS[character?.classKey] || 'frame';
  const level = Math.max(1, Math.min(100, Number(character?.level) || 1));
  const out = { frame: ATTR_BASE, reflex: ATTR_BASE, signal: ATTR_BASE };
  out[primary] = ATTR_PRIMARY_BASE;
  out[primary] += level - 1;                      // one a level in your own line
  for (const key of Object.keys(out)) {
    if (key !== primary) out[key] += Math.floor((level - 1) / 3);
  }
  return out;
}

// Everything a requirement is checked against: the character, their gear, and
// their Lattice. One function, so the screen and the run agree.
export function characterAttributes(character) {
  const base = baseAttributes(character);
  const equipped = EQUIP_SLOTS.map((slot) => (character?.equipment || {})[slot]).filter(Boolean);
  const gear = itemMods(equipped);
  const tree = treeBonuses(character?.lattice, character?.classKey).mods;
  return {
    frame: base.frame + (gear.frame || 0) + (tree.frame || 0),
    reflex: base.reflex + (gear.reflex || 0) + (tree.reflex || 0),
    signal: base.signal + (gear.signal || 0) + (tree.signal || 0),
  };
}

export const APPEARANCES = {
  iron: { name: 'Iron', color: '#8493a6' },
  crimson: { name: 'Crimson', color: '#b94b51' },
  cobalt: { name: 'Cobalt', color: '#4679b8' },
  bone: { name: 'Bone', color: '#b7aa8c' },
  void: { name: 'Void', color: '#6d568f' },
  forest: { name: 'Forest', color: '#4f785d' },
};

// The five things a character can have on. A slot holding a key that no
// longer resolves is dropped rather than honoured, the same way normalizeMeta
// drops a node whose prerequisites went missing.
export function normalizeEquipment(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of EQUIP_SLOTS) {
    const key = raw[slot];
    if (typeof key !== 'string' || !key) continue;
    const item = itemInfo(key);
    if (!item) continue;
    if (item.slot && item.slot !== slotPool(slot)) continue;
    out[slot] = key;
  }
  return out;
}

// Equipment the character can actually wield right now. A rewire or a lost
// level can leave an item equipped that no longer meets its requirement; the
// screen shows it as illegal, and the run simply does not use it.
export function legalEquipment(character) {
  const equipment = normalizeEquipment(character?.equipment);
  const attrs = characterAttributes(character);
  const out = {};
  for (const [slot, key] of Object.entries(equipment)) {
    const item = itemInfo(key);
    if (item && meetsRequirement(item, attrs)) out[slot] = key;
  }
  return out;
}

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
    questPoints: 0,
    latticeV: LATTICE_VERSION,
    lattice: [],
    items: [],
    equipment: {},
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
    character.items = (Array.isArray(character.items) ? character.items : []).slice(0, STASH_SLOTS);
    character.equipment = normalizeEquipment(character.equipment);
    // The Lattice prunes on every load. A tree that changed shape between
    // releases must never brick a character — unknown and unreachable nodes are
    // dropped and their points come straight back.
    character.questPoints = Math.max(0, Math.min(30, Number(character.questPoints) || 0));
    character.latticeV = LATTICE_VERSION;
    character.lattice = pruneAlloc(
      character.lattice, character.classKey,
      latticePoints(character.level, character.questPoints),
    );
    character.talentPoints = Math.max(0, latticePoints(character.level, character.questPoints) - character.lattice.length);
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
    character.talentPoints = Math.max(0, latticePoints(character.level, character.questPoints)
      - (Array.isArray(character.lattice) ? character.lattice.length : 0));
    levels.push(character.level);
  }
  return levels;
}

// The camp is where the between-runs layer resolves into numbers. The Lattice
// is folded to a flat bag and a list of doctrine flags HERE, once, so the
// simulation never queries a tree node while it runs.
export function characterCamp(character, relics = []) {
  const tree = treeBonuses(character?.lattice, character?.classKey);
  return {
    level: character?.level || 1,
    xp: character?.xp || 0,
    items: [...(character?.items || [])],
    equipment: legalEquipment(character),
    upgrades: { ...(character?.upgrades || {}) },
    lattice: [...(character?.lattice || [])],
    treeMods: tree.mods,
    doctrines: tree.doctrines,
    relics: [...relics],
  };
}

// Spend and refund. Both go through the tree's own legality rules, so the
// screen, the profile and any future server all agree on what a build is.
export function allocateLatticeNode(character, nodeId) {
  if (!character) return false;
  const budget = latticePoints(character.level, character.questPoints);
  const owned = Array.isArray(character.lattice) ? character.lattice : [];
  if (owned.length >= budget) return false;
  if (!canAllocate(owned, nodeId, character.classKey)) return false;
  character.lattice = [...owned, nodeId].sort();
  character.talentPoints = Math.max(0, budget - character.lattice.length);
  return true;
}

export function deallocateLatticeNode(character, nodeId) {
  if (!character) return false;
  const owned = Array.isArray(character.lattice) ? character.lattice : [];
  if (!canDeallocate(owned, nodeId, character.classKey)) return false;
  character.lattice = owned.filter((id) => id !== nodeId).sort();
  character.talentPoints = Math.max(0, latticePoints(character.level, character.questPoints) - character.lattice.length);
  return true;
}

// Rewire: hand every point back at once.
export function rewireLattice(character) {
  if (!character) return 0;
  const spent = (character.lattice || []).length;
  character.lattice = [];
  character.talentPoints = latticePoints(character.level, character.questPoints);
  return spent;
}

export function recordMmoInstance(character, { won = false, kills = 0, xp = 0, world = null, items = [] } = {}) {
  if (!character) return { levels: [], items: [] };
  character.stats.instances++;
  if (won) character.stats.victories++;
  character.stats.kills += Math.max(0, kills | 0);
  if (world) character.lastWorld = world;
  // Rolled items are unique by construction, so the old identity dedupe stopped
  // meaning anything the moment gear started rolling. A stash cap replaces it:
  // authored items still land once, rolled ones stack up to the cap.
  const granted = [];
  for (const item of items) {
    if (!item) continue;
    if (!isRolledKey(item) && character.items.includes(item)) continue;
    if (character.items.length >= STASH_SLOTS) break;
    character.items.push(item);
    granted.push(item);
  }
  return { levels: grantMmoExperience(character, xp), items: granted };
}
