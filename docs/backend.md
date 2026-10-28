# Backend Handoff

This document explains the public backend shape for future agents. Do not add
secrets, tokens, private keys, service-role keys, or raw environment values to
this file.

## Current Stack

- Production URL: `https://zillions.taborlin.co`
- Web host: Vercel project `zillions`
- Static fallback: GitHub Pages at `https://0xatd.github.io/zillions/`
- Account backend: Supabase project `zillions`, ref `skqggyvkblqtyggtcxbc`
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

- `api/auth-config.js` exposes only browser-safe Supabase config.
- `api/economy.js` authenticates the player, validates item and vendor inputs,
  and calls the atomic Supabase economy function. The service key stays on the server.
- `api/match-result.js` is the only route that grants signed-in XP, levels,
  loot, Alloy, and stats. See "Server-Authoritative Match Results" below.

There are no Vercel crons. Environment variables are listed in `.env.example`.

Do not put server-only secrets in responses. The Supabase anon key is browser
configuration, but service-role keys and ticket secrets must stay in Vercel env.

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
Supabase. Vercel Blob is no longer used.

### WebRTC

Actual co-op gameplay is still peer-to-peer. The host sequences commands and
broadcasts them to peers. The backend does not run the simulation, validate
combat, or prevent cheating. Treat ranked/authoritative multiplayer as a
separate future project.

## Current Data Model

### Removed Vercel Blob Routes

The legacy `/api/state` and `/api/lobby` Vercel Blob routes were removed: the
client had stopped calling them (saves, rooms, chat and presence all use
Supabase). Blob objects they wrote earlier are not deleted by this change; the
`BLOB_READ_WRITE_TOKEN` environment variable is no longer read.

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
- Never commit env values, service-role keys, ticket secrets, Google client
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

## Match Tickets

A signed-in match starts with `POST /api/match-start`
(`{ levelId, mode, difficulty, roomId?, joinToken?, manualCoop? }`, bearer
token). The server:

1. Verifies the token and the level, mode and difficulty.
2. For an invite-code (manual WebRTC) host, `manualCoop: true` creates a
   private `rooms` row (`create_manual_coop_room()`, `metadata.manual`) and
   returns a `joinToken` (HMAC of the room id). The host passes
   `{ seed, roomId, joinToken }` to guests in the `start` message; each guest
   then calls match-start with `roomId + joinToken` and is seated
   (`seat_manual_coop_player()`). Lobby rooms use their existing seats.
3. `issue_match_ticket()` records a single-use row in `match_tickets`
   (user, level, mode, difficulty, seed, room, perk stack, issue time; 6 per minute).
   Campaign perks have to be a legal chain no longer than `campaign_cleared`.
   A room reuses its unused ticket only when the perk stack matches.
4. The response carries an HMAC-SHA256 ticket signed with
   `MATCH_TICKET_SECRET`: `base64url(payload).base64url(sig)`, valid 48 hours.
   The payload includes `perks`. The report has to repeat that list.

The match seed comes from the ticket. Solo seeds are random per ticket; room
seeds are HMAC(roomId) so every peer runs the same simulation. The client
passes it to `new Game(..., { rngSeed })`.

## Server-Authoritative Match Results

`api/match-result.js` accepts
`{ requestId, characterId, ticket, report, replay? }` with the player's bearer
token. `roomId` is taken from the ticket, never from the body.

1. The token is verified against Supabase Auth. The user id comes from the
   token, never from the body.
2. A known `requestId` returns the stored response (idempotent replay).
3. The ticket signature, expiry, user, level, mode and difficulty are checked.
   Missing or bad tickets get `401/403/409` (`missing_ticket`,
   `invalid_ticket`, `ticket_expired`, `ticket_mismatch`).
4. `validateMatchReport()` (`src/match-rewards.js`) rejects unknown versions,
   modes, difficulties, locked campaign levels, and any counter outside bounds
   derived from the match duration and the map. The Threat ceiling follows
   every Threat source in `Game._updateSiege()`: the base clock plus per-hive
   pressure (up to three live hives) times the difficulty multiplier, plus
   the one-off bumps for each node capture and each razed hive.
5. The reported duration must fit the server clock since the ticket was
   issued (x2 for solo speed, x1 for co-op, plus 120 s slack).
6. **No replay on the reward path.** Like Thronefall, Slay the Spire and
   most small indie games, rewards are granted on the cheap checks in this
   list (signed ticket, plausibility bounds, server clock, loot table), not on
   a server re-simulation. `reviewReasons()` (`src/match-replay.js`) only
   decides what to keep for a future leaderboard:
   - A leaderboard candidate (personal best for that level and mode, first
     clear, survival best) or a suspicious run (kills/coins/buildings above
     half the bound, a duration faster than 1.5x the server clock, a boss
     kill in the first 10% of the match) keeps its input log in
     `match_reports.replay_log` (`replay_status = 'unverified'`), with the
     reporter's camp rebuilt from server data (level, stash/equipped items,
     relics; Lattice capped by level) baked in.
   - Suspicious runs are also `flagged`. Other runs store no log
     (`replay_status = 'none'`).
   - A missing or malformed log never blocks a payout; the run just can't be
     verified later (`review_reasons` gets `invalid_log`).
   - `verifyReplay()` re-runs a stored log and compares it field by field.
     Nothing calls it per match; see `docs/leaderboards.md`.
