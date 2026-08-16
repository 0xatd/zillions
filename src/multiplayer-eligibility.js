export function highestUnlockedLevel(campaignCleared = 0) {
  return Math.max(1, Math.floor(Number(campaignCleared) || 0) + 1);
}

export function roomLevelEligibility(game) {
  const level = Math.max(1, Math.floor(Number(game?.level) || 1));
  if ((game?.mode || 'campaign') !== 'campaign') {
    return { eligible: true, level, blockers: [] };
  }
  const blockers = (game?._players || [])
    .filter((player) => Math.max(1, Number(player.unlocked_level) || 1) < level)
    .map((player) => ({
      userId: player.user_id,
      name: player.display_name || 'Commander',
      unlockedLevel: Math.max(1, Number(player.unlocked_level) || 1),
    }));
  return { eligible: blockers.length === 0, level, blockers };
}
