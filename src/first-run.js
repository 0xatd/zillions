// First-run presentation rules. This module never touches the simulation,
// the lockstep hash, or the seeded sim random source.
import { CULTURE_ARMIES, cultureKey, HEROES } from './config.js';
import { heroAbilities } from './hero-abilities.js';
import { CHAPTER_COLORS, CHAPTER_EMBLEMS, CHAPTER_LEADERS, leaderRecord, recruitmentAllowed } from './chapter.js';

export const PLAYABLE_LEADER_KEYS = Object.freeze(['vanguard', 'alexander', 'aaron', 'tiger']);

export const QUICK_DEFAULTS = Object.freeze({
  chapterName: 'First Landing',
  founderName: 'Vanguard',
  army: 'european',
  color: 'cobalt',
  emblem: 'star',
  difficulty: 'casual',
  leader: 'vanguard',
});

const CHAPTER_NAMES = ['First Landing', 'Greenfall Host', 'Ash Gate', 'North Watch', 'Low Keep'];
const FOUNDER_NAMES = ['Vanguard', 'Marshal', 'Warden', 'Captain', 'Herald'];
const DIFFICULTIES = ['casual', 'normal', 'brutal'];

export function randomizeQuickSetup(rng = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  return {
    chapterName: pick(CHAPTER_NAMES),
    founderName: pick(FOUNDER_NAMES),
    army: pick(Object.keys(CULTURE_ARMIES)),
    color: pick(Object.keys(CHAPTER_COLORS)),
    emblem: pick(Object.keys(CHAPTER_EMBLEMS)),
    difficulty: pick(DIFFICULTIES),
    leader: 'vanguard',
  };
}

export function normalizeQuickSetup(raw = {}) {
  const chapterName = String(raw.chapterName || QUICK_DEFAULTS.chapterName).trim().slice(0, 32) || QUICK_DEFAULTS.chapterName;
  const founderName = String(raw.founderName || QUICK_DEFAULTS.founderName).trim().slice(0, 18) || QUICK_DEFAULTS.founderName;
  return {
    chapterName,
    founderName,
    army: cultureKey(raw.army),
    color: Object.hasOwn(CHAPTER_COLORS, raw.color) ? raw.color : QUICK_DEFAULTS.color,
    emblem: Object.hasOwn(CHAPTER_EMBLEMS, raw.emblem) ? raw.emblem : QUICK_DEFAULTS.emblem,
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : QUICK_DEFAULTS.difficulty,
    leader: PLAYABLE_LEADER_KEYS.includes(raw.leader) ? raw.leader : QUICK_DEFAULTS.leader,
  };
}

// Heroes a guest retry may start. Signed-in retry stays on the selected character.
export function localRetryHeroes(profile = {}, selected = '') {
  const keys = new Set();
  if (selected) keys.add(selected);
  if (profile?.lastHero) keys.add(profile.lastHero);
  for (const key of PLAYABLE_LEADER_KEYS) keys.add(leaderHeroKey(key));
  return [...keys];
}

export function leaderHeroKey(key) {
  if (key === 'vanguard') return 'scott';
  return HEROES[key] ? key : 'scott';
}

// What a culture changes on the battlefield. European is the reference line.
export function cultureExplain(key) {
  const army = CULTURE_ARMIES[cultureKey(key)];
  const changes = ['soldier', 'ranger', 'sniper'].map((trade) => {
    const unit = army.units[trade];
    return unit ? `${unit.name}: ${unit.trait}` : null;
  }).filter(Boolean);
  return {
    name: army.name,
    banner: army.banner,
    summary: army.blurb,
    changes: changes.length
      ? `${changes.join(' · ')} Camps still train militia, rangers and snipers, and every culture's trooper drops a walker in the same number of shots.`
      : 'Reference line. Militia, rangers and snipers use the baseline health, damage, range and speed. No evade, armor or splash. The other cultures trade those numbers inside a narrow band.',
  };
}

// A new chapter starts with its founder; companions are recruited, not unfinished kits.
export function leaderRoster(profile = {}) {
  return [
    {
      key: 'vanguard',
      name: 'Vanguard',
      role: 'Your founder. Frontline command.',
      playable: true,
      soon: false,
    },
    ...CHAPTER_LEADERS.map((leader) => ({
      key: leader.key,
      name: HEROES[leader.key]?.name || leader.key,
      role: leader.role,
      playable: !!leaderRecord(profile, leader.key),
      soon: false,
      status: leaderRecord(profile, leader.key) ? 'Ready in chapter' : recruitmentAllowed(profile, leader.key) ? 'Recruit in chapter' : 'Unlock through exploration or conquest',
    })),
  ];
}

