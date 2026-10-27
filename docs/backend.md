# Backend Handoff

This document explains the public backend shape for future agents. Do not add
secrets, tokens, private keys, service-role keys, or raw environment values to
this file.

## Current Stack

- Production URL: `https://zillions.taborlin.co`
- Web host: Vercel project `zillions`
- Static fallback: GitHub Pages at `https://0xatd.github.io/zillions/`
- Account backend: Supabase project `zillions`, ref `skqggyvkblqtyggtcxbc`
- Legacy/cloud mirror: Vercel Blob through same-origin Vercel API routes
- Match networking: browser WebRTC DataChannels, host-sequenced lockstep

Production is account-first. On `zillions.taborlin.co`, the game shell requires
Google or passwordless email sign-in through Supabase. Static local play can
remain for development and offline smoke tests. Do not present static play as
a production profile.
After Google sign-in, players claim a public username for the email-backed
account. Public profile, lobby, chat, room, and invite surfaces use that
username. They must not show the email address or a Google account name.

## Backend Boundaries

### Vercel

Vercel serves the game and same-origin API routes:

- `api/state.js` stores and reads authenticated JSON state in private Vercel Blob storage.
- `api/lobby.js` stores legacy short-lived lobby presence/chat in Vercel Blob
  for compatibility only.
- `api/auth-config.js` exposes only browser-safe Supabase config.
- `api/economy.js` authenticates the player, validates item and vendor inputs,
  and calls the atomic Supabase economy function. The service key stays on the server.
- `api/match-result.js` is the only route that grants signed-in XP, levels,
  loot, Alloy, and stats. See "Server-Authoritative Match Results" below.

There are no Vercel crons. Environment variables are listed in `.env.example`.

Do not put server-only secrets in responses. The Supabase anon key is browser
configuration, but service-role keys and Blob tokens must stay in Vercel env.

### Supabase

Supabase owns the real account backend:

- Google/Auth identity.
- Player profiles.
- Lifetime stats.
- Cloud save slots.
- Private match history.
- Public/private room records, room players, ready state, hero picks, global
  lobby chat, room chat, in-game team chat, friendships, and invites.
- Server-owned characters, item instances, wallets, and match reports.

The living world (galaxy topology, planets, regions, factions, parties,
encounters, companies, markets, worker leases) was removed from the game.
`supabase/migrations/20261027000000_drop_living_world_DESTRUCTIVE.sql` drops
its tables and functions. Review it, back up, and apply it by hand; it is not
reversible. The historical living-world migrations stay in the folder so the
migration chain still replays.

The active gameplay rules identifier is `survival-plots`. Do not introduce
branch, agent, or prototype names into persisted room or match records.

The schema source of truth is `supabase/schema.sql`. It enables RLS and defines
all account, save, match, and room tables. Do not point Zillions at Soshi,
Weather.fun, or any other product's Supabase project.

### localStorage

localStorage remains the development/offline fallback:

- Random browser `playerId`.
- Guest commander profile.
- Settings.
- Latest solo/host save.

When backend support is available, the browser syncs signed-in account state to
Supabase. Vercel Blob is still used for compatibility state and legacy/static
smoke paths, but signed-in social state must not depend on it.

### WebRTC

Actual co-op gameplay is still peer-to-peer. The host sequences commands and
broadcasts them to peers. The backend does not run the simulation, validate
combat, or prevent cheating. Treat ranked/authoritative multiplayer as a
separate future project.

## Current Data Model

### Vercel Blob State Mirror

`/api/state` accepts `profile`, `settings`, `save`, and `game`.
The route requires a Supabase access token. The token user must own the
`playerId`. The route rejects anonymous requests and mismatched player IDs.

Blob paths use this shape:

```text
players/<playerId>/profile/current.json
players/<playerId>/settings/current.json
players/<playerId>/save/latest.json
players/<playerId>/game/<id>.json
```

This is compatibility storage for signed-in account mirrors and smoke tests.
Blob objects use private access. Supabase remains the account source of truth.

### Vercel Blob Legacy Lobby

`/api/lobby` accepts `join`, `heartbeat`, `chat`, and `leave`.

Blob paths use this shape:

```text
lobbies/<mode>/players/<playerId>.json
lobbies/<mode>/chat/<timestamp>-<playerId>-<random>.json
```

