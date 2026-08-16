// A guest can receive lockstep windows before or while the asynchronous game
// startup loads assets. Preserve that same inbox across startup; replacing it
// loses window zero and leaves the guest waiting forever.
export function inboxForMatchStart(role, currentInbox) {
  return role === 'guest' && currentInbox instanceof Map ? currentInbox : new Map();
}
