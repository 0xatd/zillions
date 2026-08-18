// The control scheme. Keys used to be literals scattered through the keydown
// handler, so the code, the README and the help screen could disagree and
// nothing caught it. This is what stops that coming back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS, ACTIONS_BY_ID, BIND_CONTEXTS, SCOPES, defaultBinds, normalizeBinds, allConflicts,
  conflictsFor, actionFor, isHeld, keyLabel, keysForAction, KEYBIND_VERSION,
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
ok(actionFor(defaults, 'c', 'battle') === 'character_sheet', 'scoped lookup failed in battle');
ok(actionFor(defaults, 'c', 'hub') === 'character_sheet', 'scoped lookup failed in the hub');
ok(actionFor(defaults, 'b', 'hub') === null, 'a battle-only action answered in the hub');
ok(isHeld(defaults, new Set(['w']), 'move_up'), 'isHeld missed a held key');
ok(isHeld(defaults, new Set(['arrowup']), 'move_up'), 'isHeld missed the alternate');
ok(!isHeld(defaults, new Set(['j']), 'move_up'), 'isHeld matched the wrong key');

// Rebinding must be able to displace, and the screen must be told about it.
{
  const next = { ...defaults, tower_priority: defaults.drop_item };
  const clash = conflictsFor(next, 'tower_priority', next.tower_priority);
  ok(clash.length === 1 && clash[0].id === 'drop_item', 'a same-group conflict was not reported');
  // Display group is NOT scope. Two actions in different groups that are both
  // live in a battle still collide — that was the reported bug.
  const cross = { ...defaults, mute: defaults.build };
  ok(conflictsFor(cross, 'mute', cross.mute).some((a) => a.id === 'build'),
    'a collision across display groups was not reported');
}

// ---------- regression: collisions ACROSS display groups ----------
// Reported on PR #77. Conflict detection was scoped to the DISPLAY GROUP, but
// the battle dispatcher takes the first match across every action, so binding
// the Character Sheet (Interface) to Q silently killed it — ability1 (Combat)
// answered first and the sheet never opened. Scope, not group, decides.
{
  ok(defaults.ability1 === 'q', 'test fixture: ability1 should hold Q');
  const collided = { ...defaults, character_sheet: 'q' };

  const reported = conflictsFor(collided, 'character_sheet', 'q');
  ok(reported.some((a) => a.id === 'ability1'),
    'binding the character sheet to Q must report a conflict with the primary ability');
  ok(allConflicts(collided).length > 0, 'allConflicts missed a cross-group collision');

  // And a scheme in that state must never be stored.
  const resolved = normalizeBinds(collided);
  ok(allConflicts(resolved).length === 0, 'normalize stored a scheme with a dead action');

  // Exactly one action answers Q, and the battle dispatcher agrees which.
  const onQ = ACTIONS.filter((a) => resolved[a.id] === 'q');
  ok(onQ.length === 1, `${onQ.length} actions hold Q after normalising`);
  ok(actionFor(resolved, 'q', 'battle') === onQ[0].id, 'the battle dispatcher disagrees with the scheme');

  // Neither action may be silently lost — that is the whole failure.
  ok(resolved.character_sheet && resolved.ability1, 'an action was left with no key at all');
  ok(resolved.character_sheet !== resolved.ability1, 'both actions kept the same key');
  ok(actionFor(resolved, resolved.character_sheet, 'battle') === 'character_sheet',
    'the character sheet is not reachable in battle');
  ok(actionFor(resolved, resolved.ability1, 'battle') === 'ability1',
    'the primary ability is not reachable in battle');
}

// Every pair that can be live together, checked from both sides — a one-sided
// check would miss half of these.
for (const a of ACTIONS) {
  for (const b of ACTIONS) {
    if (a.id === b.id) continue;
    if (!(a.scopes || []).some((sc) => (b.scopes || []).includes(sc))) continue;
    const probe = { ...defaults, [a.id]: defaults[b.id] };
    ok(conflictsFor(probe, a.id, defaults[b.id]).some((c) => c.id === b.id),
      `${a.id} taking ${b.id}'s key was not reported`);
    ok(conflictsFor(probe, b.id, defaults[b.id]).some((c) => c.id === a.id),
      `the same conflict was not reported from ${b.id}'s side`);
  }
}

// ---------- regression: alternates count ----------
// The arrow keys are fixed alternates on movement and cannot be rebound, so an
// action bound to one is shadowed forever. Detection ignored them.
{
  const collided = { ...defaults, tower_priority: 'arrowup' };
  ok(conflictsFor(collided, 'tower_priority', 'arrowup').some((a) => a.id === 'move_up'),
    'binding to an arrow key must conflict with movement');
  ok(allConflicts(collided).length > 0, 'allConflicts ignored an alternate');
  const resolved = normalizeBinds(collided);
  ok(resolved.tower_priority !== 'arrowup', 'a scheme shadowed by an alternate was stored');
  ok(allConflicts(resolved).length === 0, 'normalising left an alternate conflict in place');
  ok(actionFor(resolved, 'arrowup', 'battle') === 'move_up', 'the arrow key stopped meaning movement');
}

// ---------- every scope is internally unambiguous ----------
// The invariant behind all of the above: within one scope no key may resolve to
// two actions, because the dispatcher stops at the first it finds.
for (const scope of Object.keys(SCOPES)) {
  const seen = new Map();
  for (const action of ACTIONS) {
    if (!(action.scopes || []).includes(scope)) continue;
    for (const key of keysForAction(defaults, action)) {
      ok(!seen.has(key), `${scope}: "${key}" answers both ${seen.get(key)} and ${action.id}`);
      seen.set(key, action.id);
    }
  }
}

// Scopes must be declared and real.
for (const action of ACTIONS) {
  ok(Array.isArray(action.scopes) && action.scopes.length, `${action.id}: declares no scope`);
  for (const scope of action.scopes) ok(SCOPES[scope], `${action.id}: unknown scope "${scope}"`);
}
ok(/actionFor\(this\.binds\(\), k, 'hub'\)/.test(main), 'the hub dispatcher must pass its scope');

// ---------- nothing dispatches on a literal any more ----------
ok(!/this\.keys\.has\('[a-z ]'\)/.test(main), 'main.js still reads a hard-coded key');
ok(/actionFor\(binds, k, 'battle'\)/.test(main), 'the keydown handler must dispatch through the binding table');
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
