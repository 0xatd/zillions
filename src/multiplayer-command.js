import { validAbilitySlot } from './hero-abilities.js';
// The transport identifies a guest seat; packet payloads never choose it.
// Return a minimal command or null before anything enters the lockstep queue.
export function guestCommand(input, player, playerCount) {
  if (!Number.isInteger(player) || player < 1 || player >= playerCount) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.p !== undefined && input.p !== player) return null;
  const command = { t: input.t, p: player };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 64;
  const axis = value => Number.isFinite(value) && Math.abs(value) <= 1;
  switch (input.t) {
    case 'hdir':
      return axis(input.x) && axis(input.z) && typeof input.s === 'boolean'
        ? { ...command, x: input.x, z: input.z, s: input.s } : null;
    case 'hhalt':
      return ['stop','hold'].includes(input.k) ? {...command,k:input.k} : null;
    case 'horder': {
      const coord = (value) => Number.isFinite(value) && value >= 0 && value <= 512;
      const kind = input.k === 'attack' ? 'attack' : input.k === 'move' ? 'move' : null;
      if (!kind || !coord(input.x) || !coord(input.z)) return null;
      if (input.id !== undefined && input.id !== null && !integer(input.id)) return null;
      const order = {
        ...command,
        x: Math.round(input.x * 64) / 64,
        z: Math.round(input.z * 64) / 64,
        k: kind,
      };
      if (input.id != null) order.id = input.id;
      return order;
    }
    case 'dodge':
      return axis(input.x) && axis(input.z) ? { ...command, x: input.x, z: input.z } : null;
    case 'pay':
      return typeof input.on === 'boolean' ? { ...command, on: input.on } : null;
    case 'rally':
      return Number.isFinite(input.x) && Number.isFinite(input.z) && input.x >= 0 && input.z >= 0 && input.x <= 512 && input.z <= 512 ? {...command,x:Math.round(input.x*64)/64,z:Math.round(input.z*64)/64} : null;
    case 'stance':
      return ['defend', 'guard', 'attack'].includes(input.s) ? { ...command, s: input.s } : null;
    case 'heroUpgrade':
      return text(input.key) ? { ...command, key: input.key } : null;
    case 'choose':
      return integer(input.id) && text(input.b) ? { ...command, id: input.id, b: input.b } : null;
    case 'found':
      return integer(input.s) ? { ...command, s: input.s } : null;
    case 'drop':
      return input.i === undefined || (Number.isSafeInteger(input.i) && input.i >= -1)
        ? { ...command, i: input.i ?? -1 } : null;
    case 'blessing':
      return integer(input.i) ? { ...command, i: input.i } : null;
    case 'focus':
      return input.id === null || integer(input.id) ? { ...command, id: input.id } : null;
    case 'cast':
      if (input.slot !== undefined && !validAbilitySlot(input.slot)) return null;
      if (input.id !== undefined && !integer(input.id)) return null;
      if ((input.x !== undefined || input.z !== undefined) && !(Number.isFinite(input.x) && Number.isFinite(input.z) && input.x >= 0 && input.z >= 0)) return null;
      return {...command, ...(input.slot !== undefined ? {slot:input.slot} : {}), ...(input.id !== undefined ? {id:input.id} : {}), ...(input.x !== undefined ? {x:input.x,z:input.z} : {})};
    case 'towerpri': case 'swapset':
      return command;
    // Builder strategy spends the shared treasury: only the host can set it.
    // Guest packets, including forged p:0 packets, cannot enter those commands.
    default: return null;
  }
}
