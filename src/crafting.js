// Pure crafting and socket rules.
//
// This module does not own inventory, materials, Salvage Alloy, or persistence.
// It validates an authority-owned item snapshot and returns one atomic mutation
// proposal. The authority layer must apply the proposal once, in a transaction.

import { hashString, MOD_KEYS } from './items.js';
import { itemInfo } from './config.js';

export const CRAFTING_SCHEMA = 'zillions.crafting.v1';

export const SOCKET_COLORS = ['frame', 'reflex', 'signal', 'prismatic'];
export const SOCKET_TYPES = ['drive', 'optic', 'ward'];

export const CRAFTING_MATERIALS = {
  alloy_shard: { id: 'alloy_shard', name: 'Alloy Shard', icon: '⬡' },
  phase_flux: { id: 'phase_flux', name: 'Phase Flux', icon: '⌁' },
  prism_dust: { id: 'prism_dust', name: 'Prism Dust', icon: '◇' },
  ascendant_core: { id: 'ascendant_core', name: 'Ascendant Core', icon: '✦' },
};

export const COMPONENTS = {
  frame_drive: { id: 'frame_drive', name: 'Bulwark Drive', type: 'drive', color: 'frame', maxRank: 5, perRank: { frame: 2 } },
  reflex_drive: { id: 'reflex_drive', name: 'Vector Drive', type: 'drive', color: 'reflex', maxRank: 5, perRank: { reflex: 2 } },
  signal_drive: { id: 'signal_drive', name: 'Relay Drive', type: 'drive', color: 'signal', maxRank: 5, perRank: { signal: 2 } },
  kinetic_optic: { id: 'kinetic_optic', name: 'Kinetic Optic', type: 'optic', color: 'reflex', maxRank: 5, perRank: { critChance: 0.01 } },
  thermal_optic: { id: 'thermal_optic', name: 'Thermal Optic', type: 'optic', color: 'signal', maxRank: 5, perRank: { thermal: 0.025 } },
  bulwark_ward: { id: 'bulwark_ward', name: 'Bulwark Ward', type: 'ward', color: 'frame', maxRank: 5, perRank: { armor: 0.012 } },
  phase_ward: { id: 'phase_ward', name: 'Phase Ward', type: 'ward', color: 'signal', maxRank: 5, perRank: { evadeChance: 0.008 } },
};

export const RECIPES = {
  calibrate_sockets: {
    id: 'calibrate_sockets', action: 'calibrate', name: 'Calibrate sockets',
    cost: { materials: { phase_flux: 1 }, alloy: 20 },
  },
  add_socket: {
    id: 'add_socket', action: 'add_socket', name: 'Add a socket',
    cost: { materials: { alloy_shard: 3, phase_flux: 1 }, alloy: 60 },
  },
  prism_socket: {
    id: 'prism_socket', action: 'prism_socket', name: 'Make a socket prismatic',
    cost: { materials: { prism_dust: 2 }, alloy: 90 },
  },
  upgrade_component: {
    id: 'upgrade_component', action: 'upgrade_component', name: 'Upgrade a component',
    cost: { materials: { alloy_shard: 2 }, alloy: 40 },
  },
};

export const CRAFT_ERRORS = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_ITEM: 'invalid_item',
  NOT_OWNER: 'not_owner',
  DUPLICATE_REQUEST: 'duplicate_request',
  STALE_REVISION: 'stale_revision',
  INVALID_RECIPE: 'invalid_recipe',
  INVALID_SOCKET: 'invalid_socket',
  SOCKET_LIMIT: 'socket_limit',
  SOCKET_OCCUPIED: 'socket_occupied',
  SOCKET_EMPTY: 'socket_empty',
  INCOMPATIBLE_COMPONENT: 'incompatible_component',
  INVALID_COMPONENT: 'invalid_component',
  MAX_RANK: 'max_rank',
  INVENTORY_FULL: 'inventory_full',
  INSUFFICIENT_MATERIALS: 'insufficient_materials',
  INSUFFICIENT_ALLOY: 'insufficient_alloy',
};

const fail = (code, message, details = {}) => ({
  ok: false, schema: CRAFTING_SCHEMA, error: { code, message, details },
});

const cloneSockets = (sockets = []) => sockets.map((socket) => ({
  color: socket.color,
  type: socket.type,
  component: socket.component ? { ...socket.component } : null,
}));

