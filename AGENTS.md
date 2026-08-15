# AGENTS.md - Zillions Agent Handoff

Read this first. Then read:

- `docs/agent-brief.md`
- `docs/product-contract.md`
- `docs/backend.md`
- `README.md`

## Product Target

Zillions is a sci-fi Thronefall-style conquest defense game.

The current gameplay source is the Thronefall-style city-defense direction:

- Frontier maps with multiple city sites.
- Found a city at a flagged site.
- Closed ramparts and gate chokepoints.
- Pre-planned plots.
- Hold the interact key to stream coins into plots.
- Campaign economy must be balanced against collectible gold. Each level needs
  enough starting gold for a real opening build, and economy upgrades should
  pay back inside the 10-night campaign window.
- Untimed day planning.
- Ring the bell to start night.
- Hordes attack from visible hive nests.
- Hive nests can be razed.
- Camps raise troops automatically.
- No individual squad micro. Squads are autonomous, but the player sets the
  global stance: Defend city, Follow hero, or Hunt hives.
- Hero progression is player-chosen. Level-ups grant upgrade points for Aura,
  Passive I, Passive II, or Ult Damage. Do not return to hidden automatic
  special ranks.
- Persistent WC3-style heroes, items, relics, quests, and campaign progress.

Do not turn this back into a generic RTS launcher.

## Current vs Next Loop

The current shipped game still uses day, bell, night, and dawn phases. Building
and upgrading now stay available during waves.

`docs/product-contract.md` owns the next loop. Current direction is holdout
mission waves: waves attach to hive timers, attack-lane warnings, boss gates,
rescues, extraction moments, or player bell taunts.

Do not half-migrate this by changing text only. A real migration must update
simulation, UI, tutorials, save summaries, stats labels, economy tests, and
docs together.

## Production Rules

- Production is account-first.
- Do not show `local profile` in player UI.
- Do not show fake rooms, fake players, fake stats, or seeded production data.
- Google sign-in is private account identity. Public identity is the username
  the player claims for that account.
- Do not show email addresses or Google account names on profile, lobby, chat,
  room, invite, or presence surfaces.
- Do not let the player freely edit display name from the main menu unless a
  deliberate profile settings flow exists.
- Empty room lists must show a clean empty state.
- Keep `https://zillions.taborlin.co` as the canonical player URL.
- Gameplay camera orientation is fixed. Do not make gameplay movement
  camera-relative. W moves north/up, A west/left, S south/down, and D
  east/right on the minimap. The player view and minimap must agree.

## Backend Rules

Zillions backend belongs to Zillions:

- Supabase project ref: `skqggyvkblqtyggtcxbc`
- Vercel project: `zillions`
- Schema source: `supabase/schema.sql`
- Backend docs: `docs/backend.md`

Do not point Zillions at Soshi, Weather.fun, or any other product backend.
Do not commit secrets, service-role keys, env values, or raw credentials.

Preserve these files unless a task explicitly replaces the backend:

- `package.json`
- `package-lock.json`
- `api/auth-config.js`
- `api/state.js`
- `api/lobby.js`
- `src/auth.js`
- `src/backend.js`
- `supabase/schema.sql`
- `docs/backend.md`

## Current Runtime Shape

- Production loads through Vercel.
- Google/Supabase account sign-in gates the production game shell.
- Supabase stores profiles, stats, cloud saves, match history, rooms, room
  players, friends, global lobby chat, room chat, and in-game team chat.
- Vercel Blob remains a compatibility layer for old state mirror and smoke-test
  paths. It is not production social identity.
- WebRTC carries match traffic. The backend is not server-authoritative yet.
- Static local play can remain for development fallback, but it is not the
  production identity model.

## Larger Lobby Direction

The lobby target is a conquest layer:

- Worlds are live rooms or games.
- Players can see other signed-in players moving around.
- Regions show territory: safe, contested, Xeno-held, player-held.
- Xeno factions control nests, energy fields, planets, or zones.
- Room state is real: seats, ready state, hero picks, chat, start, results.

Do not implement fake conquest data as if it is live.

## Key Files

- `src/config.js` - balance, heroes, plot kinds, items, waves, levels.
- `src/plots.js` - city sites, ramparts, gates, plots.
- `src/game.js` - simulation and Thronefall mechanics.
- `src/main.js` - renderer, input, account gate, save sync, co-op.
- `src/ui.js` - HUD, menus, lobby UI.
- `src/online.js` - account-backed room/lobby adapter.
- `src/auth.js` - Supabase auth and profile/save/stat sync.
- `src/backend.js` - Vercel API helpers.
- `api/` - Vercel server routes.
- `docs/product-contract.md` - product source of truth.
- `docs/agent-brief.md` - quick current-state and pitfall brief.
- `docs/backend.md` - backend source of truth.

## Validation

Before you call a change good:

```bash
npm run check
git diff --check
jq empty assets/audio/manifest.json
jq empty assets/audio/click-pack/index.json
jq empty assets/audio/faction-voice-pack/index.json
jq empty assets/audio/sfx-pack/index.json
rg -n 'source credential|api key|private key|sb_publishable_|qgvpfkncgpqtxxozatax' . --glob '!node_modules/**'
```

Also smoke test:

- Production account gate.
- Start campaign.
- Found a city at a site.
- Hold Space/B to build a plot.
- Ring the bell.
- First night wave.
- Lobby empty state or real rooms only.
- `/assets.html` still works as a repo review page, but no in-game link points to
  it.
