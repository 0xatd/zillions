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
- Nothing repairs itself until the player buys support infrastructure. Auto-Workshops and final-tier Repair Bastions restore nearby damaged structures. They never rebuild ruins or choose upgrades.
- The main base includes a physical Hero Forge. Its expensive tiers upgrade all allied heroes. Core economy, army, Keep, and Forward Camp plots have major late-game capstone tiers.
- Threat is the clock: it rises with time, with every living hive, and with
  every node taken. Each whole level makes every hive muster at once.
- Camps are faucets — they muster a squad every `every` seconds, forever, and
  sustain a standing force proportional to tier.
- Hive nests produce squads, spit defenders when attacked, blight the ground
  around them, and can be razed.
- Lane nodes are captured by uncontested presence, pay income, and carry
  Forward Camp plots that only unlock on ground the player holds.
- Forward Camps are lane anchors. Their upgrades must add local holding power:
  front-line blockers, short-range fire, and a final bastion/siege tier.
- Node placement is READ FROM TERRAIN (`TerrainField._findNodeFeatures`) — ore
  fields, fords, clearings, barrows, quarries — never from a ring. Do not put
  them back on a ring; identical skeletons across maps kill the mystery. Hive
  lairs and city sites are read from terrain too, for the same reason.
- Every level owns a LANDFORM and a CITY PLAN, and no two levels may share
  either. `theme.terrain` picks the landform (`TERRAIN_SHAPES` in
  `src/terrain.js`: moor, fen, wastes, hills, vale) and `theme.city` picks the
  plan (`CITY_PLANS` in `src/plots.js`: bastion, fort, star, crescent,
  keyhole). One generic round base on every map is the failure state this
  replaced — do not collapse it back.
- The BOUNDARY stays closed whatever the silhouette — but the wall is only
  half of it. Where the rampart line crosses crag, water or deep wood, no wall
  is built and the land is the wall; walls are raised across the gaps, and only
  a gap can carry a gate. Do not go back to levelling the rampart band and
  stamping a full ring: identical bases on different ground is the failure
  state this replaced. See `docs/fortress-inspiration.md`.
- Every entrance is a WARD: flanking towers plus its own muster camp, so the
  squads that hold a gate and the squads that push a lane out of it start at
  the gate. Every city keeps all three camp doctrines buildable and every camp
  on a road. At least two entrances always exist — the plan's two principal
  gates are cut open through whatever the ground put there.
- Outer works are the land's own chokepoints: a fence across a natural gap plus
  a tower behind it. They always carry a gate, because the player's own squads
  have to march out through their own fence.
- The three city sites on a map must stay meaningfully different, named, and
  described to the player before they commit the run to one.
- A node's KIND and its OWNER are separate facts. Kind is terrain and is always
  true. Ownership is claimed at setup (`Game._claimNodes`, hive takes the far
  ground) and is hidden behind `node.seen` until a friendly unit gets within
  `SIEGE.scoutRadius`. Never reveal ownership the player has not scouted.
- Campaign win: raze every hive, then kill the champion that leads the final
  counterattack. Loss: the Keep falls.
- The campaign is the war for EARTH (the five authored levels), and Earth is
  one star in a procedural galaxy. `levelById(n)` in `src/config.js` is the ONE
  level lookup: 1-5 are authored, 6+ are generated deterministically from the
  planet number (landform x plan combo walk, hue-shifted palette, scaled
  economy and elder-boss variants, maps growing to 220). Never index LEVELS
  directly for a level id. Cleared worlds persist via `profile.campaign` —
  liberation must stay sticky.
- No individual squad micro. Squads are autonomous, but the player sets the
  global stance: Defend city, Follow hero, or Push the lanes.
- Hero progression is player-chosen. Level-ups grant upgrade points for Aura,
  Passive I, Passive II, or Ult Damage. Do not return to hidden automatic
  special ranks.
- Ground you hold is ground you can fortify: every lane node carries a Forward
  Camp, a watchtower and — where the land pinches — a palisade. Everything on a
  node is locked until the node is yours and ruins when you lose it.
- The map hides field loot in barrows, hive hoards, passes and boss corpses.
  Caches are invisible until a hero is close, pickup is automatic by walking
  over them into a PACK_SLOTS-sized pack, and G drops the newest find. Field
  finds apply to hero stats immediately and carry over to the persistent hero
  at the end of a run in BOTH campaign and survival — survival has no other
  progression, so do not take that away.
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
  players, `lobby_chat`, `room_chat`, and `friendships`.
- `room_chat.channel` separates setup-room chat (`room`) from in-game team chat
  (`game`).
- Vercel Blob remains a temporary compatibility layer for old state mirror data
  and guest smoke tests. Do not route signed-in production chat or friends
  through Blob.
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

- `src/config.js` - balance, heroes, plot kinds, items, siege, levels.
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
- `docs/fortress-inspiration.md` - the historical fortification rules the city
  generator implements, and why.

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
- Set army stance and see squads push lanes.
- Confirm hive musters and Threat surges continue without day/night phases.
- Lobby empty state or real rooms only.
- `/assets.html` still works as a repo review page, but no in-game link points to
  it.
