// Keybindings — one source of truth for every action the player can take.
//
// Before this, keys were literals scattered through the keydown handler, so
// the README, the help screen and the code could disagree and nothing caught
// it. An action is now declared once, with its default key, its label and the
// context it belongs to; the handler dispatches through this table and the
// Settings screen reads the same table to draw and rebind.
//
// The layout follows Path of Exile 2's WASD mode, adapted where Zillions has a
// system PoE2 does not (army stances) or lacks one PoE2 has (there is one hero
// ability, not nine skill gems). Deviations are noted on the actions.
//
// Headless and three-free — `scripts/keybind-check.mjs` drives it in Node.

export const KEYBIND_KEY = 'zillions_keybinds';
export const KEYBIND_VERSION = 1;

// WHERE an action is actually listening. This is not the same thing as the
// group it is displayed under, and conflating the two was a real bug: the
// Settings screen grouped by context and checked conflicts per context, but a
// battle has movement, combat, army and interface actions all live at once, so
// binding the character sheet to Q reported no conflict and then never fired —
// the dispatcher found `ability1` first and stopped.
//
// Conflicts are judged by scope overlap. Grouping is presentation only.
export const SCOPES = {
  battle: 'During a match',
  hub: 'In the persistent world',
};

// Display groups for the Settings screen. These carry no meaning at dispatch.
export const BIND_CONTEXTS = {
  movement: { key: 'movement', name: 'Movement', desc: 'Getting around the battlefield.' },
  combat: { key: 'combat', name: 'Combat', desc: 'Abilities, dodging, and your weapon sets.' },
  army: { key: 'army', name: 'Army & Colony', desc: 'Orders to your squads and your city.' },
  interface: { key: 'interface', name: 'Interface', desc: 'Screens, panels and the game menu.' },
};

