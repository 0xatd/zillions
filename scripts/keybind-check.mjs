// The control scheme. Keys used to be literals scattered through the keydown
// handler, so the code, the README and the help screen could disagree and
// nothing caught it. This is what stops that coming back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS, ACTIONS_BY_ID, BIND_CONTEXTS, defaultBinds, normalizeBinds, allConflicts,
  conflictsFor, actionFor, isHeld, keyLabel, KEYBIND_VERSION,
} from '../src/keybinds.js';

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

// ---------- the table itself ----------
for (const action of ACTIONS) {
  ok(action.id && action.name, `${action.id}: needs an id and a name`);
  ok(BIND_CONTEXTS[action.context], `${action.id}: unknown context "${action.context}"`);
  ok(typeof action.default === 'string' && action.default, `${action.id}: no default key`);
  ok(action.default === action.default.toLowerCase(), `${action.id}: default key must be lower case`);
  ok(keyLabel(action.default) !== '—', `${action.id}: default key has no label`);
}
ok(new Set(ACTIONS.map((a) => a.id)).size === ACTIONS.length, 'duplicate action id');

// The shipped scheme must be playable: no two actions in one group may share a
// key, or the second one silently never fires.
const defaults = defaultBinds();
const clashes = allConflicts(defaults);
ok(clashes.length === 0, `the default scheme has conflicts: ${JSON.stringify(clashes)}`);

// ---------- the layout we committed to ----------
// These are product decisions, not implementation details. Changing one is a
// choice someone should have to make deliberately.
const EXPECTED = {
  move_up: 'w', move_left: 'a', move_down: 's', move_right: 'd', sprint: 'shift',
  dodge: ' ',                 // Path of Exile 2 puts the dodge roll on Space
  ability1: 'q', ability2: 'e', ability3: 'r',
  swap_set: 'x',              // and the weapon swap on X
  second_bar: 'control',
  consumable1: '1', consumable2: '2',
  build: 'b', build_mode: 'alt',
  stance_defend: 'f1', stance_follow: 'f2', stance_push: 'f3',
  character_sheet: 'c', lattice_panel: 'g',
  menu: 'escape',
};
for (const [id, key] of Object.entries(EXPECTED)) {
  ok(defaults[id] === key, `${id} defaults to "${defaults[id]}", expected "${key}"`);
}
// Stances moved off 1/2/3 to free them for consumables. If they come back,
// the product contract has to change with them.
ok(!['1', '2', '3'].includes(defaults.stance_defend), 'stances must not sit on the number row');

// ---------- normalising is total ----------
for (const bad of [null, undefined, 42, 'nope', [], { move_up: 42 }, { nonsense: 'k' }, { menu: 'z' }]) {
  let threw = false;
  let out = null;
  try { out = normalizeBinds(bad); } catch { threw = true; }
  ok(!threw, `normalizeBinds threw on ${JSON.stringify(bad)}`);
  ok(out && ACTIONS.every((a) => typeof out[a.id] === 'string'), `normalizeBinds left a hole on ${JSON.stringify(bad)}`);
}
ok(normalizeBinds({ menu: 'z' }).menu === 'escape', 'a fixed action was rebound');
ok(normalizeBinds({ move_up: 'K' }).move_up === 'k', 'a rebound key was not lower-cased');
ok(normalizeBinds({ __proto__: 'x' }).move_up === 'w', 'a prototype key disturbed the scheme');
ok(Object.keys(normalizeBinds({})).length === ACTIONS.length, 'normalize did not return the full scheme');

