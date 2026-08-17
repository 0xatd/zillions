// Characters — the roster you march onto the overworld.
//
// This module is pure data, like overworld.js: no three.js, no DOM. A
// character is the WoW/Diablo door into the persistent war — a name, a hero
// class and a banner colour, plus per-character career stats. The records
// live inside the local profile (the same `zillions_profile` localStorage
// blob main.js owns), so they ride the existing save/sync path and never
// invent a parallel persistence system.
//
// IMPORTANT: campaign progress stays ACCOUNT-level. Every character on a
// profile shares the fronts the player has taken — the character is which
// hero walks the planet, not a second campaign. Only plays/wins/kills are
// per-character career numbers.

export const MAX_CHARACTERS = 6;

// Banner swatches for the create screen — warm heraldry, not neon.
export const BANNER_COLORS = [
  { id: 'gold',    hex: '#c9a44a', name: 'Gold' },
  { id: 'crimson', hex: '#b23a48', name: 'Crimson' },
  { id: 'forest',  hex: '#4a7c59', name: 'Forest' },
  { id: 'azure',   hex: '#4a6fa5', name: 'Azure' },
  { id: 'violet',  hex: '#6d5a9e', name: 'Violet' },
  { id: 'iron',    hex: '#6e6a66', name: 'Iron' },
];

let idCounter = 0;
const newId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function makeCharacter(name, heroKey, banner = 'gold') {
  const clean = String(name || '').trim().slice(0, 18);
  return {
    id: newId(),
    name: clean || 'Commander',
    heroKey,
    banner: BANNER_COLORS.some((b) => b.id === banner) ? banner : 'gold',
    createdAt: Date.now(),
    // Career stats: incremented at run end, never reset by the UI.
    stats: { plays: 0, wins: 0, kills: 0 },
  };
}

// Ensure the profile carries a playable roster. On the first boot after this
// feature lands, existing players are grandfathered one character built from
// their current identity (profile name + last hero) so nobody is locked out
// of the overworld they were walking yesterday.
export function ensureCharacters(profile) {
  profile.characters = Array.isArray(profile.characters) ? profile.characters.filter((c) => c && c.id && c.heroKey) : [];
  if (!profile.characters.length) {
    profile.characters = [makeCharacter(
      profile.username || profile.name || 'Commander',
      profile.lastHero || 'alexander',
      'gold',
    )];
    profile.characterId = profile.characters[0].id;
  }
  if (!profile.characters.some((c) => c.id === profile.characterId)) {
    profile.characterId = profile.characters[0].id;
  }
  return profile.characters;
}

export function selectedCharacter(profile) {
  return (profile.characters || []).find((c) => c.id === profile.characterId) || null;
}

export function addCharacter(profile, character) {
  if (profile.characters.length >= MAX_CHARACTERS) return null;
  profile.characters.push(character);
  profile.characterId = character.id;
  return character;
}

export function deleteCharacter(profile, id) {
  const before = profile.characters.length;
  profile.characters = profile.characters.filter((c) => c.id !== id);
  if (profile.characterId === id) {
    profile.characterId = (profile.characters[0] || {}).id || null;
  }
  return profile.characters.length < before;
}

// Run-end hook: one line of bookkeeping, called from _recordGameEnd exactly
// where the profile's own wins/kills are tallied. Spectators never reach it.
export function recordCharacterResult(character, won, kills) {
  if (!character) return;
  character.stats = character.stats || { plays: 0, wins: 0, kills: 0 };
  character.stats.plays++;
  if (won) character.stats.wins++;
  character.stats.kills += Math.max(0, kills | 0);
}