7. Rolled loot keys must be keys this match actually scattered: the server
   rebuilds the match setup from the ticket's level, mode, difficulty and
   seed (`src/loot-table.js`) and checks the complete key (base, affix seed,
   item level, rarity). Quests are re-evaluated.
8. `computeMatchRewards()` turns the report into XP, levels, items, Alloy, and
   stat deltas.
9. `apply_match_result()` (security definer, `service_role` only) re-checks
   and spends the ticket, re-checks the server-clock duration, and applies the
   result in one transaction (advisory lock, duplicate check, one report per
   ticket and per co-op room, rate limit (15 s between reports; match length
   is checked against the ticket's issue time, never against when the
   previous report arrived, so late outbox reports are accepted), CAS on
   `progress_revision`, quest and
   item dedupe, stash cap, wallet credit, stats, history, review columns).
   A manual co-op room is marked finished.

The client keeps unconfirmed reports in `localStorage`
(`zillions_pending_matches`) and resends them with the same `requestId` on the
next sign-in, so a closed tab does not lose a match and a resend cannot double
grant. Every entry records the user id that played it; only the signed-in
account's own reports are resent or dropped, so two accounts sharing a
browser never send each other's reports. Network errors, 5xx, 429, `stale_progress` and `request_in_progress` keep
the report queued; other refusals drop it. If the outbox hits the storage
quota, the input log is dropped first.

Guest (offline) play never calls either route; its progress stays in the
browser.

### What the server does and does not prove

- Proven: the ticket (user, mission, seed, single use, expiry), the match
  length against the server clock, campaign unlocks, every rolled loot key,
  quests, XP / Alloy formulas and caps, one reward per co-op room.
- Bounded, not proven: kills, coins, buildings, Threat and duration are
  client-reported and clamped to plausible rates. A cheater can claim a
  better-than-real run inside those bounds. For a co-op game with no
  leaderboards that mostly hurts the cheater; a future leaderboard replays
  its top and flagged entries before showing them (`docs/leaderboards.md`).
- A replay proves counters follow from the seed, the camp and the logged
  commands. It does **not** prove a human produced the commands.
- Resumed matches and guests who resynced mid-match have no complete log, so
  they can still be paid but cannot be verified for a leaderboard.
- `room_players` seats prove the reporter took a seat, not that they played.
- The Lattice and class still live in client-writable auth metadata. The
  stored camp caps the Lattice by level, and a rewire is charged by the
  server, but a player can still edit their own allocation directly.

## Account Upgrade Tree

Signed-in accounts own their upgrade tree on the server
(`supabase/migrations/20261027000300_account_upgrades.sql`,
`api/account-upgrades.js`).

- `account_upgrade_catalog` holds node ids, prerequisites and Alloy costs. It
  mirrors `META_NODES` in `src/meta.js`; `npm run check:postgres` fails if they
  drift. Requests carry a node id, never a price.
- `account_upgrades` holds owned nodes; `account_upgrade_imports` marks the
  one-time import. Both are read-own under RLS with no client writes.
- `account_upgrade_mutate()` (security definer, `service_role` only) handles:
  - `buy`: prerequisites owned, not already owned, wallet debited by the
    catalog cost in the same transaction.
  - `import_local`: once per account, the browser's local tree is offered;
    nodes are granted free in tier order only if their prerequisites are
    owned and the total stays within 600 Alloy of node value. Local Alloy is
    never imported. The client sends it with request id `import-local-v1`
    on sign-in, so a retry is idempotent.
  - `rewire_lattice`: charges 45 Alloy (`REWIRE_COST`) per point of the
    Lattice the server holds for that character in auth metadata, and clears
    it in the same transaction. The client syncs its profile first and resets
    its own copy only after the server confirms.
- Every request is idempotent through `economy_requests` and audited in
  `economy_audit_events`.

The tree's node effects are not yet read by the simulation (neither the guest
tree nor the account tree changes a match), and there is no tree screen yet;
the account tree is the server-side ledger they will read from.

## Known Limits

- Room browser data, player rosters, and host setup are real Supabase data.
- Mid-game Join as a new controlling player is not supported. Use Watch.
- Combat runs in the browser. The server replays required matches from the
  ticket seed and input log; other matches are bounds-checked claims.
- Cross-device identity depends on Google sign-in. Guest identity is per
  browser/localStorage.
