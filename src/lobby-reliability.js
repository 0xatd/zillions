// Pure lobby rules shared by the room browser and the match recovery path.
// Nothing here reads the clock of another machine or the simulation RNG.

export const ROOM_HEARTBEAT_MS = 5000;
export const ROOM_SEAT_GRACE_MS = 25000;
export const REJOIN_GRACE_MS = 90000;
export const DESYNC_RECOVERY_LIMIT = 3;
export const DESYNC_RECOVERY_WINDOW_MS = 60000;

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

export function staleOpenSeatIds(players, { hostId, now, graceMs = ROOM_SEAT_GRACE_MS, inGame = false } = {}) {
  if (inGame) return [];
  const cutoff = Number(now) - graceMs;
  return (players || [])
    .filter((player) => player && player.user_id && player.user_id !== hostId)
    .filter((player) => {
      const seen = Date.parse(player.last_seen_at || player.joined_at || '') || 0;
      return seen < cutoff;
    })
    .map((player) => player.user_id);
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
  if (recent.length >= limit) return { action: 'terminal', attempts: recent };
  return { action: 'resync', attempts: [...recent, Number(now) || 0] };
}

export function withinRejoinGrace(since, now, graceMs = REJOIN_GRACE_MS) {
  if (!since) return true;
  return Number(now) - Number(since) <= graceMs;
}
