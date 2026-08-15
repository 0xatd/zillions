# Zillions Product Contract

This is the source of truth for future agents. Read it before you change game
systems, menus, backend code, or docs.

## Target

Zillions is a sci-fi Thronefall-style conquest defense game.

The player signs in, enters a living frontier, chooses or joins a world, rides a
hero, founds a fortified city, buys pre-planned plots with coins, and survives
night attacks from hostile Xeno territory.

Use the Claude Thronefall PR direction as the gameplay base:

- Unclaimed frontier maps.
- Multiple city sites.
- Found the city at a flagged site.
- Closed ramparts with gate chokepoints.
- Pre-planned house, farm, mill, mine, camp, tower, and wall plots.
- Hold the interact key to stream coins into a plot.
- Untimed day planning.
- Player rings the bell when ready.
- Hordes attack from visible hive nests.
- Hive nests can be razed by day.
- Camps raise troops automatically.
- No army micro. The player sets only army stance.
- Persistent WC3-style heroes, items, relics, quests, and campaign progress.

Do not turn Survival back into a generic RTS or a debug launcher.

## Production UX Rules

- Production must be account-first.
- The player should see a real sign-in gate before the game shell.
- Google-backed Zillions accounts are the durable identity.
- Guest/local/offline mode is only for static dev fallback. Do not present it as
  a production profile.
- Do not show the phrase `local profile` in player UI.
- Do not let players edit their display name from the main menu at all times.
- Display name comes from the authenticated account unless a real profile
  settings flow exists.
- Empty lobbies must show an empty state. Do not seed fake rooms or fake players.
- Stats must be real account stats or a clean zero state.

## Lobby Target

The lobby should feel like a sci-fi Thronefall conquest map, not a table-only
prototype.

Target shape:

- Each world is a live lobby or playable game.
- Players can see other signed-in players moving around the lobby/world layer.
- Worlds show territory state: safe, contested, Xeno-held, player-held.
- Xeno factions hold regions, nests, energy fields, or planets.
- Open games are real backend rooms.
- Room players have real seats, ready state, hero picks, and chat.
- Starting a room launches the current WebRTC match for now.
- Match results write back to profiles, stats, saves, and history.

Use placeholders only when they are clearly marked as coming soon and not mixed
with real production data.

## Backend Source Of Truth

Production backend is Zillions-owned:

- Canonical URL: `https://zillions.taborlin.co`
- Vercel project: `zillions`
- Supabase project: `zillions`
- Supabase ref: `skqggyvkblqtyggtcxbc`
- Schema: `supabase/schema.sql`

Do not point Zillions at Soshi, Weather.fun, or any other project backend.
Do not commit secrets.

Supabase owns:

- Auth identity.
- Profiles.
- Player stats.
- Cloud save slots.
- Match history.
- Public/private rooms.
- Room players.
- Room chat.

Vercel owns:

- Static game host.
- `/api/auth-config`
- `/api/state`
- `/api/lobby`

Vercel Blob is a temporary compatibility layer for presence, global lobby chat,
guest smoke tests, and old state mirror data. It is not the long-term source of
truth for accounts or rooms.

WebRTC still owns match transport. The server is not authoritative yet.

## Non-Negotiables

- Preserve the production account backend when porting gameplay.
- Preserve `package.json` and `npm run check`.
- Preserve `api/auth-config.js`, `api/state.js`, and `api/lobby.js`.
- Preserve `src/auth.js` and `src/backend.js`.
- Remove any wrong product Supabase URL before merge.
- Do not expose `assets.html` from the game screen.
- Do not add fake room rows, fake players, fake stats, or fake account labels.
- Update this document when the product target changes.