// `fixed: true` marks an action whose key cannot be rebound, because the
// browser or the game grammar owns it. It is still listed, so the Settings
// screen shows the complete scheme rather than a filtered one.
export const ACTIONS = [
  // ---- movement ----
  { id: 'move_up', name: 'Move north', scopes: ['battle', 'hub'], context: 'movement', default: 'w', alt: 'arrowup', held: true },
  { id: 'move_left', name: 'Move west', scopes: ['battle', 'hub'], context: 'movement', default: 'a', alt: 'arrowleft', held: true },
  { id: 'move_down', name: 'Move south', scopes: ['battle', 'hub'], context: 'movement', default: 's', alt: 'arrowdown', held: true },
  { id: 'move_right', name: 'Move east', scopes: ['battle', 'hub'], context: 'movement', default: 'd', alt: 'arrowright', held: true },
  {
    id: 'sprint', name: 'Gallop', scopes: ['battle', 'hub'], context: 'movement', default: 'shift', held: true,
    desc: 'Full speed, and only at full health.',
  },

  // ---- combat ----
  {
    id: 'dodge', name: 'Dodge roll', scopes: ['battle'], context: 'combat', default: ' ',
    desc: 'A short burst out of danger. Briefly untouchable, then a cooldown.',
  },
  {
    id: 'ability1', name: 'Primary ability', scopes: ['battle'], context: 'combat', default: 'q',
    desc: 'Your hero special.',
  },
  {
    id: 'ability2', name: 'Ability II', scopes: ['battle'], context: 'combat', default: 'e', reserved: true,
    desc: 'Reserved. Heroes carry one ability today; this slot is where a second lands.',
  },
  {
    id: 'ability3', name: 'Ability III', scopes: ['battle'], context: 'combat', default: 'r', reserved: true,
    desc: 'Reserved, as above.',
  },
  {
    id: 'swap_set', name: 'Swap weapon set', scopes: ['battle'], context: 'combat', default: 'x',
    desc: 'Draw the other weapon set. Four second cooldown.',
  },
  {
    id: 'second_bar', name: 'Secondary bar (hold)', scopes: ['battle'], context: 'combat', default: 'control', held: true,
    reserved: true,
    desc: 'Reserved. Holds a second layer of ability slots once heroes carry more than one.',
  },
  {
    id: 'consumable1', name: 'Consumable I', scopes: ['battle'], context: 'combat', default: '1', reserved: true,
    desc: 'Reserved. Zillions has no flask system; these slots are where one would go.',
  },
  {
    id: 'consumable2', name: 'Consumable II', scopes: ['battle'], context: 'combat', default: '2', reserved: true,
    desc: 'Reserved, as above.',
  },

  // ---- army and colony ----
  {
    id: 'build', name: 'Build, upgrade, repair', scopes: ['battle'], context: 'army', default: 'b', held: true,
    desc: 'Hold at a foundation. Gold streams out until it rises.',
  },
  {
    id: 'build_mode', name: 'Toggle build mode', scopes: ['battle'], context: 'army', default: 'alt',
    desc: 'Switches what the primary input does between building and fighting.',
  },
  {
    id: 'stance_defend', name: 'Stance: defend city', scopes: ['battle'], context: 'army', default: 'f1',
    desc: 'Zillions has no PoE equivalent — squads are ours.',
  },
  { id: 'stance_follow', name: 'Stance: follow hero', scopes: ['battle'], context: 'army', default: 'f2' },
  { id: 'stance_push', name: 'Stance: push lanes', scopes: ['battle'], context: 'army', default: 'f3' },
  { id: 'tower_priority', name: 'Cycle tower targeting', scopes: ['battle'], context: 'army', default: 't' },
  { id: 'drop_item', name: 'Drop newest field item', scopes: ['battle'], context: 'army', default: 'z' },

  // ---- interface ----
  {
    id: 'character_sheet', name: 'Character & equipment', scopes: ['battle', 'hub'], context: 'interface', default: 'c',
    desc: 'Your gear, your stash, and what it all adds up to.',
  },
  {
    id: 'lattice_panel', name: 'The Lattice', scopes: ['battle', 'hub'], context: 'interface', default: 'g',
    desc: 'The passive tree. Opens the same sheet on its Lattice tab.',
  },
  { id: 'pause', name: 'Pause', scopes: ['battle'], context: 'interface', default: 'p' },
  { id: 'mute', name: 'Mute audio', scopes: ['battle', 'hub'], context: 'interface', default: 'm' },
  { id: 'chat', name: 'Team chat', scopes: ['battle'], context: 'interface', default: 'enter' },
  { id: 'menu', name: 'Game menu', scopes: ['battle', 'hub'], context: 'interface', default: 'escape', fixed: true },
];

export const ACTIONS_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

// How a key reads to a human. Browsers give us ' ' and 'arrowup'; players read
// Space and ↑.
const KEY_LABELS = {
  ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  escape: 'Esc', enter: 'Enter', control: 'Ctrl', shift: 'Shift', alt: 'Alt',
  tab: 'Tab', backspace: 'Backspace', delete: 'Del', capslock: 'Caps',
};

export function keyLabel(key) {
  if (!key) return '—';
  const k = String(key).toLowerCase();
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  if (/^f\d{1,2}$/.test(k)) return k.toUpperCase();
  return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
}

export function defaultBinds() {
  const out = {};
  for (const action of ACTIONS) out[action.id] = action.default;
  return out;
}

// Every key an action answers to: what it is bound to, plus its fixed
// alternate. A conflict on EITHER is a conflict — the arrow keys are not
// rebindable, so an action bound to ArrowUp is shadowed by movement forever.
export function keysForAction(binds, action, override = undefined) {
  const bound = override === undefined ? (binds || {})[action.id] : override;
  const out = [];
  if (bound) out.push(String(bound).toLowerCase());
  if (action.alt) out.push(String(action.alt).toLowerCase());
  return out;
}

const scopesOverlap = (a, b) => (a.scopes || []).some((scope) => (b.scopes || []).includes(scope));

