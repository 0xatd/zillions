// Hub AI DM endpoint — the translator and the theater, never the referee.
//
// Pattern (docs/macro-layer.md, V0):
//   player freeform text -> LLM interprets + roleplays
//     -> structured action request -> server validates -> state unchanged here
//     -> AI narrates the result
//
// V0 action vocabulary (closed set): repair, trade, take_contract,
// launch_exploration. The DM sees galaxy context (read-only) and can request
// actions; this route validates and executes them against the same logic
// api/galaxy-state.js exposes. Unknown or malformed actions are refused with
// in-character narration.
//
// LLM provider: Anthropic-compatible or OpenAI-compatible endpoint via env
// (DM_API_URL / DM_API_KEY / DM_MODEL). If unconfigured, the route degrades
// to a deterministic stock bartender so the hub still works offline.

import { GALAXY_SEED, knownGalaxy } from '../src/galaxy.js';
import { makeRNG } from '../src/utils.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MAX_MESSAGE = 500;
const MAX_HISTORY = 12;
const DM_TIMEOUT_MS = 12_000;

// The closed action vocabulary. Growing the DM later means growing this list,
// not changing the architecture.
const ACTION_KINDS = new Set(['repair', 'trade', 'take_contract', 'launch_exploration']);

const SYSTEM_PROMPT = `You are the bartender-keeper of a spaceport hub in Zillions, a science-fantasy war galaxy.
You are an in-character narrator and guide. You know the state of the war (provided below).

Rules you must follow exactly:
1. Reply in character, concise (under 120 words).
2. You may end your reply with ONE structured action request if — and only if — the player clearly asked for it. Use this exact JSON line as the LAST line of your reply:
{"action":{"kind":"<kind>","args":{}}}
Valid kinds: repair, trade, take_contract, launch_exploration. No other kinds exist. Never invent kinds.
3. If the player asks for something outside that list, refuse in character (the war, the guild, or physics says no) and offer what you CAN do.
4. Never claim to change ownership, grant items, or alter the galaxy. You only narrate.`;

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function cleanText(value, max = MAX_MESSAGE) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function parseBody(req) {
  const chunks = [];
  for (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(typeof chunks[0] === 'string'
    ? chunks.join('')
    : Buffer.concat(chunks).toString('utf8'));
}

// ---------------------------------------------------------------------------
// Galaxy context (read-only) for the prompt
// ---------------------------------------------------------------------------

const GALAXY = knownGalaxy(GALAXY_SEED);

function galaxyContext(state) {
  const worlds = state?.worlds || {};
  const free = Object.entries(worlds).filter(([, v]) => v?.owner === 'free').length;
  const hive = Object.entries(worlds).filter(([, v]) => v?.owner === 'hive').length;
  const lastEvents = (state?.events || []).slice(0, 5).map((e) => {
    if (e.kind === 'battle_result') return `battle at ${e.worldId}: ${e.outcome}`;
    if (e.kind === 'hive_claim') return `the Hive reclaimed ${e.worldId}`;
    if (e.kind === 'exploration') return `explorer ${e.playerId} probed ${e.distanceLy}ly ${e.survived ? 'and returned' : 'and was lost'}`;
    return e.kind;
  });
  return [
    `Galaxy: ${free} worlds free, ${hive} worlds Hive-held (of ${Object.keys(worlds).length || GALAXY.worlds.length}).`,
    lastEvents.length ? `Recent events: ${lastEvents.join('; ')}.` : 'No recent events.',
    'The war goes on whether the player is here or not.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Action execution — the referee stays code
// ---------------------------------------------------------------------------

// V0 actions are simple enough to validate inline. Each returns a narration
// seed (string) the DM wraps in character, plus structured data for the client.
function executeAction(action, playerId, state) {
  const kind = action?.kind;
  if (!ACTION_KINDS.has(kind)) {
    return { ok: false, narrationSeed: 'That is beyond even my considerable talents.' };
  }
  switch (kind) {
    case 'repair':
      return { ok: true, data: { repaired: true }, narrationSeed: 'The yard crews patch the hull.' };
    case 'trade': {
      const rng = makeRNG((playerId?.length || 1) * 0x9e37 + 7);
      return { ok: true, data: { priceMod: Number((0.9 + rng() * 0.2).toFixed(2)) }, narrationSeed: 'The broker quotes today\'s rates.' };
    }
    case 'take_contract':
      return { ok: true, data: { contract: 'liberate-frontier' }, narrationSeed: 'The board stamps a liberation contract.' };
    case 'launch_exploration': {
      const ly = Math.min(12, Math.max(1, Number(action.args?.distanceLy) || 3));
      return { ok: true, data: { distanceLy: ly }, narrationSeed: `A deep probe plotted ${ly} light-years out.` };
    }
    default:
      return { ok: false, narrationSeed: 'No.' };
  }
}

// ---------------------------------------------------------------------------
// LLM call (OpenAI-compatible chat completions)
// ---------------------------------------------------------------------------

async function callLLM(messages) {
  const url = process.env.DM_API_URL;
  const key = process.env.DM_API_KEY;
  const model = process.env.DM_MODEL || 'gpt-4o-mini';
  if (!url || !key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: 300, temperature: 0.8 }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Deterministic fallback bartender so the hub never hard-fails.
function stockReply(message, context) {
  const rng = makeRNG(message.length * 0x9e3779b1);
  const lines = [
    `${context}`,
    'The glass gets a wipe. "Talk. The war waits for no one."',
    'Repair, trade, contracts, or a deep probe — those I can do. The rest is between you and the Hive.',
  ];
  return lines[Math.floor(rng() * lines.length)];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  try {
    const body = await parseBody(req);
    const message = cleanText(body.message);
    const playerId = cleanText(body.playerId, 32);
    const hubId = cleanText(body.hubId, 64) || 'earth';
    const history = Array.isArray(body.history)
      ? body.history.slice(-MAX_HISTORY).map((h) => ({
        role: h?.role === 'player' ? 'user' : 'assistant',
        content: cleanText(h?.text, 300) || '',
        })).filter((h) => h.content)
      : [];
    if (!message) return send(res, 400, { ok: false, error: 'empty_message' });

    // Read-only galaxy context: fetch current macro state if reachable.
    let state = null;
    try {
      const origin = `https://${req.headers.host || 'zillions.local'}`;
      const response = await fetch(`${origin}/api/galaxy-state`, { cache: 'no-store' });
      if (response.ok) state = (await response.json()) || null;
    } catch { /* hub works without live state */ }
    const context = galaxyContext(state);

    const messages = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nHUB: ${hubId}\nPLAYER: ${playerId}\n\nWAR STATE (read-only):\n${context}` },
      ...history,
      { role: 'user', content: message },
    ];

    const reply = (await callLLM(messages)) || stockReply(message, context);

    // Extract a trailing action request, validate, execute, strip the JSON line.
    let action = null;
    let narration = reply;
    const match = reply.match(/\{[\s\S]*"action"[\s\S]*\}\s*$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        narration = reply.slice(0, match.index).trim();
        const result = executeAction(parsed.action, playerId, state);
        if (result.ok) {
          action = { kind: parsed.action.kind, result: result.data };
          narration = `${narration} ${result.narrationSeed}`.trim();
        } else {
          action = { kind: 'refused', reason: 'invalid_action' };
          narration = `${narration} ${result.narrationSeed}`.trim();
        }
      } catch {
        narration = reply; // malformed JSON line: treat whole reply as prose
      }
    }

    return send(res, 200, { ok: true, hubId, narration, action, backend: process.env.DM_API_URL ? 'llm' : 'stock' });
  } catch (error) {
    return send(res, 500, { ok: false, error: error?.message || 'dm_error' });
  }
}
