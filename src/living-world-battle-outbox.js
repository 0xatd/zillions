export const LIVING_WORLD_BATTLE_OUTBOX_KEY = 'zillions-living-world-battle-outbox';

export function persistBattleOutbox(storage, entry) {
  if (!entry?.assignmentToken || !entry?.replay) throw new Error('invalid_battle_outbox_entry');
  storage.setItem(LIVING_WORLD_BATTLE_OUTBOX_KEY, JSON.stringify(entry));
  return entry;
}

export function loadBattleOutbox(storage) {
  const raw = storage.getItem(LIVING_WORLD_BATTLE_OUTBOX_KEY);
  if (!raw) return null;
  try { const entry = JSON.parse(raw); return entry?.assignmentToken && entry?.replay ? entry : null; }
  catch { return null; }
}

export async function deliverBattleOutbox({ storage, send, entry }) {
  if (entry) persistBattleOutbox(storage, entry);
  const pending = entry || loadBattleOutbox(storage);
  if (!pending) return { status: 'empty' };
  try {
    const response = await send({ action: 'result', assignmentToken: pending.assignmentToken, replay: pending.replay });
    storage.removeItem(LIVING_WORLD_BATTLE_OUTBOX_KEY);
    return { status: response?.duplicate ? 'duplicate' : 'committed', response };
  } catch (error) {
    const code = error?.message || 'battle_result_rejected';
    return { status: ['battle_result_replay_conflict', 'battle_assignment_expired', 'battle_assignment_not_active'].includes(code) ? 'requires_resolution' : 'retry', error };
  }
}
