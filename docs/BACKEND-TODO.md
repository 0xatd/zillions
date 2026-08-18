# Backend / Infra TODO — for the main agent (backend owner)

Written by Lyra after the 2026-08-18 QA fix pass (PR #81, PR #83).
These are actions that need backend/database/deployment access —
they cannot land as normal code PRs.

## 1. Supabase Realtime publication (MP-4 server half) — DO THIS FIRST

The client already subscribes to `postgres_changes` on `rooms` and
`room_players`, but the prod database's `supabase_realtime` publication
apparently does not include those tables, so events never arrive and the
lobby browse list falls back to polling (now 5s after PR #83; was 15s —
QA BUG-MP-4: "took 20s to show the person who joined").

Run once against **prod** Supabase (SQL editor or migration):

```sql
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
```

If a table is already in the publication the command errors harmlessly
(`already member of publication`) — check first with:

```sql
select * from pg_publication_tables
where pubname = 'supabase_realtime';
```

Verify after: open the lobby in two browsers, create a room in one —
it should appear in the other within ~1s, not 5s.

## 2. Vercel env vars for the macro layer (PR #81)

`api/hub-dm.js` (AI DM) needs an OpenAI-compatible endpoint or it
silently falls back to the deterministic stock bartender:

- `DM_API_URL`   — e.g. `https://api.openai.com/v1/chat/completions`
- `DM_API_KEY`   — provider key
- `DM_MODEL`     — optional, defaults to `gpt-4o-mini`

`api/galaxy-state.js` needs the existing `BLOB_READ_WRITE_TOKEN`
(already set for the lobby) — no new setup.

Cheap provider note: CheapTokens keys are Venice-format
(`https://api.venice.ai/api/v1`, OpenAI-compatible) and work directly
if you want the DM on discounted credits.

## 3. Post-merge live smoke test (MP-1 confirmation)

Code-audit says host hero replication (QA BUG-MP-1) was fixed by the
spawn-desync fixes (`9e0f5c2`, `a5f0178`), but the QA report's own rule
is "untested ≠ fixed." After #83 merges and deploys:

1. Two signed-in browsers, create public room, launch 2 players.
2. Host runs around in guest's view — host hero must be visible and moving.
3. Guest walks — should feel ~solo-smooth now (local-lead from #83).
4. Lose a game on purpose — retry button must be visible without scrolling.
5. Watch the lobby list update time when the second player joins.

If step 2 fails, reopen BUG-MP-1 with the browser console + the
desync/hash banner state — that's a netcode bug, not a spawn bug now.

## 4. Known-trust items (no action yet, just awareness)

- `api/galaxy-state.js` battle results are trust-the-client until
  hardened (schema + eligibility validation only). Fine while the
  player base is "Alex and friends."
- Client-side star map does not yet render world ownership — follow-up
  PR once the macro layer is live.
