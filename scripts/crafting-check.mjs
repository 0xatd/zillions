import assert from 'node:assert/strict';
import {
  COMPONENTS, CRAFT_ERRORS, CRAFTING_MATERIALS, RECIPES, SOCKET_COLORS, SOCKET_TYPES,
  evaluateRecipe, evaluateSocketInsert, evaluateSocketRemove, initialSockets, maxSocketCount,
  normalizeCraftItem, socketColor, socketTypeForItem, componentMods, socketComponentMods,
} from '../src/crafting.js';
import { MOD_KEYS, resolveItem, rollItemKey } from '../src/items.js';

const key = rollItemKey('scatter_mk3', 'craft-check', 70, 3);
const actorId = 'character-1';
const item = {
  instanceId: 'item-1', ownerId: actorId, itemKey: key, revision: 4,
  sockets: initialSockets(key, 1),
};
const rich = {
  actorId, item, alloyBalance: 10000,
  materials: Object.fromEntries(Object.keys(CRAFTING_MATERIALS).map((id) => [id, 100])),
  processedRequestIds: [], availableComponentSlots: 3,
};
const request = (requestId, extra = {}) => ({ requestId, expectedRevision: 4, ...extra });

assert.equal(maxSocketCount(resolveItem(key)), 3);
assert.ok(normalizeCraftItem({ instanceId: 'legacy-1', ownerId: actorId, itemKey: 'oath_blade', revision: 0, sockets: [] }),
  'legacy authored items must survive instance migration without gaining an invented slot');
assert.equal(socketTypeForItem(key), 'optic');
assert.ok(SOCKET_COLORS.includes(socketColor(key, 0)));
assert.deepEqual(SOCKET_TYPES, ['drive', 'optic', 'ward']);
assert.ok(normalizeCraftItem(item));
assert.equal(normalizeCraftItem({ ...item, revision: -1 }), null);
assert.equal(normalizeCraftItem({ ...item, sockets: [{ color: 'red', type: 'optic', component: null }] }), null);

const added = evaluateRecipe(rich, request('add-1', { recipeId: 'add_socket' }));
assert.equal(added.ok, true);
assert.equal(added.item.instanceId, item.instanceId, 'crafting must preserve the item instance ID');
assert.equal(added.item.revision, 5, 'crafting must increment exactly one revision');
assert.equal(added.item.sockets.length, 2);
assert.equal(item.sockets.length, 1, 'evaluation must not mutate the authority snapshot');
assert.equal(added.mutation.expectedRevision, 4);
assert.equal(added.provenance.requestId, 'add-1');
assert.equal(evaluateRecipe(rich, request('bad-recipe', { recipeId: 'unknown' })).error.code, CRAFT_ERRORS.INVALID_RECIPE);
assert.equal(evaluateRecipe({ ...rich, actorId: 'thief' }, request('steal', { recipeId: 'add_socket' })).error.code, CRAFT_ERRORS.NOT_OWNER);
assert.equal(evaluateRecipe(rich, { ...request('stale', { recipeId: 'add_socket' }), expectedRevision: 3 }).error.code, CRAFT_ERRORS.STALE_REVISION);
assert.equal(evaluateRecipe({ ...rich, processedRequestIds: ['replay'] }, request('replay', { recipeId: 'add_socket' })).error.code, CRAFT_ERRORS.DUPLICATE_REQUEST);
assert.equal(evaluateRecipe({ ...rich, alloyBalance: 0 }, request('poor', { recipeId: 'add_socket' })).error.code, CRAFT_ERRORS.INSUFFICIENT_ALLOY);
assert.equal(evaluateRecipe({ ...rich, materials: {} }, request('bare', { recipeId: 'add_socket' })).error.code, CRAFT_ERRORS.INSUFFICIENT_MATERIALS);

let full = { ...item, sockets: initialSockets(key, maxSocketCount(key)) };
assert.equal(evaluateRecipe({ ...rich, item: full }, request('full', { recipeId: 'add_socket' })).error.code, CRAFT_ERRORS.SOCKET_LIMIT);

const compatibleId = item.sockets[0].color === 'reflex' ? 'kinetic_optic' : 'thermal_optic';
const compatible = COMPONENTS[compatibleId];
const insertContext = {
  ...rich,
  component: { instanceId: 'component-1', ownerId: actorId, componentId: compatible.id, rank: 1 },
};
// The two authored optic colors do not cover Frame. Make that deterministic
// edge prismatic before checking component insertion.
let insertItem = item;
if (item.sockets[0].color === 'frame') insertItem = { ...item, sockets: [{ ...item.sockets[0], color: 'prismatic' }] };
const inserted = evaluateSocketInsert({ ...insertContext, item: insertItem }, request('insert', { socketIndex: 0 }));
assert.equal(inserted.ok, true);
assert.equal(inserted.item.sockets[0].component.instanceId, 'component-1');
assert.deepEqual(inserted.mutation.components.consume, [{ instanceId: 'component-1', componentId: compatible.id, rank: 1 }]);
assert.deepEqual(inserted.mutation.components.return, []);
assert.equal(evaluateSocketInsert({ ...insertContext, component: { ...insertContext.component, ownerId: 'other' }, item: insertItem }, request('foreign-component', { socketIndex: 0 })).error.code, CRAFT_ERRORS.INVALID_COMPONENT);

