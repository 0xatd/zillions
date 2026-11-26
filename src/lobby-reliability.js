// Pure lobby rules shared by the room browser and the match recovery path.
// Nothing here reads the clock of another machine or the simulation RNG.

export const ROOM_HEARTBEAT_MS = 5000;
export const ROOM_SEAT_GRACE_MS = 25000;
export const REJOIN_GRACE_MS = 90000;
export const DESYNC_RECOVERY_LIMIT = 3;
export const DESYNC_RECOVERY_WINDOW_MS = 60000;
export const SHARE_REJOIN_UI_MS = 20000;

export function roomSetupFromRow(game) {
  const metadata = game?.metadata || {};
  const mode = metadata.mode || game?.mode || 'campaign';
  return {
    level: Math.max(1, Number(metadata.level || game?.level || 1) || 1),
    mode: mode === 'survival' || mode === 'labyrinth' ? mode : 'campaign',
    difficulty: game?.difficulty || metadata.difficulty || 'normal',
    mapName: metadata.mapName || game?.mapName || null,
    setupRevision: Number(metadata.setupRevision || game?._setupRevision || 0) || 0,
  };
}

// The listing card and the room screen both read this object.
export function publicRoomSetup(game) {
  const setup = roomSetupFromRow(game);
  return {
    level: setup.level,
    mode: setup.mode,
    difficulty: setup.difficulty,
    mapName: setup.mapName,
    setupRevision: setup.setupRevision,
  };
}

export function committedSetupPatch(game, fields = {}, revision = 1) {
  const current = roomSetupFromRow(game);
  const mode = fields.mode || current.mode;
  const metadata = {
    ...(game?.metadata || {}),
    level: Math.max(1, Number(fields.level || current.level) || 1),
    mode: mode === 'survival' || mode === 'labyrinth' ? mode : 'campaign',
    setupRevision: Number(revision) || 1,
  };
  const difficulty = fields.difficulty || current.difficulty || 'normal';
  return {
    metadata,
    difficulty,
    level: metadata.level,
    mode: metadata.mode,
    setupRevision: metadata.setupRevision,
  };
}

// A slow room read must not paint an older map over a setup the host already
// committed. The higher setupRevision wins.
export function mergeRefreshedRoom(local, remote) {
  if (!remote) return local || null;
  if (!local) return remote;
  const localRev = Number(local?.metadata?.setupRevision || local?._setupRevision || 0) || 0;
  const remoteRev = Number(remote?.metadata?.setupRevision || 0) || 0;
  if (localRev <= remoteRev) return { ...remote, _setupRevision: remoteRev };
  const metadata = {
    ...(remote.metadata || {}),
    ...(local.metadata || {}),
    level: local.level,
    mode: local.mode,
    setupRevision: localRev,
  };
  return {
    ...remote,
    metadata,
    level: local.level,
    mode: local.mode,
    difficulty: local.difficulty,
    mapName: metadata.mapName || remote.mapName || null,
    _setupRevision: localRev,
  };
}

// Remember when THIS client observed a seat row change. The mark is the
// server's updated_at when the database has one. Staleness is then measured
// on the host clock from that observation, never from the guest's last_seen_at.
export function noteSeatReceipts(previous, players, now) {
  const next = { ...(previous || {}) };
  const at = Number(now) || 0;
  for (const player of players || []) {
    if (!player?.user_id) continue;
    const mark = String(player.updated_at || player.last_seen_at || player.joined_at || '');
    const prior = next[player.user_id];
    if (!prior || prior.mark !== mark) next[player.user_id] = { mark, at };
  }
  return next;
}

export function staleOpenSeatIds(players, {
  hostId, now, graceMs = ROOM_SEAT_GRACE_MS, inGame = false, connectedIds = [], receipts = null,
} = {}) {
  if (inGame) return [];
  const cutoff = Number(now) - graceMs;
  const connected = new Set(connectedIds || []);
  return (players || [])
    .filter((player) => player && player.user_id && player.user_id !== hostId)
    .filter((player) => {
      if (connected.has(player.user_id)) return false;
      const receipt = receipts ? receipts[player.user_id] : null;
      if (!receipt) return false;
      return Number(receipt.at) < cutoff;
    })
    .map((player) => player.user_id);
}

