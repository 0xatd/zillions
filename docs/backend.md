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

Production is account-first. On `zillions.taborlin.co`, the game shell is gated
by Google/Supabase sign-in. Static local play can remain for development and
offline smoke tests, but it must not be presented as a production profile.
After Google sign-in, players claim a public username for the email-backed
account. Public profile, lobby, chat, room, and invite surfaces use that
username. They must not show the email address or a Google account name.

## Backend Boundaries

### Vercel

Vercel serves the game and same-origin API routes:

- `api/state.js` stores and reads JSON state in Vercel Blob.
- `api/lobby.js` stores short-lived public lobby presence and chat in Vercel
  Blob.
- `api/auth-config.js` exposes only browser-safe Supabase config.

Do not put server-only secrets in responses. The Supabase anon key is browser
configuration, but service-role keys and Blob tokens must stay in Vercel env.

### Supabase

Supabase owns the real account backend:

- Google/Auth identity.
- Player profiles.
- Lifetime stats.
- Cloud save slots.
- Private match history.
- Public/private room records, room players, ready state, hero picks, and room
  chat.

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
Supabase. Vercel Blob is still used for compatibility state, presence, and
global lobby chat while room chat matures.

### WebRTC

Actual co-op gameplay is still peer-to-peer. The host sequences commands and
broadcasts them to peers. The backend does not run the simulation, validate
combat, or prevent cheating. Treat ranked/authoritative multiplayer as a
separate future project.

## Current Data Model

### Vercel Blob State Mirror

`/api/state` accepts `profile`, `settings`, `save`, and `game`.

Blob paths use this shape:

```text
players/<playerId>/profile/current.json
players/<playerId>/settings/current.json
players/<playerId>/save/latest.json
players/<playerId>/game/<id>.json
```

This is compatibility storage for guest/offline profiles and smoke tests. It is
not the long-term account source of truth once Supabase is fully wired.

### Vercel Blob Public Lobby

`/api/lobby` accepts `join`, `heartbeat`, `chat`, and `leave`.

Blob paths use this shape:

```text
lobbies/<mode>/players/<playerId>.json
lobbies/<mode>/chat/<timestamp>-<playerId>-<random>.json
```

Presence expires after about 60 seconds. Heartbeats run from the browser. This
lobby is a lightweight public presence/chat surface, not the final multiplayer
room system.

### Supabase Tables

Defined in `supabase/schema.sql`:

- `profiles`: one row per authenticated player. Stores the public username in
  `handle`, mirrors it in `display_name`, tracks `username_set`, selected hero,
  avatar color, timestamps, and last seen time.
- `player_stats`: lifetime games, wins, losses, kills, best day/wave,
  buildings built, and favorite hero.
- `save_slots`: authenticated cloud save slots. Current UI uses `slot_key =
  'latest'`.
- `match_history`: completed run summaries. Records are private by default,
  with optional public visibility for future leaderboards.
- `rooms`: planned multiplayer room browser records.
- `room_players`: planned room seats, ready state, hero pick, and connection
  state.
- `room_chat`: planned room-scoped chat.

RLS policy intent:

- Authenticated users can read public lobby/profile surfaces.
- Users can create/update their own profile, stats, saves, and match history.
- Room hosts control their own rooms.
- Room members can post room chat.

## Runtime Flows

### Static Development Play

1. Browser creates or loads `zillions_player_id` in localStorage.
2. Static builds can run without Supabase for local development.
3. Profile, settings, and latest save stay local.
4. This is not the production identity model.

### Google Profile

1. Browser checks `/api/auth-config`.
2. If Supabase config is enabled, `src/auth.js` loads `@supabase/supabase-js`
   from ESM.
3. The account modal starts Google OAuth.
4. Supabase Auth returns to `https://zillions.taborlin.co/`.
5. The browser creates a private fallback handle if the profile is missing.
6. If `username_set` is false, the account gate asks the player to claim a
   username before the game shell opens.
7. Signed-in play syncs selected hero, stats, latest save, and private match
   history to Supabase.

### Multiplayer Today

1. Signed-in players join the Zillions lobby.
2. Vercel Blob provides short-lived presence and global lobby chat.
3. Supabase `rooms` and `room_players` provide real public/private room rows.
4. Host co-op still uses WebRTC signaling and lockstep for the match.
5. The match simulation is peer-to-peer and host-sequenced.

### Multiplayer Target

The next backend step is to make the Multiplayer hub feel like a conquest map:

1. Worlds are live rooms or games.
2. Players can see signed-in players moving around.
3. Regions show safe, contested, Xeno-held, and player-held territory.
4. Rooms show seats, ready state, hero picks, and chat.
5. Host starts WebRTC match.
6. Match result writes to Supabase stats/history.

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
- For live backend changes, smoke test `/api/state`, `/api/lobby`, and Google
  account flow when relevant.

## Known Limits

- Room browser data is real Supabase data, but the room UI is still early.
- Vercel Blob global lobby chat is temporary and not the final room chat system.
- Server-authoritative multiplayer is not implemented.
- There is no anti-cheat.
- Cross-device identity depends on Google sign-in. Guest identity is per
  browser/localStorage.