// Two actions that can be listening at the same moment may not share a key.
// Scope decides that, not the display group: during a battle, movement, combat,
// army and interface actions are all live, so a key shared across those groups
// leaves one of them permanently dead.
export function conflictsFor(binds, id, key) {
  const action = ACTIONS_BY_ID.get(id);
  if (!action) return [];
  const wanted = new Set(keysForAction(binds, action, key));
  if (!wanted.size) return [];
  return ACTIONS.filter((other) => other.id !== id
    && scopesOverlap(action, other)
    && keysForAction(binds, other).some((k) => wanted.has(k)));
}

// Every duplicate in a scheme, for the screen to flag and the check to refuse.
// A scheme with a clash in it is a scheme with a dead action.
export function allConflicts(binds) {
  const out = [];
  for (const action of ACTIONS) {
    const clash = conflictsFor(binds, action.id, binds[action.id]);
    if (clash.length) out.push({ id: action.id, key: binds[action.id], with: clash.map((c) => c.id) });
  }
  return out;
}

// Anything off disk goes through here, and what comes out is always playable:
// unknown actions and fixed rebinds are dropped, and a scheme that would leave
// two actions fighting over one key is resolved rather than stored. An action
// that cannot be given a free key comes back UNBOUND, which the screen shows
// plainly — an unbound action is honest, a shadowed one is a silent bug.
export function normalizeBinds(raw) {
  const requested = {};
  if (raw && typeof raw === 'object') {
    for (const id of Object.keys(raw)) {
      const action = ACTIONS_BY_ID.get(id);
      if (!action || action.fixed) continue;
      const key = raw[id];
      if (typeof key !== 'string' || !key) continue;
      requested[id] = key.toLowerCase();
    }
  }
  const out = {};
  // Declaration order decides who keeps a contested key, so the same stored
  // scheme always normalises to the same result on every machine.
  for (const action of ACTIONS) {
    const wanted = action.fixed ? action.default : (requested[action.id] || action.default);
    for (const candidate of [wanted, action.default, '']) {
      if (candidate && conflictsFor(out, action.id, candidate).length) continue;
      out[action.id] = candidate;
      break;
    }
  }
  return out;
}

// The action a key press means, or null. Pass the scope the press happened in
// — the battle loop and the hub listen to different sets, and a scoped lookup
// cannot pick an action that is not listening.
export function actionFor(binds, key, scope = null) {
  const k = String(key || '').toLowerCase();
  if (!k) return null;
  for (const action of ACTIONS) {
    if (scope && !(action.scopes || []).includes(scope)) continue;
    if (keysForAction(binds, action).includes(k)) return action.id;
  }
  return null;
}

// Is this key currently held, counting the action's alternate?
export function isHeld(binds, keys, id) {
  const action = ACTIONS_BY_ID.get(id);
  if (!action) return false;
  return keysForAction(binds, action).some((k) => keys.has(k));
}

// ---------- storage ----------
// A seam, the same way meta.js treats its own: localStorage today, a server
// later, with nothing else changing.

let _backend = null;
let _cache = null;

export function setKeybindBackend(backend) {
  _backend = backend;
  _cache = null;
}

export function loadBinds({ force = false } = {}) {
  if (_cache && !force) return _cache;
  let raw = null;
  try {
    if (_backend) raw = _backend.load();
    else if (typeof localStorage !== 'undefined') raw = JSON.parse(localStorage.getItem(KEYBIND_KEY) || 'null');
  } catch { raw = null; }
  _cache = normalizeBinds(raw && raw.binds ? raw.binds : raw);
  return _cache;
}

export function saveBinds(binds) {
  _cache = normalizeBinds(binds);
  const payload = { v: KEYBIND_VERSION, binds: _cache };
  try {
    if (_backend) _backend.save(payload);
    else if (typeof localStorage !== 'undefined') localStorage.setItem(KEYBIND_KEY, JSON.stringify(payload));
  } catch { /* a full or blocked store must never cost the player their game */ }
  return _cache;
}

export function resetBinds() {
  return saveBinds(defaultBinds());
}