// What a disconnected share-link guest should do on the next heartbeat.
// `retry` means send another join. The caller repeats that until the data
// channel is open or the grace period ends.
export function shareRejoinStep({ open = false, inMatch = false, lostAt = 0, now = 0, hostAlive = true, armed = false } = {}) {
  if (open) return 'stop';
  if (inMatch) return withinRejoinGrace(lostAt, now) ? 'retry' : 'giveUp';
  if (!armed) return 'idle';
  return hostAlive ? 'retry' : 'hostLeft';
}

export function roomStartLabel({
  compatible = true,
  ready = false,
  pending = 0,
  waiting = [],
  connectionNames = '',
  expectedPlayers = 1,
  blockers = [],
} = {}) {
  if (!compatible) {
    const names = (blockers || []).map((player) => player.name || 'a player').join(', ');
    return `LOCKED — ${names || 'A PLAYER'} HAS NOT UNLOCKED THIS MISSION`;
  }
  if (ready) {
    const count = Math.max(1, Number(expectedPlayers) || 1);
    return `▶  START ROOM — LAUNCH ${count} PLAYER${count === 1 ? '' : 'S'}`;
  }
  if (pending) return `WAITING FOR ${connectionNames || 'A PLAYER'} TO CONNECT`;
  const names = (waiting || []).map((player) => player.display_name || player.name || 'A player').join(', ');
  return `WAITING FOR ${names || 'A PLAYER'} TO READY`;
}

export function desyncRecovery({
  attempts = [],
  now = 0,
  limit = DESYNC_RECOVERY_LIMIT,
  windowMs = DESYNC_RECOVERY_WINDOW_MS,
} = {}) {
  const recent = (attempts || []).filter((stamp) => Number(now) - Number(stamp) < windowMs);
  const repeated = recent.length >= limit;
  // A real hash mismatch restores from the host snapshot. It does not end
  // the match, even after several mismatches in the same minute.
  return { action: 'resync', repeated, attempts: [...recent, Number(now) || 0] };
}

// What a share-link guest should see while they have no sim yet.
// A reload of a match that was already running must say Rejoining, including
// when the first lobby snapshot is the stale pre-start copy. Waiting is only
// for a fresh lobby that has not started. After the limit, stop spinning.
export function shareGuestView({
  started = false,
  starting = false,
  inGame = false,
  rejoinIntent = false,
  lobbyFresh = false,
  endedReason = '',
  waitingMs = 0,
  limitMs = SHARE_REJOIN_UI_MS,
} = {}) {
  if (inGame) return { screen: 'match', button: '', status: '' };
  if (endedReason === 'host_reloaded' || (rejoinIntent && lobbyFresh && !started && !starting)) {
    return {
      screen: 'lobby',
      button: '⏳  WAITING FOR HOST TO START',
      status: 'The host is back in the lobby. Ready up, then wait for the start.',
    };
  }
  const rejoining = !!started || (!!rejoinIntent && !lobbyFresh);
  if (rejoining && Number(waitingMs) >= limitMs) {
    return {
      screen: 'retry',
      button: 'REJOIN FAILED — RETRY',
      status: 'Could not rejoin the match. Retry, or stay in the lobby until the host starts again.',
    };
  }
  if (rejoining) return { screen: 'rejoining', button: '⏳  REJOINING…', status: 'Rejoining the match…' };
  if (starting) return { screen: 'starting', button: '⏳  STARTING… WAITING FOR PLAYERS', status: 'Starting… waiting for players' };
  return { screen: 'waiting', button: '⏳  WAITING FOR HOST TO START', status: 'Waiting for the host to start.' };
}

export function withinRejoinGrace(since, now, graceMs = REJOIN_GRACE_MS) {
  if (!since) return true;
  return Number(now) - Number(since) <= graceMs;
}
