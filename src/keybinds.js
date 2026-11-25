// Keybindings — one source of truth for every action the player can take.
//
// Before this, keys were literals scattered through the keydown handler, so
// the README, the help screen and the code could disagree and nothing caught
// it. An action is now declared once, with its default key, its label and the
// context it belongs to; the handler dispatches through this table and the
// Settings screen reads the same table to draw and rebind.
//
// The battle scheme is right-click orders plus four ability keys. Camera pan,
// edge pan, and the optional WASD camera live beside that scheme. Direct hero
// movement stays bindable for players who want it, on the numpad by default
// so it does not take Q, W, E, or R.
//
// Headless and three-free — `scripts/keybind-check.mjs` drives it in Node.

export const KEYBIND_KEY = 'zillions_keybinds';
export const KEYBIND_VERSION = 2;

export const DEFAULT_FEEL = Object.freeze({
  wasdCamera: false,
  edgePan: true,
  reduceShake: false,
  parked: null,
});

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
  movement: { key: 'movement', name: 'Movement', desc: 'Orders, camera pan, and optional direct movement.' },
  combat: { key: 'combat', name: 'Combat', desc: 'Four abilities, attack-move, dodging, and weapon sets.' },
  army: { key: 'army', name: 'Army & Colony', desc: 'Orders to your squads and your city.' },
  interface: { key: 'interface', name: 'Interface', desc: 'Screens, panels and the game menu.' },
};

