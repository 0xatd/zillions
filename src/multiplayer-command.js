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
    case 'dodge':
      return axis(input.x) && axis(input.z) ? { ...command, x: input.x, z: input.z } : null;
    case 'pay':
      return typeof input.on === 'boolean' ? { ...command, on: input.on } : null;
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
    case 'cast': case 'towerpri': case 'swapset':
      return command;
    // Builder strategy spends the shared treasury: only the host can set it.
    // Guest packets, including forged p:0 packets, cannot enter those commands.
    default: return null;
  }
}
