// Chat safeguards shared by every channel. Party chat is wired. A game-wide
// channel is named here so it can be added later; nothing in the client
// inserts or subscribes to it.

export const CHAT_MAX_LENGTH = 160;
export const CHAT_RATE_LIMIT = 4;
export const CHAT_RATE_WINDOW_MS = 10_000;

// Kept in sync with public.mask_profanity() in supabase/schema.sql.
export const PROFANITY = Object.freeze([
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'retard',
]);

export const CHAT_CHANNELS = Object.freeze({
  party: { id: 'party', scope: 'party', maxLength: CHAT_MAX_LENGTH, wired: true },
  global: { id: 'global', scope: 'global', maxLength: CHAT_MAX_LENGTH, wired: false },
});

export function maskProfanity(text) {
  let out = String(text || '');
  for (const word of PROFANITY) {
    const pattern = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(pattern, '*'.repeat(word.length));
  }
  return out;
}

// recent: timestamps of this sender's accepted messages.
// muted / blocked are the viewer's relationships to the sender, applied
// before a line is shown. The server repeats the length, rate, and mask.
export function prepareChat(text, {
  channel = 'party',
  now = Date.now(),
  recent = [],
  muted = false,
  blocked = false,
} = {}) {
  const spec = CHAT_CHANNELS[channel];
  if (!spec || !spec.wired) return { ok: false, error: 'channel_unavailable' };
  if (blocked) return { ok: false, error: 'blocked' };
  if (muted) return { ok: false, error: 'muted' };
  let clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, error: 'empty' };
  if (clean.length > spec.maxLength) clean = clean.slice(0, spec.maxLength);
  clean = maskProfanity(clean);
  const sent = recent.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
  if (sent.length >= CHAT_RATE_LIMIT) return { ok: false, error: 'rate' };
  return { ok: true, text: clean, recent: [...sent, now] };
}
