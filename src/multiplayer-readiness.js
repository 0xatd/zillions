export function roomConnectionReadiness(game, connectedPlayers = 1) {
  const rosterPlayers = Array.isArray(game?._players) ? game._players.length : 0;
  const expectedPlayers = Math.max(1, Number(game?.players) || rosterPlayers || 1);
  const connected = Math.max(1, Number(connectedPlayers) || 1);
  const pending = Math.max(0, expectedPlayers - connected);
  return { expectedPlayers, connected, pending, ready: pending === 0 };
}

export function roomLaunchReadiness(game, connectedPlayers = 1) {
  const connection = roomConnectionReadiness(game, connectedPlayers);
  const players = Array.isArray(game?._players) ? game._players : [];
  const waiting = players.filter((player) => player.user_id !== game?.host_id && !player.ready);
  return {
    ...connection,
    readyPlayers: Math.max(1, players.length - waiting.length),
    waiting,
    ready: connection.ready && waiting.length === 0,
  };
}
