// Pure living-world rules. The browser may render these results, but only the
// server persists commands and advances a shard clock.
export const WORLD_COMMANDS = Object.freeze([
  'issue_movement', 'cancel_movement', 'set_encounter_choice',
  'submit_battle_order', 'accept_surrender', 'trade_market',
]);

export const ENCOUNTER_CHOICES = Object.freeze([
  'fight', 'auto-command', 'surrender', 'parley', 'escape',
  'diversion', 'rearguard', 'fortify', 'call-allies', 'scatter',
  // Accepted while queued commands from the foundation migration drain.
  'auto_command', 'attempt_escape', 'negotiate',
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value)));

export function stableHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function validateWorldCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('invalid_command');
  if (!WORLD_COMMANDS.includes(command.type)) throw new Error('unsupported_command');
  if (!/^[a-zA-Z0-9:_-]{1,96}$/.test(command.requestId || '')) throw new Error('invalid_request_id');
  if (!/^[a-zA-Z0-9:_-]{1,96}$/.test(command.shardId || '')) throw new Error('invalid_shard_id');
  if (!/^[a-zA-Z0-9:_-]{1,96}$/.test(command.partyId || '')) throw new Error('invalid_party_id');
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) throw new Error('invalid_revision');
  return true;
}

export function movementDuration(route, party) {
  const distance = Math.max(0, finite(route?.distance));
  const baseSpeed = Math.max(0.1, finite(party?.speed, 1));
  const burden = clamp(finite(party?.cargoWeight) / Math.max(1, finite(party?.cargoCapacity, 1)), 0, 2);
  const fatigue = clamp(finite(party?.fatigue), 0, 100) / 200;
  return Math.ceil((distance / baseSpeed) * (1 + burden * 0.35 + fatigue));
}

export function applyAuthoritativeEvent(state, event) {
  const applied = new Set(state.appliedEventIds || []);
  if (applied.has(event.id)) return { ...state, duplicate: true };
  if (event.sequence !== finite(state.sequence) + 1) throw new Error('event_sequence_gap');
  return { ...state, sequence: event.sequence, appliedEventIds: [...applied, event.id], duplicate: false };
}
