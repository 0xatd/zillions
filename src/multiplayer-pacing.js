export function consecutiveWindowCount(inbox, startWindow, limit = 32) {
  let count = 0;
  while (count < limit && inbox.has(startWindow + count)) count++;
  return count;
}

export function hasConsecutiveWindowBuffer(inbox, startWindow, required) {
  return consecutiveWindowCount(inbox, startWindow, required) >= required;
}

// Hold enough complete lockstep windows to cover the measured peer route.
// Half the RTT approximates one-way delivery; jitter gets a wider safety
// margin because a single late reliable packet stops strict lockstep.
export function adaptiveWindowTarget(rttMs = 0, jitterMs = 0, windowMs = 1000 / 15) {
  const routeBudget = Math.max(0, rttMs / 2) + Math.max(0, jitterMs) * 3;
  return Math.max(3, Math.min(10, Math.ceil(routeBudget / windowMs) + 2));
}

export function rememberWindow(history, window, commands, limit = 64) {
  history.set(window, commands);
  while (history.size > limit) history.delete(history.keys().next().value);
  return history;
}

// What a guest does while one lockstep window is missing.
// Re-request once after a couple of seconds, and ask for a host snapshot at
// the same time. If that still has not moved the sim, force another snapshot
// and say so. Callers rate-limit the actual sends.
export function stallRecovery(ageMs, retried) {
  const age = Number(ageMs) || 0;
  // A missing window has to be repaired inside a click, not after the guest
  // has sat on "Syncing co-op…" for most of a minute.
  if (age >= 8000) return 'resync';
  if (age >= 300 && !retried) return 'retry-snapshot';
  if (age >= 300 && retried) return 'snapshot';
  return 'wait';
}

// Windows the host is ahead of the guest's last ack. No ack yet is not lag:
// a hash every couple of seconds is too stale to steer the host clock.
export function guestLagWindows(hostWindow, reportedWindow) {
  const reported = Math.floor(Number(reportedWindow) || 0);
  if (reported <= 0) return 0;
  const host = Math.floor(Number(hostWindow) || 0);
  return Math.max(0, host - reported);
}

// Give a guest that is actually behind a short, bounded slowdown so it can
// catch up. Then run at full speed. Sitting at the floor until the guest
// recovers is what froze the siege for everyone.
export function hostPaceScale({
  lagWindows = 0,
  reportFresh = false,
  easeAgeMs = 0,
  easeForMs = 3000,
  lagToEase = 10,
  floor = 0.7,
} = {}) {
  const lag = Math.max(0, Number(lagWindows) || 0);
  const age = Math.max(0, Number(easeAgeMs) || 0);
  const limit = Math.max(0, Number(easeForMs) || 0);
  const trigger = Math.max(0, Number(lagToEase) || 0);
  if (!reportFresh || lag <= trigger || age >= limit) return { scale: 1, easing: false };
  const scale = Math.min(1, Math.max(0.7, Number(floor) || 0.7));
  return { scale, easing: true };
}
