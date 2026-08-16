export function consecutiveWindowCount(inbox, startWindow, limit = 32) {
  let count = 0;
  while (count < limit && inbox.has(startWindow + count)) count++;
  return count;
}

export function hasConsecutiveWindowBuffer(inbox, startWindow, required) {
  return consecutiveWindowCount(inbox, startWindow, required) >= required;
}