// ---------- lookup ----------
ok(actionFor(defaults, ' ') === 'dodge', 'Space does not resolve to the dodge roll');
ok(actionFor(defaults, 'x') === 'swap_set', 'X does not resolve to the weapon swap');
ok(actionFor(defaults, 'arrowup') === 'move_up', 'the arrow key alternate was lost');
ok(actionFor(defaults, 'ß') === null, 'an unbound key resolved to an action');
ok(actionFor(defaults, 'c', 'interface') === 'character_sheet', 'context lookup failed');
ok(actionFor(defaults, 'c', 'combat') === null, 'context lookup ignored its context');
ok(isHeld(defaults, new Set(['w']), 'move_up'), 'isHeld missed a held key');
ok(isHeld(defaults, new Set(['arrowup']), 'move_up'), 'isHeld missed the alternate');
ok(!isHeld(defaults, new Set(['j']), 'move_up'), 'isHeld matched the wrong key');

// Rebinding must be able to displace, and the screen must be told about it.
{
  const next = { ...defaults, tower_priority: defaults.drop_item };
  const clash = conflictsFor(next, 'tower_priority', next.tower_priority);
  ok(clash.length === 1 && clash[0].id === 'drop_item', 'a same-group conflict was not reported');
  // Across groups is legal — the two never listen at the same moment.
  const cross = { ...defaults, mute: defaults.build };
  ok(conflictsFor(cross, 'mute', cross.mute).length === 0, 'a cross-group key was reported as a conflict');
}

// ---------- nothing dispatches on a literal any more ----------
ok(!/this\.keys\.has\('[a-z ]'\)/.test(main), 'main.js still reads a hard-coded key');
ok(/actionFor\(binds, k\)/.test(main), 'the keydown handler must dispatch through the binding table');
for (const id of ['dodge', 'ability1', 'swap_set', 'stance_defend', 'build_mode', 'character_sheet', 'lattice_panel']) {
  ok(main.includes(`case '${id}'`), `main.js does not handle the ${id} action`);
}
ok(/isHeld\(binds, this\.keys, 'move_up'\)/.test(main), 'movement must read the binding table');

// ---------- the screen shows the same table ----------
ok(ui.includes('_renderKeybinds'), 'the Settings screen must render the bindings');
ok(ui.includes('set-pane-controls'), 'there must be a Controls pane');
ok(ui.includes("data-tab=\"controls\""), 'there must be a Controls tab');
ok(/keydown.*true\)/s.test(ui), 'rebinding must capture the next key press');
ok(ui.includes("key === 'escape'"), 'Escape must cancel a rebind rather than binding itself');
ok(main.includes('onKeybindChange') && main.includes('onKeybindReset'), 'the app must persist rebinds');

// ---------- the README says what the game does ----------
// Every non-reserved key a player can press has to appear in the controls
// table. Related keys may share a row ("F1, F2, F3"), so the first cell of
// each row is split before matching.
const controlsSection = readme.slice(readme.indexOf('## Controls'), readme.indexOf('## Local Development'));
ok(controlsSection.length > 200, 'the README has no Controls section');
const documentedKeys = new Set();
for (const line of controlsSection.split('\n')) {
  const match = /^\| ([^|]+) \| /.exec(line);
  if (!match || match[1].trim() === 'Input' || match[1].trim().startsWith('---')) continue;
  for (const part of match[1].split(',')) documentedKeys.add(part.trim());
}
for (const action of ACTIONS) {
  if (action.reserved || action.context === 'movement') continue;
  const label = keyLabel(defaults[action.id]);
  ok(documentedKeys.has(label), `README controls table is missing ${label} (${action.name})`);
}
// And the table must not promise a key the game does not bind.
const boundLabels = new Set(ACTIONS.flatMap((a) => [keyLabel(defaults[a.id]), a.alt ? keyLabel(a.alt) : null]).filter(Boolean));
for (const key of documentedKeys) {
  ok(boundLabels.has(key), `README documents "${key}", which nothing binds`);
}

if (failures) {
  console.error(`\nkeybind-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`keybind-check: ok (${ACTIONS.length} actions, ${Object.keys(BIND_CONTEXTS).length} groups, no conflicts, v${KEYBIND_VERSION})`);