const emptyComponentMods = () => Object.fromEntries(MOD_KEYS.map((key) => [key, 0]));

export function componentMods(componentOrId, rank = 1) {
  const component = typeof componentOrId === 'string' ? COMPONENTS[componentOrId] : COMPONENTS[componentOrId?.id];
  if (!component) return emptyComponentMods();
  const boundedRank = Math.max(1, Math.min(component.maxRank, Math.floor(Number(rank ?? componentOrId?.rank) || 1)));
  const out = emptyComponentMods();
  for (const [key, value] of Object.entries(component.perRank || {})) out[key] = value * boundedRank;
  return out;
}

// Sum installed component effects exactly once. The authority layer normally
// guarantees unique component ownership. Instance de-duplication here keeps a
// corrupt or repeated item snapshot from granting the same power twice.
export function socketComponentMods(items = []) {
  const out = emptyComponentMods();
  const seen = new Set();
  const list = Array.isArray(items) ? items : [items];
  for (const item of list) {
    for (const socket of item?.sockets || []) {
      const installed = socket?.component;
      if (!installed?.instanceId || seen.has(installed.instanceId)) continue;
      seen.add(installed.instanceId);
      const mods = componentMods(installed, installed.rank);
      for (const key of MOD_KEYS) out[key] += mods[key];
    }
  }
  return out;
}

export function maxSocketCount(itemOrKey) {
  const item = typeof itemOrKey === 'string' ? itemInfo(itemOrKey) : itemOrKey;
  if (!item) return 0;
  const slotCaps = { weapon: 3, offhand: 2, head: 2, armor: 3, hands: 2, legs: 2, boots: 2, implant: 1 };
  const cap = slotCaps[item.slot] || 0;
  const ilvlCap = item.ilvl >= 60 ? 3 : item.ilvl >= 25 ? 2 : 1;
  const rarityCap = Math.max(1, Number(item.rarity) || 1);
  return Math.min(cap, ilvlCap, rarityCap);
}

export function socketTypeForItem(itemOrKey) {
  const item = typeof itemOrKey === 'string' ? itemInfo(itemOrKey) : itemOrKey;
  if (!item) return null;
  if (item.slot === 'weapon' || item.slot === 'hands') return 'optic';
  if (item.slot === 'armor' || item.slot === 'head' || item.slot === 'legs' || item.slot === 'boots') return 'ward';
  return 'drive';
}

export function socketColor(seed, index = 0) {
  return ['frame', 'reflex', 'signal'][hashString(`${seed}:socket:${index}`) % 3];
}

export function initialSockets(itemKey, count = 0) {
  const item = itemInfo(itemKey);
  if (!item) return [];
  const total = Math.max(0, Math.min(maxSocketCount(item), Math.floor(Number(count) || 0)));
  return Array.from({ length: total }, (_, index) => ({
    color: socketColor(itemKey, index), type: socketTypeForItem(item), component: null,
  }));
}

