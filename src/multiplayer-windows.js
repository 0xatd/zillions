// A guest can receive lockstep windows before or while the asynchronous game
// startup loads assets. Preserve that same inbox across startup; replacing it
// loses window zero and leaves the guest waiting forever.
export function inboxForMatchStart(role, currentInbox) {
  return role === 'guest' && currentInbox instanceof Map ? currentInbox : new Map();
}

// A host must not emit lockstep window zero until every connected guest has
// finished the asynchronous map/asset build. Buffering early windows softens
// the race but cannot remove it; an explicit ready barrier does.
export function matchStartReady(expectedGuests, readyGuests) {
  return Math.max(0, Number(readyGuests) || 0) >= Math.max(0, Number(expectedGuests) || 0);
}
