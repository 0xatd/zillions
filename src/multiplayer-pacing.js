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
  if (age >= 10000) return 'resync';
  if (age >= 1500 && !retried) return 'retry-snapshot';
  if (age >= 1500 && retried) return 'snapshot';
  return 'wait';
}