export function abilityBar(hero, labels = ['Q', 'W', 'E', 'R']) {
  return [
    { key: 'Auto', name: 'Weapon', icon: '🎯', detail: 'Attacks automatically in range. Right-click to move or attack-move.', state: 'ready' },
    ...heroAbilities(hero).map((ability, slot) => ability && ({
      key: ability.passive ? 'Passive' : labels[slot] || `Slot ${slot + 1}`, name: ability.name,
      icon: ability.icon || '✦', detail: ability.desc || '', state: ability.passive ? 'passive' : 'ready',
    })).filter(Boolean),
  ];
}

export const COACH_STEPS = Object.freeze([
  { id: 'move', title: 'Lead the landing', body: 'Right-click the ground to move. Right-click an enemy to attack-move. A marker shows the order. Ride toward a gold flag.' },
  { id: 'found', title: 'Establish your outpost', body: 'Stand by a gold flag and press {build}. The Keep rises here.' },
  { id: 'build', title: 'Prepare your first defense', body: 'Hold {build} at a Tower or Militia Camp foundation. Economy is another opening choice, but you will need to fight beside it.' },
  { id: 'stances', title: 'Hold the Keep', body: 'Choose Defend Keep below or press {defend}. Your squads stay home while you intercept the attackers.' },
  { id: 'attack', title: 'Meet the incoming wave', body: 'Right-click an enemy to enter Fight mode and attack. Pick off the acid spitters; step out of the brute’s orange ring. {ability}, {ability2}, {ability3} and {ability4} are your four abilities. {center} recenters the camera. {mode} switches Build and Fight.' },
  { id: 'victory', title: 'Break the first siege', body: 'Protect the Keep and defeat the marked wave. Hold {build} beside damaged defenses to repair them.' },
  { id: 'push', title: 'Take the initiative', body: 'First siege broken. Choose Push lanes below or press {push}. Escort your squads to a node to claim income and new defenses.' },
]);

export function freshCoach() {
  return { index: 0, moved: false, founded: false, built: false, attacked: false,
    defended: false, won: false, pushed: false };
}

export function coachAdvance(coach, event) {
  if (!coach || coachComplete(coach)) return coach;
  const next = { ...coach,
    moved: coach.moved || event.type === 'move',
    founded: coach.founded || event.type === 'founded',
    built: coach.built || event.type === 'built',
    attacked: coach.attacked || event.type === 'attack',
    defended: coach.defended || (event.type === 'stance' && event.stance === 'defend'),
    won: coach.won || event.type === 'firstsiege',
    pushed: coach.pushed || (coach.won && event.type === 'stance' && event.stance === 'attack'),
  };
  const satisfied = { move: next.moved, found: next.founded, build: next.built,
    stances: next.defended, attack: next.attacked, victory: next.won, push: next.pushed };
  while (next.index < COACH_STEPS.length && satisfied[COACH_STEPS[next.index].id]) next.index++;
  return next;
}

export function coachApply(coach, events) {
  return events.reduce((state, event) => coachAdvance(state, event), coach);
}

export function coachComplete(coach) {
  return !coach || coach.index >= COACH_STEPS.length;
}

export function coachStep(coach, labels = {}) {
  const step = COACH_STEPS[coach?.index];
  if (!step) return null;
  return { ...step, body: step.body.replace(/\{(\w+)\}/g, (_, key) => labels[key] || key) };
}

// Pause follows the bound action. The mode action (build / dodge) can resume
// a pause, and only after the declared action has been resolved. A live match
// leaves that action to the battle switch, so rebinding Pause onto its key
// still pauses.
export function pauseIntent({ paused = false, menuOpen = false, action = null } = {}) {
  if (action === 'pause') {
    if (menuOpen) return 'resume-menu';
    if (paused) return 'resume';
    return 'ignore';
  }
  if (action === 'dodge' && (menuOpen || paused)) return menuOpen ? 'resume-menu' : 'resume';
  if (action === 'menu' && menuOpen) return 'resume-menu';
  if (action === 'menu' && paused) return 'open-menu';
  return 'ignore';
}

// Canvas labels are center-drawn. A fixed 34px face clips "OLD CROSSROADS"
// down to something like "LD CROSSROAD". Shrink until the whole string fits.
export function fittedLabel(text, maxWidth = 496, start = 34, min = 13) {
  const label = String(text || '');
  let size = start;
  while (size > min && label.length * size * 0.62 > maxWidth - 24) size -= 1;
  return { text: label, size, width: maxWidth };
}

// Clicks from the title to a controllable hero.
export const TITLE_CLICKS = Object.freeze({
  before: [
    'Continue with Google',
    'Claim username',
    'Save chapter',
    'Found the chapter',
    'Assault the first city',
    'Start the battle',
    'Enter battlefield',
  ],
  afterNew: ['Play', 'Start'],
  afterReturning: ['Play'],
});