// `fixed: true` marks an action whose key cannot be rebound, because the
// browser or the game grammar owns it. It is still listed, so the Settings
// screen shows the complete scheme rather than a filtered one.
export const ACTIONS = [
  // ---- movement and camera ----
  { id: 'camera_up', name: 'Pan camera north', scopes: ['battle'], context: 'movement', default: 'arrowup', held: true },
  { id: 'camera_left', name: 'Pan camera west', scopes: ['battle'], context: 'movement', default: 'arrowleft', held: true },
  { id: 'camera_down', name: 'Pan camera south', scopes: ['battle'], context: 'movement', default: 'arrowdown', held: true },
  { id: 'camera_right', name: 'Pan camera east', scopes: ['battle'], context: 'movement', default: 'arrowright', held: true },
  {
    id: 'camera_center', name: 'Center camera on hero', scopes: ['battle'], context: 'movement', default: ' ',
    desc: 'Pulls the view back onto your hero.',
  },
  {
    id: 'move_up', name: 'Move hero north', scopes: ['battle'], context: 'movement', default: 'numpad8', held: true,
    desc: 'Optional direct move. Right-click is the main order.',
  },
  { id: 'move_left', name: 'Move hero west', scopes: ['battle'], context: 'movement', default: 'numpad4', held: true },
  { id: 'move_down', name: 'Move hero south', scopes: ['battle'], context: 'movement', default: 'numpad2', held: true },
  { id: 'move_right', name: 'Move hero east', scopes: ['battle'], context: 'movement', default: 'numpad6', held: true },
  {
    id: 'sprint', name: 'Gallop', scopes: ['battle', 'hub'], context: 'movement', default: 'shift', held: true,
    desc: 'Full speed, and only at full health.',
  },

  // ---- combat ----
  {
    id: 'dodge', name: 'Mode action: build / dodge', scopes: ['battle'], context: 'combat', default: 'v',
    desc: 'Build mode: hold to build. Fight mode: dodge with brief invulnerability.',
  },
  {
    id: 'ability1', name: 'Ability I', scopes: ['battle'], context: 'combat', default: 'q',
    desc: 'First ability.',
  },
  {
    id: 'ability2', name: 'Ability II', scopes: ['battle'], context: 'combat', default: 'w',
    desc: 'Second ability.',
  },
  {
    id: 'ability3', name: 'Ability III', scopes: ['battle'], context: 'combat', default: 'e',
    desc: 'Third ability.',
  },
  {
    id: 'ability4', name: 'Ability IV', scopes: ['battle'], context: 'combat', default: 'r',
    desc: 'Fourth ability.',
  },
  {
    id: 'attack_move', name: 'Arm attack-move', scopes: ['battle'], context: 'combat', default: 'a',
    desc: 'The next click attack-moves. Right-click already attacks an enemy.',
  },
  {
    id: 'swap_set', name: 'Swap weapon set', scopes: ['battle'], context: 'combat', default: 'x',
    desc: 'Draw the other weapon set. Four second cooldown.',
  },
  {
    id: 'second_bar', name: 'Secondary bar (hold)', scopes: ['battle'], context: 'combat', default: 'control', held: true,
    desc: 'Hold with Ability I or II for slots five and six.',
  },
  {
    id: 'consumable1', name: 'Consumable I', scopes: ['battle'], context: 'combat', default: '1', reserved: true,
    desc: 'Reserved. Zillions has no flask system; these slots are where one would go.',
  },
  {
    id: 'consumable2', name: 'Consumable II', scopes: ['battle'], context: 'combat', default: '2', reserved: true,
    desc: 'Cast the third equipped ability.',
  },

  // ---- army and colony ----
  {
    id: 'build', name: 'Build, upgrade, repair', scopes: ['battle'], context: 'army', default: 'b', held: true,
    desc: 'Secondary Build-mode binding. Hold at a foundation until it rises.',
  },
  {
    id: 'build_mode', name: 'Toggle Build / Fight mode', scopes: ['battle'], context: 'army', default: 'alt',
    desc: 'Build mode enables construction. Fight mode enables dodge and hero abilities.',
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
  numpad8: 'Num8', numpad4: 'Num4', numpad2: 'Num2', numpad6: 'Num6',
};

const ABILITY_LABELS = [
  [0, 'ability1', false],
  [1, 'ability2', false],
  [2, 'ability3', false],
  [3, 'ability4', false],
  [4, 'ability1', true],
  [5, 'ability2', true],
];

export function abilityKeyLabel(binds, slot) {
  const row = ABILITY_LABELS.find((entry) => entry[0] === slot);
  if (!row || !binds) return '';
  const prefix = row[2] ? `${keyLabel(binds.second_bar)}+` : '';
  return prefix + keyLabel(binds[row[1]]);
}

const PARK_KEYS = ['f', 'y', 'u', 'h', 'j', 'k', 'l', 'n', 'i', 'o'];

function firstFree(binds, id, prefer = PARK_KEYS) {
  for (const key of prefer) {
    if (!conflictsFor({ ...binds, [id]: key }, id, key).length) return key;
  }
  return binds[id];
}

// WASD camera pan is optional because W and A are Ability II and attack-move.
// Turning it on parks those two actions on free keys. Turning it off puts them back
// when the player has not rebound them since.
export function setWasdCamera(binds, feel, on) {
  const next = { ...defaultBinds(), ...(binds || {}) };
  const options = normalizeFeel(feel);
  const parked = { ...(options.parked || {}) };
  if (on) {
    if (next.ability2 === 'w') {
      const to = firstFree(next, 'ability2');
      parked.ability2 = { from: 'w', to };
      next.ability2 = to;
    }
    if (next.attack_move === 'a') {
      const to = firstFree(next, 'attack_move');
      parked.attack_move = { from: 'a', to };
      next.attack_move = to;
    }
    options.wasdCamera = true;
    options.parked = parked;
  } else {
    for (const [id, move] of Object.entries(parked)) {
      if (!move || next[id] !== move.to) continue;
      if (!conflictsFor({ ...next, [id]: move.from }, id, move.from).length) next[id] = move.from;
    }
    options.wasdCamera = false;
    options.parked = null;
  }
  return { binds: normalizeBinds(next), feel: normalizeFeel(options) };
}

export function normalizeFeel(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const parked = src.parked && typeof src.parked === 'object' ? { ...src.parked } : null;
  return {
    wasdCamera: !!src.wasdCamera,
    edgePan: src.edgePan !== false,
    reduceShake: !!src.reduceShake,
    parked,
  };
}

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
let _feel = null;

export function setKeybindBackend(backend) {
  _backend = backend;
  _cache = null;
  _feel = null;
}

function readStore() {
  try {
    if (_backend) return _backend.load();
    if (typeof localStorage !== 'undefined') return JSON.parse(localStorage.getItem(KEYBIND_KEY) || 'null');
  } catch { /* a blocked store loads the defaults */ }
  return null;
}

function hydrate(force = false) {
  if (_cache && _feel && !force) return;
  const raw = readStore();
  const current = !!(raw && raw.v === KEYBIND_VERSION);
  _cache = normalizeBinds(current ? raw.binds : null);
  _feel = normalizeFeel(current ? raw.feel : null);
}

function persist() {
  const payload = { v: KEYBIND_VERSION, binds: _cache, feel: _feel };
  try {
    if (_backend) _backend.save(payload);
    else if (typeof localStorage !== 'undefined') localStorage.setItem(KEYBIND_KEY, JSON.stringify(payload));
  } catch { /* a full or blocked store must never cost the player their game */ }
}

export function loadBinds({ force = false } = {}) {
  hydrate(force);
  return _cache;
}

export function loadFeel({ force = false } = {}) {
  hydrate(force);
  return _feel;
}

export function saveBinds(binds) {
  hydrate();
  _cache = normalizeBinds(binds);
  persist();
  return _cache;
}

export function saveFeel(feel) {
  hydrate();
  _feel = normalizeFeel(feel);
  persist();
  return _feel;
}

export function resetBinds() {
  _cache = normalizeBinds(null);
  _feel = normalizeFeel(null);
  persist();
  return _cache;
}
