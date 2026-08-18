// Factions — who owns what, and what "owning" even means to them.
//
// The galaxy is not a map of planets with different owners. Three of the seven
// authored factions hold ground at all; the rest occupy space in ways a planet
// list cannot express. That distinction is the whole point of this module:
//
//   worlds  — holds ground. Has planets, loses planets, can be driven off one.
//   fleets  — has no ground anywhere. Lives at anchorages between the stars.
//             Taking its system takes nothing; it simply leaves.
//   drift   — floating organisms. No holdings, no intent, and it MOVES: a
//             bloom is weather with a direction, not a border.
//   ruins   — does not expand, does not fight for territory, and is already
//             everywhere it is ever going to be.
//
// Seven factions are authored the way five Earth levels are authored, and
// `factionById()` mints the rest from their number the way `galaxyLevel()`
// mints planet 400. The frontier is supposed to get stranger the further out
// you go, and "a faction nobody has a name for" is how that reads on a map.
//
// This module is a LEAF: it imports `utils.js` and nothing else. `config.js`
// may import it later — when a faction starts changing what the hives field on
// the ground — without any risk of an import cycle. Keep it that way.
import { makeRNG, clamp } from './utils.js';

// How a faction occupies space. `holdsWorlds` is the hard rule the check
// enforces: a fleet or a bloom must never end up owning a planet.
export const FACTION_PRESENCE = {
  worlds: {
    key: 'worlds', label: 'Holds worlds', icon: '\u{1F30D}',
    holdsWorlds: true, mobile: false,
    desc: 'Owns ground. Can be driven off it.',
  },
  fleets: {
    key: 'fleets', label: 'Fleet-borne', icon: '\u{1F6F8}',
    holdsWorlds: false, mobile: true,
    desc: 'No ground anywhere. Anchorages between the stars, and it moves.',
  },
  drift: {
    key: 'drift', label: 'Drifting', icon: '\u{1FAB8}',
    holdsWorlds: false, mobile: true,
    desc: 'Floating organisms. No holdings, no border, no intent.',
  },
  ruins: {
    key: 'ruins', label: 'Dormant', icon: '\u{1F5FF}',
    holdsWorlds: true, mobile: false,
    desc: 'Already everywhere it will ever be. Holds only its own tombs.',
  },
};

export const FACTION_ORIGINS = {
  human: { key: 'human', label: 'Human', icon: '\u{1F464}' },
  xeno: { key: 'xeno', label: 'Xeno', icon: '\u{1F9EC}' },
};

// The authored seven. Three human, four xeno, and every presence archetype
// covered at least once so the map has all four behaviours on it early.
//
// `war` is DATA the map and future ownership rules read — never behaviour.
// `hostile` is toward the Remnant, which is to say toward the player.
export const FACTIONS = [
  {
    id: 1, key: 'remnant', name: 'The Remnant', short: 'Remnant',
    designation: 'RMN', label: 'The Remnant',
    origin: 'human', presence: 'worlds', icon: '\u{1F6E1}️',
    color: 0xd9c48a, trim: 0x2f3440,
    war: { hostile: false, expands: true, aggression: 0.4 },
    blurb: 'What is left of Earth\'s people, and everything they have taken back.',
  },
  {
    id: 2, key: 'creed', name: 'The Ashen Creed', short: 'Creed',
    designation: 'CRD', label: 'The Ashen Creed',
    origin: 'human', presence: 'worlds', icon: '\u{1F56F}️',
    color: 0xb8683c, trim: 0x2a1c18,
    war: { hostile: true, expands: false, aggression: 0.6 },
    blurb: 'Humans who stayed through the fall and made a faith of surviving it. '
      + 'They hold their worlds and consider the fleet that left them heretics.',
  },
  {
    id: 3, key: 'courts', name: 'The Salvage Courts', short: 'Courts',
    designation: 'SVC', label: 'The Salvage Courts',
    origin: 'human', presence: 'fleets', icon: '⚖️',
    color: 0xc08a3e, trim: 0x1f2328,
    war: { hostile: false, expands: false, aggression: 0.2 },
    blurb: 'A polity of hulls and ledgers. It owns no ground anywhere and wants none — '
      + 'every anchorage is a market, and the war is its supplier.',
  },
  {
    id: 4, key: 'brood', name: 'The Brood', short: 'Brood',
    designation: 'BRD', label: 'The Brood',
    origin: 'xeno', presence: 'worlds', icon: '\u{1FAB2}',
    color: 0x6e8f3a, trim: 0x1c2414,
    war: { hostile: true, expands: true, aggression: 1 },
    blurb: 'The dead, and the hives that keep making more of them. '
      + 'It took Earth once and it is still taking everything else.',
  },
  {
    id: 5, key: 'gyre', name: 'The Gyre', short: 'Gyre',
    designation: 'GYR', label: 'The Gyre',
    origin: 'xeno', presence: 'fleets', icon: '\u{1F30A}',
    color: 0x4a7fa8, trim: 0x121c24,
    war: { hostile: true, expands: false, aggression: 0.8 },
    blurb: 'An armada that has never made planetfall. It circles the arms on a route '
      + 'nobody has mapped, and it is always somewhere it was not last year.',
  },
  {
    id: 6, key: 'bloom', name: 'The Bloom', short: 'Bloom',
    designation: 'BLM', label: 'The Bloom',
    origin: 'xeno', presence: 'drift', icon: '\u{1F338}',
    color: 0xa855b8, trim: 0x2a1633,
    war: { hostile: true, expands: false, aggression: 0.5 },
    blurb: 'Organisms the size of moons, drifting between stars on a current of their own. '
      + 'Not a border and not an enemy — weather, with a direction.',
  },
  {
    id: 7, key: 'cenotaph', name: 'The Cenotaph', short: 'Cenotaph',
    designation: 'CNT', label: 'The Cenotaph',
    origin: 'xeno', presence: 'ruins', icon: '\u{1F5FF}',
    color: 0x7fc4c8, trim: 0x102024,
    war: { hostile: true, expands: false, aggression: 0.3 },
    blurb: 'Machines still running the errands of builders who died before Earth had a name. '
      + 'They hold their own tombs and nothing else, and they do not negotiate about them.',
  },
];

