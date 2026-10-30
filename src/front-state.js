// Pure battlefield-select rules. No renderer, so the menu check can import it.

export function battlefieldPressure(mult) {
  const m = Number(mult) || 1;
  if (m < 0.9) return 'Gentle';
  if (m < 1.15) return 'Measured';
  if (m < 1.45) return 'Hard';
  if (m < 1.85) return 'Severe';
  return 'Final';
}

// locked until the previous front is won, completed once it has been cleared.
export function frontState(levelId, cleared = 0, clearedIds = null) {
  const id = levelId | 0;
  const won = Math.max(0, cleared | 0);
  if (id > won + 1) return 'locked';
  if ((clearedIds && clearedIds[id]) || (won > 0 && id <= won)) return 'completed';
  return 'open';
}
