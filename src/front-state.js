// Pure battlefield-select rules. No renderer, so the menu check can import it.

export function battlefieldPressure(mult) {
  const m = Number(mult) || 1;
  if (m < 0.9) return 'Gentle';
  if (m < 1.15) return 'Measured';
  if (m < 1.45) return 'Hard';
  if (m < 1.85) return 'Severe';
  return 'Final';
}

// The five Earth fronts, grouped by biome. Placeholder names are future
// sites: they are shown on the globe and are never playable.
export const STAR_SYSTEM = [
  {
    id: 'verdant',
    name: 'Verdant',
    sites: [
      { levelId: 1 },
      { levelId: 4 },
      { name: 'Ashen Reach' },
      { name: 'Grey Shelf' },
    ],
  },
  {
    id: 'mire',
    name: 'Mire',
    sites: [
      { levelId: 2 },
      { name: 'Drowned Verge' },
      { name: 'Bog Crossing' },
    ],
  },
  {
    id: 'cinder',
    name: 'Cinder',
    sites: [
      { levelId: 3 },
      { levelId: 5 },
      { name: 'Ash Barrens' },
      { name: 'Rift Shelf' },
    ],
  },
];

export function planetForLevel(levelId) {
  return STAR_SYSTEM.find((planet) => planet.sites.some((site) => site.levelId === (levelId | 0))) || null;
}

// locked until the previous front is won, completed once it has been cleared.
export function frontState(levelId, cleared = 0, clearedIds = null) {
  const id = levelId | 0;
  const won = Math.max(0, cleared | 0);
  if (id > won + 1) return 'locked';
  if ((clearedIds && clearedIds[id]) || (won > 0 && id <= won)) return 'completed';
  return 'open';
}
