// First-run presentation rules. This module never touches the simulation,
// the lockstep hash, or the seeded sim random source.
import { CULTURE_ARMIES, cultureKey, HEROES } from './config.js';
import { CHAPTER_COLORS, CHAPTER_EMBLEMS, CHAPTER_LEADERS } from './chapter.js';

export const QUICK_DEFAULTS = Object.freeze({
  chapterName: 'First Landing',
  founderName: 'Vanguard',
  army: 'european',
  color: 'cobalt',
  emblem: 'star',
  difficulty: 'casual',
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
  };
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

// Vanguard plus the eleven chapter leaders. Only Vanguard can deploy today.
export function leaderRoster() {
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
      playable: false,
      soon: true,
    })),
  ];
}

export function abilityBar(hero) {
  const special = hero?.ability;
  return [
    { key: 'Q', name: special?.name || 'Special', icon: special?.icon || '✦', detail: special?.desc || 'Fight-mode special.', state: 'ready' },
    { key: 'W', name: 'Weapon', icon: hero?.shotgun ? '💥' : '🎯', detail: hero?.tagline || 'The hero fires while you move.', state: 'ready' },
    { key: 'E', name: 'Reserved', icon: '·', detail: 'The second ability slot stays visible so the bar does not move.', state: 'reserved' },
    { key: 'R', name: 'Reserved', icon: '·', detail: 'The third ability slot stays visible so the bar does not move.', state: 'reserved' },
  ];
}

export const COACH_STEPS = Object.freeze([
  { id: 'move', title: 'Move', body: 'WASD moves your hero. The camera stays fixed, so W is always north on the minimap.' },
  { id: 'found', title: 'Found the city', body: 'Ride onto a gold flag and press your Build key. The city rises on that ground.' },
  { id: 'build', title: 'Build', body: 'Hold the Build key on a glowing foundation. Gold streams in until the plot is paid.' },
  { id: 'mode', title: 'Build mode', body: 'Alt toggles Build and Fight. Build mode spends gold. Fight mode dodges and casts.' },
  { id: 'attack', title: 'Attack', body: 'In Fight mode, walk toward the dead. Your hero fires alone. Q is the special.' },
  { id: 'stances', title: 'Command the army', body: 'F1 defends the city. F2 follows you. F3 pushes the lanes. Press each one.' },
]);

export function freshCoach() {
  return {
    index: 0,
    moved: false,
    founded: false,
    built: false,
    mode: false,
    attacked: false,
    stances: { defend: false, guard: false, attack: false },
  };
}

function stepSatisfied(coach) {
  const id = COACH_STEPS[coach.index]?.id;
  if (id === 'move') return coach.moved;
  if (id === 'found') return coach.founded;
  if (id === 'build') return coach.built;
  if (id === 'mode') return coach.mode;
  if (id === 'attack') return coach.attacked;
  if (id === 'stances') return coach.stances.defend && coach.stances.guard && coach.stances.attack;
  return false;
}

export function coachAdvance(coach, event) {
  if (!coach || coach.index >= COACH_STEPS.length) return coach;
  const current = COACH_STEPS[coach.index].id;
  const next = {
    ...coach,
    stances: { ...coach.stances },
    moved: coach.moved || event.type === 'move',
    founded: coach.founded || event.type === 'founded',
    built: coach.built || event.type === 'built',
    mode: coach.mode || (event.type === 'mode' && current === 'mode'),
    attacked: coach.attacked || (event.type === 'attack' && current === 'attack'),
  };
  if (event.type === 'stance' && current === 'stances' && next.stances[event.stance] !== undefined) {
    next.stances[event.stance] = true;
  }
  let guard = 0;
  while (guard++ < COACH_STEPS.length && next.index < COACH_STEPS.length && stepSatisfied(next)) next.index += 1;
  return next;
}

export function coachApply(coach, events) {
  return events.reduce((state, event) => coachAdvance(state, event), coach);
}

export function coachComplete(coach) {
  return !coach || coach.index >= COACH_STEPS.length;
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