Presence expires after about 60 seconds. Heartbeats run from the browser. This
route is legacy compatibility for smoke tests and old static clients. It is not
the production social identity path.

### Supabase Tables

Defined in `supabase/schema.sql`:

- `profiles`: one row per authenticated player. Stores the public username in
  `handle`, mirrors it in `display_name`, tracks `username_set`, selected hero,
  avatar color, timestamps, and last seen time.
- Supabase Auth user metadata stores the character roster's appearance, Lattice,
  and the selected character. It is client-writable, so the server never reads
  rewards from it (it was read once, by the progress migration's backfill).
- `player_stats`: lifetime games, wins, losses, kills, best day/wave,
  buildings built, favorite hero, campaign progress, best survival, relics,
  completed quests, and labyrinth clears. Server-written only.
- `save_slots`: authenticated cloud save slots. Current UI uses `slot_key =
  'latest'`.
- `match_history`: completed run summaries. Records are private by default,
  with optional public visibility for future leaderboards. Server-written only.
- `match_reports`: one row per accepted match report (`unique(user_id,
  request_id)`, and one per user per co-op room). Stores the response so a
  replay returns it. Server-written only.
- `rooms`: live multiplayer room browser records and host game setup.
- `room_players`: live room seats, usernames, hero picks, connection state, and
  highest unlocked campaign level.
- `lobby_chat`: global signed-in lobby chat.
- `friendships`: friend requests and accepted friend pairs.
- `room_chat`: room-scoped chat and in-game team chat. `channel = 'room'`
  means setup/staging chat. `channel = 'game'` means live match team chat.

RLS policy intent:

- Authenticated users can read public lobby/profile surfaces.
- Users can create/update their own profile and saves.
- Users can read, but not write, their own stats, match history, characters,
  items, and wallet. The `player_stats_insert_self`, `player_stats_update_self`,
  and `match_history_insert_self` policies were dropped and table write grants
  revoked from `anon` and `authenticated`.
- Room hosts control their own rooms.
- Authenticated users can read and write global lobby chat as themselves.
- Users can read, create, accept, and remove their own friendship rows.
- Room members can read and post room chat.

## Runtime Flows

### Static Development Play

1. Browser creates or loads `zillions_player_id` in localStorage.
2. Static builds can run without Supabase for local development.
3. Profile, settings, and latest save stay local.
4. This is not the production identity model.

### Account Profile

1. Browser checks `/api/auth-config`.
2. If Supabase config is enabled, `src/auth.js` loads `@supabase/supabase-js`
   from ESM.
3. The account modal starts Google OAuth or sends a passwordless email link.
4. Supabase Auth returns to `https://zillions.taborlin.co/`.
5. The browser creates a private fallback handle if the profile is missing.
6. If `username_set` is false, the account gate asks the player to claim a
   username before the game shell opens.
7. Signed-in play syncs the selected hero, character roster metadata, and
   latest save to Supabase. Stats, match history, levels, loot, and Alloy are
   written only by `api/match-result.js`.

### Multiplayer Today

1. Signed-in players join the Zillions lobby.
2. Supabase profiles provide fresh signed-in presence.
3. Supabase `lobby_chat` provides global lobby chat.
4. Supabase `friendships` provides friend requests, accepted friends, and
   friend room invites.
5. Supabase `rooms`, `room_players`, and `room_chat` provide public/private
   rooms, visible rosters, host setup, and room chat.
6. The lobby separates open rooms from active games.
7. A player can Join an open room, Rejoin a prior seat, or Watch an active game.
8. Campaign rooms block maps that any seated player has not unlocked.
9. Host co-op uses WebRTC signaling and host-sequenced lockstep.
10. The host waits for each guest to connect and load before window 0 starts.
11. In-game team chat writes to `room_chat` with `channel = 'game'`.
12. The match simulation is peer-to-peer. Watch mode is read-only.

## Agent Rules

- Keep `zillions.taborlin.co` as the canonical production URL.
- Keep static/local development fallback working.
- Keep production account-gated.
- Never commit env values, service-role keys, Blob tokens, Google client
  secrets, private keys, or raw credentials.
- Do not copy backend config from other Taborlin products.
- Update `supabase/schema.sql` and this doc together when the backend model
  changes.
- Update `README.md` when player-facing backend behavior changes.
- Run `npm run check` and `git diff --check` before calling backend changes
  done.
- For live backend changes, smoke test sign-in, a signed-in match end, and the
  Market when relevant.
- Never add a client write path for stats, match history, character progress,
  items, or wallets.

## Authoritative Economy

Signed-in characters, item instances, equipment, and Salvage Alloy are
server-owned. `game_characters` owns character identity and its optimistic
revision. `player_wallets` owns the non-negative account balance.
`item_instances` gives every copy a stable UUID, immutable legacy item key,
roll data, location, revision, and provenance.

`economy_mutate` commits the request, currency, item, character revision, and
audit event in one transaction. Request IDs are unique per actor, so a replay
returns the first result. The function rejects stale revisions, insufficient
funds, full stashes, and items owned by another player. RLS permits players to
read their own rows. Only the server service role can mutate them.

The API derives the current UTC vendor rotation and the authoritative character
level. A browser cannot seed-search another stock date. Sold items become
hidden tombstones instead of being deleted. The audit output keeps their full
pre-sale key, base, affixes, sockets, price, and revision data. The request
shape leaves room for a future server-defined `vendor_id` and stock version.

The first signed-in request registers character identity only. It starts the
authoritative character at level 1 (characters that existed before the progress
migration were backfilled once from their old metadata level) with a one-time account grant of 500 Alloy and no items. Browser-owned
legacy currency and item keys stay in an offline, read-only archive marked
`pending_audited_migration`. They never enter authoritative tables without a
future server-derived snapshot or one-time server-issued migration ticket.
Static local play cannot change authoritative state.

## Server-Authoritative Match Results

`api/match-result.js` accepts `{ requestId, characterId, roomId?, report }`
with the player's Supabase bearer token.

1. The token is verified against Supabase Auth. The user id comes from the
   token, never from the body.
2. A known `requestId` returns the stored response (idempotent replay).
3. `validateMatchReport()` (`src/match-rewards.js`) rejects unknown versions,
   modes, difficulties, locked campaign levels, and any counter outside bounds
   derived from the match duration and the map (kills, coins, nests, nodes,
   Threat, boss time, pack size).
4. Every looted item key is re-derived from the level's map seed and must match
   the item level for the reported difficulty. Authored field finds are
   allow-listed. Boss and quest items cannot be smuggled in as finds.
5. Side quests are re-evaluated from the reported counters. A client "done"
   flag is ignored.
6. A co-op report must name a room the player is seated in, the room must have
   started, and the match cannot be longer than the room has existed.
7. `computeMatchRewards()` turns the report into XP, levels, items, Alloy, and
   stat deltas.
8. `apply_match_result()` (security definer, `service_role` only) applies it in
   one transaction: advisory lock per player, duplicate check, one report per
   co-op room, 15-second rate limit, a wall-clock check (match time must fit
   since the previous report; solo time is halved for 2x speed), a
   compare-and-set on `game_characters.progress_revision`, once-per-account
   quests, once-per-character authored items, the 60-item stash cap, the
   wallet credit, `player_stats`, `match_history`, and `match_reports`.

The client keeps unconfirmed reports in `localStorage`
(`zillions_pending_matches`) and resends them with the same `requestId` on the
next sign-in, so a closed tab does not lose a match and a resend cannot double
grant.

Guest (offline) play never calls the route; its progress stays in the browser.

### Remaining trust gaps

- Combat counters are bounded client claims, not a server replay of the match.
  A modified client can still report a plausible best case.
- Manual (non-room) WebRTC co-op has no room id and is reported as solo.
- `room_players` rows are created by clients, so the participant check proves
  the reporter took a seat, not that they played; one report per room limits
  the damage.
- The guest meta tree (`src/meta.js`) is local only and does not affect
  signed-in rewards.

## Known Limits

- Room browser data, player rosters, and host setup are real Supabase data.
- Mid-game Join as a new controlling player is not supported. Use Watch.
- Vercel Blob lobby data is legacy compatibility, not production social state.
- Server-authoritative combat is not implemented. Rewards are server-granted
  but derived from bounded client reports.
- There is no anti-cheat beyond the report bounds and loot proofs.
- Cross-device identity depends on Google sign-in. Guest identity is per
  browser/localStorage.