const wrongComponent = compatible.id === 'kinetic_optic' ? COMPONENTS.thermal_optic : COMPONENTS.kinetic_optic;
const wrong = evaluateSocketInsert({
  ...rich,
  item: { ...item, sockets: [{ color: compatible.color, type: 'optic', component: null }] },
  component: { instanceId: 'component-2', ownerId: actorId, componentId: wrongComponent.id, rank: 1 },
}, request('wrong', { socketIndex: 0 }));
assert.equal(wrong.error.code, CRAFT_ERRORS.INCOMPATIBLE_COMPONENT);

const installedItem = inserted.item;
const removeContext = { ...rich, item: installedItem };
const removed = evaluateSocketRemove(removeContext, { requestId: 'remove', expectedRevision: 5, socketIndex: 0 });
assert.equal(removed.ok, true);
assert.equal(removed.provenance.outputs.returnedComponent.instanceId, 'component-1');
assert.deepEqual(removed.mutation.components.consume, []);
assert.deepEqual(removed.mutation.components.return, [{ instanceId: 'component-1', componentId: compatible.id, rank: 1 }]);
assert.equal(evaluateSocketRemove({ ...removeContext, availableComponentSlots: 0 }, { requestId: 'remove-full', expectedRevision: 5, socketIndex: 0 }).error.code, CRAFT_ERRORS.INVENTORY_FULL);

const upgrade = evaluateRecipe(removeContext, { requestId: 'upgrade', expectedRevision: 5, recipeId: 'upgrade_component', socketIndex: 0 });
assert.equal(upgrade.ok, true);
assert.equal(upgrade.item.sockets[0].component.rank, 2);
assert.equal(upgrade.costs.alloy, RECIPES.upgrade_component.cost.alloy);
const maxedItem = { ...installedItem, sockets: installedItem.sockets.map((socket, i) => i === 0 ? { ...socket, component: { ...socket.component, rank: COMPONENTS[socket.component.id].maxRank } } : socket) };
assert.equal(evaluateRecipe({ ...rich, item: maxedItem }, { requestId: 'max', expectedRevision: 5, recipeId: 'upgrade_component', socketIndex: 0 }).error.code, CRAFT_ERRORS.MAX_RANK);

const calibratedA = evaluateRecipe(rich, request('calibrate', { recipeId: 'calibrate_sockets', socketIndex: 0 }));
const calibratedB = evaluateRecipe(rich, request('calibrate', { recipeId: 'calibrate_sockets', socketIndex: 0 }));
assert.deepEqual(calibratedA, calibratedB, 'the same request must produce the same proposal');
const prism = evaluateRecipe(rich, request('prism', { recipeId: 'prism_socket', socketIndex: 0 }));
assert.equal(prism.item.sockets[0].color, 'prismatic');

// Installed components contribute bounded existing-stat mods. Repeating the
// same instance through a corrupt snapshot must never double its power.
for (const component of Object.values(COMPONENTS)) {
  for (const key of Object.keys(component.perRank)) assert.ok(MOD_KEYS.includes(key), `${component.id} uses unknown mod ${key}`);
  const rankOne = componentMods(component.id, 1);
  const max = componentMods(component.id, component.maxRank);
  const over = componentMods(component.id, 999);
  assert.deepEqual(over, max, `${component.id} rank must clamp at maxRank`);
  for (const key of Object.keys(component.perRank)) assert.equal(max[key], rankOne[key] * component.maxRank);
}
const installedMods = socketComponentMods([inserted.item]);
const expectedMods = componentMods(compatible.id, 1);
assert.deepEqual(installedMods, expectedMods, 'installed component did not reach the resolved stat bag');
assert.deepEqual(socketComponentMods([inserted.item, inserted.item]), expectedMods, 'one component instance counted twice');
const upgradedMods = socketComponentMods([upgrade.item]);
for (const key of Object.keys(compatible.perRank)) assert.equal(upgradedMods[key], expectedMods[key] * 2, 'rank upgrade did not affect the stat bag once');

for (const result of [added, inserted, removed, upgrade, calibratedA, prism]) {
  assert.equal(result.schema, 'zillions.crafting.v1');
  assert.ok(result.ui.message);
  assert.ok(result.provenance.actorId);
  assert.equal(result.provenance.fromRevision + 1, result.provenance.toRevision);
}

console.log('crafting-check: pure socket, recipe, revision, cost, ownership, replay, and provenance rules hold');