export const FACTION_BASE = 1;                 // authored ids run 1..FACTIONS.length
export const FACTIONS_BY_KEY = new Map(FACTIONS.map((f) => [f.key, f]));

// ---------------------------------------------------------------------------
// Zillions of factions
// ---------------------------------------------------------------------------
// Past the authored seven, a faction is built from its number and nothing else
// — the same contract `galaxyLevel()` keeps for planets, for the same reason:
// every player's faction 4,120 is the same faction, and no peer has to ship it.
const FACTION_ADJECTIVES = [
  'Ninth', 'Pale', 'Riven', 'Quiet', 'Salt', 'Thousand', 'Blind', 'Low', 'Grey',
  'Far', 'Sunken', 'Hollow', 'Bitter', 'Long', 'Last', 'Cold', 'Wandering', 'Mute',
];
const FACTION_NOUNS = [
  'Choir', 'Concord', 'Assembly', 'Hunt', 'Compact', 'Shoal', 'Legion', 'Accord',
  'Swarm', 'Congregation', 'Lament', 'Tide', 'Quorum', 'Procession', 'Reach',
];
const PRESENCE_ORDER = ['worlds', 'fleets', 'drift', 'ruins'];

// 0..1 hue to 0xRRGGBB. Kept local so this module stays a leaf — `config.js`
// has its own copy for palettes and the two are deliberately independent.
function hueToHex(h, s = 0.45, l = 0.55) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v) => Math.round(clamp(v + m, 0, 1) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

export function proceduralFaction(id) {
  const n = id - FACTIONS.length;              // 1st, 2nd, ... unnamed faction
  const rng = makeRNG((0xfacade ^ Math.imul(id, 0x9e3779b1)) >>> 0);
  // Two words over a few hundred combinations cannot name zillions of things,
  // and pretending otherwise would put two identically-named factions on one
  // map. Names repeat the way real place names repeat; the CATALOGUE NUMBER is
  // what is unique, and it is part of how a procedural faction is displayed.
  const name = `The ${FACTION_ADJECTIVES[Math.floor(rng() * FACTION_ADJECTIVES.length)]} `
    + `${FACTION_NOUNS[Math.floor(rng() * FACTION_NOUNS.length)]}`;
  const designation = `${String.fromCharCode(65 + (id % 26))}${String.fromCharCode(65 + ((id * 7) % 26))}`
    + `-${(id % 10000).toString().padStart(4, '0')}`;
  const presence = PRESENCE_ORDER[(id * 3) % PRESENCE_ORDER.length];
  // The deep frontier is mostly not human. One in five is a lost colony that
  // stopped answering, which is its own kind of grim.
  const origin = (id * 11) % 5 === 0 ? 'human' : 'xeno';
  const info = FACTION_PRESENCE[presence];
  return {
    id, key: `f${id}`, name, short: name.replace(/^The /, ''),
    designation, label: `${name} (${designation})`,
    origin, presence,
    icon: info.icon,
    color: hueToHex(rng(), 0.38 + rng() * 0.24, 0.46 + rng() * 0.18),
    trim: 0x14181e,
    war: {
      hostile: origin !== 'human' || rng() > 0.5,
      expands: info.holdsWorlds && rng() > 0.6,
      aggression: Math.round(rng() * 100) / 100,
    },
    blurb: `Charted, numbered, and never spoken to. Frontier power ${n}.`,
    procedural: true,
  };
}

// The one lookup. Ids 1..7 are the authored factions; everything past them is
// minted on demand and cached, exactly like the procedural galaxy.
const _factionCache = new Map();
export function factionById(id) {
  const n = Math.max(FACTION_BASE, id | 0);
  if (n <= FACTIONS.length) return FACTIONS[n - FACTION_BASE];
  if (!_factionCache.has(n)) _factionCache.set(n, proceduralFaction(n));
  return _factionCache.get(n);
}

export function factionByKey(key) {
  return FACTIONS_BY_KEY.get(key) || null;
}

export function holdsWorlds(faction) {
  return !!(faction && FACTION_PRESENCE[faction.presence]?.holdsWorlds);
}

export function isMobile(faction) {
  return !!(faction && FACTION_PRESENCE[faction.presence]?.mobile);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------
// Who holds a given world. Pure in its arguments so it can move into
// `config.js` unchanged on the day a faction starts changing the ground fight
// — which is why it takes the world kind rather than importing it.
//
// The kind and the holder explain each other. A derelict is a Cenotaph tomb.
// A holdout is a holdout BECAUSE humans are still standing on it. Everything
// else is Brood, because the Brood is what took the galaxy.
const DEEP_FRONTIER = 24;   // worlds past this may answer to nobody you know
const UNKNOWN_EVERY = 11;   // ...and one in this many of them does

export function factionForWorld(levelIndex, worldKind = 'standard') {
  const n = Math.max(1, levelIndex | 0);
  if (worldKind === 'derelict') return factionByKey('cenotaph');
  // The deep frontier is where the authored seven stop being the whole story.
  // Only half the procedural presences hold ground, so walk forward to the
  // next one that does rather than quietly handing the world back to the Brood.
  if (n > DEEP_FRONTIER && n % UNKNOWN_EVERY === 0) {
    // A distinct starting point per world, so two deep worlds do not both
    // walk forward onto the same unknown faction.
    const first = FACTIONS.length + 1 + n * 3;
    for (let step = 0; step < 8; step++) {
      const unknown = factionById(first + step);
      if (holdsWorlds(unknown)) return unknown;
    }
  }
  if (worldKind === 'holdout') {
    // Someone human is still down there. Which someone depends on the world.
    return n % 3 === 0 ? factionByKey('creed') : factionByKey('remnant');
  }
  return factionByKey('brood');
}

// Who is present at a star without owning any of it. Only fleet and drift
// factions can be picked here, which is what makes "ship-only" a real category
// rather than a label on a planet holder.
const ROAMERS = FACTIONS.filter((f) => !FACTION_PRESENCE[f.presence].holdsWorlds);

export function roamingFactions() {
  return [...ROAMERS];
}

export function factionForPresence(systemSeed, slot = 0) {
  const rng = makeRNG(((systemSeed >>> 0) ^ Math.imul(slot + 1, 0x85ebca6b)) >>> 0);
  const roll = rng();
  // Past the authored roamers there is room for unnamed ones, so a deep-space
  // anchorage is not always a Court and not always a Gyre.
  if (roll > 0.86) {
    const unknown = factionById(FACTIONS.length + 1 + Math.floor(rng() * 64));
    if (!holdsWorlds(unknown)) return unknown;
  }
  return ROAMERS[Math.floor(rng() * ROAMERS.length) % ROAMERS.length];
}

// The site a roaming faction leaves at a star. A fleet drops an anchorage; a
// bloom is just the organism, in transit. Neither is a landing and neither
// consumes a level id — that is reserved for ground you can stand on.
export function presenceSiteKind(faction) {
  if (!faction) return null;
  return faction.presence === 'drift' ? 'bloom' : 'anchorage';
}

// A system's owner is a PROJECTION, never a stored field: the faction holding
// the most worlds there, or — at a star with no ground worth holding — whoever
// is parked in it. Ownership that changes with progress must be computed at
// read time, or the galaxy's structure hash stops being stable.
export function systemOwner(system) {
  const tally = new Map();
  for (const world of system.worlds || []) {
    if (!world.factionId) continue;
    tally.set(world.factionId, (tally.get(world.factionId) || 0) + 1);
  }
  if (tally.size) {
    let bestId = null, best = -1;
    // Ties break toward the lower faction id so the answer is stable.
    for (const [id, count] of [...tally].sort((a, b) => a[0] - b[0])) {
      if (count > best) { best = count; bestId = id; }
    }
    return factionById(bestId);
  }
  const parked = (system.presence || [])[0];
  return parked ? factionById(parked.factionId) : null;
}