export function normalizeCraftItem(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const item = itemInfo(snapshot.itemKey);
  if (!item || typeof snapshot.instanceId !== 'string' || !snapshot.instanceId) return null;
  const revision = Number(snapshot.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  const sockets = cloneSockets(snapshot.sockets);
  if (sockets.length > maxSocketCount(item)) return null;
  for (const socket of sockets) {
    if (!SOCKET_COLORS.includes(socket.color) || !SOCKET_TYPES.includes(socket.type)) return null;
    if (socket.type !== socketTypeForItem(item)) return null;
    if (socket.component) {
      const def = COMPONENTS[socket.component.id];
      if (!def || def.type !== socket.type) return null;
      const rank = Number(socket.component.rank);
      if (!Number.isSafeInteger(rank) || rank < 1 || rank > def.maxRank) return null;
      if (socket.color !== 'prismatic' && socket.color !== def.color) return null;
    }
  }
  return { ...snapshot, revision, sockets, item };
}

function validateContext(context, request) {
  if (!request || typeof request !== 'object' || typeof request.requestId !== 'string' || !request.requestId) {
    return fail(CRAFT_ERRORS.INVALID_REQUEST, 'A request ID is required.');
  }
  if (Array.isArray(context?.processedRequestIds) && context.processedRequestIds.includes(request.requestId)) {
    return fail(CRAFT_ERRORS.DUPLICATE_REQUEST, 'This crafting request was already processed.', { requestId: request.requestId });
  }
  const item = normalizeCraftItem(context?.item);
  if (!item) return fail(CRAFT_ERRORS.INVALID_ITEM, 'The item snapshot is invalid.');
  if (!context.actorId || item.ownerId !== context.actorId) {
    return fail(CRAFT_ERRORS.NOT_OWNER, 'The character does not own this item.');
  }
  if (request.expectedRevision !== item.revision) {
    return fail(CRAFT_ERRORS.STALE_REVISION, 'The item changed before crafting completed.', {
      expectedRevision: request.expectedRevision, actualRevision: item.revision,
    });
  }
  return { ok: true, item };
}

function costShortfall(context, cost) {
  const alloy = Math.max(0, Math.floor(Number(context.alloyBalance) || 0));
  if (alloy < (cost.alloy || 0)) {
    return fail(CRAFT_ERRORS.INSUFFICIENT_ALLOY, 'Not enough Salvage Alloy.', { required: cost.alloy, available: alloy });
  }
  for (const [id, required] of Object.entries(cost.materials || {})) {
    const available = Math.max(0, Math.floor(Number(context.materials?.[id]) || 0));
    if (available < required) {
      return fail(CRAFT_ERRORS.INSUFFICIENT_MATERIALS, `Not enough ${CRAFTING_MATERIALS[id]?.name || id}.`, {
        materialId: id, required, available,
      });
    }
  }
  return null;
}

function success(context, request, item, sockets, action, cost = { materials: {}, alloy: 0 }, extra = {}) {
  const nextRevision = item.revision + 1;
  const outputItem = {
    instanceId: item.instanceId, ownerId: item.ownerId, itemKey: item.itemKey,
    revision: nextRevision, sockets: cloneSockets(sockets),
  };
  return {
    ok: true,
    schema: CRAFTING_SCHEMA,
    requestId: request.requestId,
    action,
    costs: { alloy: cost.alloy || 0, materials: { ...(cost.materials || {}) } },
    item: outputItem,
    mutation: {
      expectedRevision: item.revision,
      nextRevision,
      item: outputItem,
      components: {
        consume: [...(extra.consumeComponents || [])],
        return: [...(extra.returnComponents || [])],
      },
    },
    provenance: {
      actorId: context.actorId,
      action,
      requestId: request.requestId,
      instanceId: item.instanceId,
      itemKey: item.itemKey,
      fromRevision: item.revision,
      toRevision: nextRevision,
      inputs: { alloy: cost.alloy || 0, materials: { ...(cost.materials || {}) }, ...extra.inputs },
      outputs: { itemInstanceId: item.instanceId, itemRevision: nextRevision, ...extra.outputs },
    },
    ui: { message: extra.message || 'Crafting complete.', changedSocketIndex: extra.socketIndex ?? null },
  };
}

export function evaluateSocketInsert(context, request) {
  const valid = validateContext(context, request);
  if (!valid.ok) return valid;
  const { item } = valid;
  const index = Math.floor(Number(request.socketIndex));
  const socket = item.sockets[index];
  if (!socket) return fail(CRAFT_ERRORS.INVALID_SOCKET, 'Select a valid socket.', { socketIndex: request.socketIndex });
  if (socket.component) return fail(CRAFT_ERRORS.SOCKET_OCCUPIED, 'Remove the installed component first.', { socketIndex: index });
  const componentSnapshot = context?.component;
  const component = COMPONENTS[componentSnapshot?.componentId];
  if (!component || !componentSnapshot?.instanceId || componentSnapshot.ownerId !== context.actorId || componentSnapshot.rank !== 1) {
    return fail(CRAFT_ERRORS.INVALID_COMPONENT, 'Select an owned rank-one component.');
  }
  if (component.type !== socket.type || (socket.color !== 'prismatic' && socket.color !== component.color)) {
    return fail(CRAFT_ERRORS.INCOMPATIBLE_COMPONENT, 'The component does not match this socket.', {
      socketColor: socket.color, socketType: socket.type, componentColor: component.color, componentType: component.type,
    });
  }
  const sockets = cloneSockets(item.sockets);
  sockets[index].component = { instanceId: String(componentSnapshot.instanceId), id: component.id, rank: 1 };
  return success(context, request, item, sockets, 'insert_component', { alloy: 0, materials: {} }, {
    socketIndex: index,
    inputs: { componentInstanceId: String(componentSnapshot.instanceId), componentId: component.id },
    consumeComponents: [{ instanceId: String(componentSnapshot.instanceId), componentId: component.id, rank: 1 }],
    message: `${component.name} installed.`,
  });
}

export function evaluateSocketRemove(context, request) {
  const valid = validateContext(context, request);
  if (!valid.ok) return valid;
  const { item } = valid;
  const index = Math.floor(Number(request.socketIndex));
  const socket = item.sockets[index];
  if (!socket) return fail(CRAFT_ERRORS.INVALID_SOCKET, 'Select a valid socket.', { socketIndex: request.socketIndex });
  if (!socket.component) return fail(CRAFT_ERRORS.SOCKET_EMPTY, 'The socket is empty.', { socketIndex: index });
  if (Number(context.availableComponentSlots) < 1) {
    return fail(CRAFT_ERRORS.INVENTORY_FULL, 'Make room for the removed component.');
  }
  const removed = { ...socket.component };
  const sockets = cloneSockets(item.sockets);
  sockets[index].component = null;
  return success(context, request, item, sockets, 'remove_component', { alloy: 0, materials: {} }, {
    socketIndex: index,
    outputs: { returnedComponent: removed },
    returnComponents: [{ instanceId: removed.instanceId, componentId: removed.id, rank: removed.rank }],
    message: `${COMPONENTS[removed.id].name} removed.`,
  });
}

export function evaluateRecipe(context, request) {
  const valid = validateContext(context, request);
  if (!valid.ok) return valid;
  const { item } = valid;
  const recipe = RECIPES[request.recipeId];
  if (!recipe) return fail(CRAFT_ERRORS.INVALID_RECIPE, 'Select a valid recipe.', { recipeId: request.recipeId });
  const short = costShortfall(context, recipe.cost);
  if (short) return short;
  const sockets = cloneSockets(item.sockets);
  const index = Math.floor(Number(request.socketIndex));

  if (recipe.action === 'add_socket') {
    if (sockets.length >= maxSocketCount(item.item)) return fail(CRAFT_ERRORS.SOCKET_LIMIT, 'This item cannot hold another socket.');
    sockets.push({ color: socketColor(`${item.itemKey}:${request.requestId}`, sockets.length), type: socketTypeForItem(item.item), component: null });
    return success(context, request, item, sockets, recipe.action, recipe.cost, { socketIndex: sockets.length - 1, message: 'Socket added.' });
  }
  const socket = sockets[index];
  if (!socket) return fail(CRAFT_ERRORS.INVALID_SOCKET, 'Select a valid socket.', { socketIndex: request.socketIndex });
  if (recipe.action === 'calibrate') {
    if (socket.component) return fail(CRAFT_ERRORS.SOCKET_OCCUPIED, 'Remove the installed component before calibration.', { socketIndex: index });
    socket.color = socketColor(`${item.itemKey}:${request.requestId}:calibrate`, index);
    return success(context, request, item, sockets, recipe.action, recipe.cost, { socketIndex: index, message: 'Socket calibrated.' });
  }
  if (recipe.action === 'prism_socket') {
    socket.color = 'prismatic';
    return success(context, request, item, sockets, recipe.action, recipe.cost, { socketIndex: index, message: 'Socket made prismatic.' });
  }
  if (recipe.action === 'upgrade_component') {
    if (!socket.component) return fail(CRAFT_ERRORS.SOCKET_EMPTY, 'Install a component before upgrading it.', { socketIndex: index });
    const component = COMPONENTS[socket.component.id];
    if (socket.component.rank >= component.maxRank) return fail(CRAFT_ERRORS.MAX_RANK, 'This component is already at maximum rank.', { rank: socket.component.rank });
    const rank = socket.component.rank + 1;
    const scaledCost = {
      alloy: recipe.cost.alloy * socket.component.rank,
      materials: Object.fromEntries(Object.entries(recipe.cost.materials).map(([id, value]) => [id, value * socket.component.rank])),
    };
    const scaledShort = costShortfall(context, scaledCost);
    if (scaledShort) return scaledShort;
    socket.component.rank = rank;
    return success(context, request, item, sockets, recipe.action, scaledCost, {
      socketIndex: index, inputs: { componentInstanceId: socket.component.instanceId }, message: `${component.name} upgraded to rank ${rank}.`,
    });
  }
  return fail(CRAFT_ERRORS.INVALID_RECIPE, 'The recipe action is not supported.');
}
