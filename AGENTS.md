# AGENTS.md - Zillions Agent Handoff

Read this first. Then read:

- `docs/agent-brief.md`
- `docs/product-contract.md`
- `docs/backend.md`
- `README.md`

## Product Target

Zillions is a sci-fi planet-conquest siege game.

The gameplay base is continuous siege on a lane graph:

- Frontier maps with multiple city sites, hive nests, and lane nodes.
- Found a city at a flagged site.
- Closed ramparts and gate chokepoints.
- Pre-planned plots.
- Hold the interact key to stream coins into plots. The same verb builds,
  upgrades, repairs damage, and rebuilds ruins.
- Campaign economy must be balanced against collectible gold. Each level needs
  enough starting gold for a real opening build, and economy upgrades should
  pay back inside a few minutes of siege.
- No day, no night, no bell. Building is always available and never safe.
- Income is credited automatically; physical coins drop from combat and
  conquest only.
- Nothing repairs itself. Damage and ruins cost gold.
- Threat is the clock: it rises with time, with every living hive, and with
  every node taken. Each whole level makes every hive muster at once.
- Camps are faucets — they muster a squad every `every` seconds, forever, and
  sustain a standing force proportional to tier.
- Hive nests produce squads, spit defenders when attacked, blight the ground
  around them, and can be razed.
- Lane nodes are captured by uncontested presence, pay income, and carry
  Forward Camp plots that only unlock on ground the player holds.
- Node placement is READ FROM TERRAIN (`GameMap._findNodeFeatures`) — ore
  fields, fords, clearings, barrows, quarries — never from a ring. Do not put
  them back on a ring; identical skeletons across maps kill the mystery.
- A node's KIND and its OWNER are separate facts. Kind is terrain and is always
  true. Ownership is claimed at setup (`Game._claimNodes`, hive takes the far
  ground) and is hidden behind `node.seen` until a friendly unit gets within
  `SIEGE.scoutRadius`. Never reveal ownership the player has not scouted.
- Campaign win: raze every hive, then kill the champion that leads the final
  counterattack. Loss: the Keep falls.
- No individual squad micro. Squads are autonomous, but the player sets the
  global stance: Defend city, Follow hero, or Push the lanes.
- Hero progression is player-chosen. Level-ups grant upgrade points for Aura,
  Passive I, Passive II, or Ult Damage. Do not return to hidden automatic
  special ranks.
- Persistent WC3-style heroes, items, relics, quests, and campaign progress.

Do not turn this back into a generic RTS launcher.

## Loop Status

The day/bell/night/dawn model has been removed. The shipped loop is continuous
siege, described above. `game.phase` is now only `found` or `live`.

Balance was tuned against simulated runs (see `scripts/balance-check.mjs` and
the notes in `docs/agent-brief.md`), not against human play. Level 1 is
validated as winnable in roughly 13 minutes; later levels still need human
playtesting before they can be called tuned.

Longer-range direction — folklore factions, fog of war, world-placed side
missions, the planet and galaxy layers — lives in `docs/design-vision.md` and is
NOT implemented. Do not describe any of it as shipped.

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
  players, and room chat.
- Vercel Blob remains a temporary compatibility layer for state mirror,
  presence, and global lobby chat.
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
