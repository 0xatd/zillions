# Zillions Product Contract

This is the source of truth for future agents. Read it before you change game
systems, menus, backend code, or docs.

## Target

Zillions is a sci-fi planet-conquest siege game.

The player signs in, enters a living frontier, chooses or joins a world, rides a
hero, founds a fortified city, buys pre-planned plots with coins, and pushes the
front line outward until the planet is taken.

Use continuous siege on a lane graph as the gameplay base:

- Unclaimed frontier maps, each with its own landform. Two levels must never
  share a landform, and a level's terrain must shape play, not just palette.
- Multiple city sites, each with a different character, named and explained to
  the player before they commit.
- Found the city at a flagged site.
- A closed defensive boundary with gate chokepoints. Each level raises a
  different city plan — silhouette, gate count, street pattern — and no two
  levels share one.
- The ground is part of the fortification. Crag, water and deep wood along the
  wall line are wall; the player only builds and pays for the gaps. Terrain
  decides how many entrances a site has, and the site survey tells the player
  how much of the wall line that ground closes before they commit.
- Every entrance is a ward: towers covering the gate and a muster camp inside
  it, so defending a gate and pushing a lane out of it start in the same place.
- The land's own chokepoints are buildable: a cheap fence across a natural gap,
  with a tower behind it, out on the approaches.
- Pre-planned house, farm, mill, mine, camp, tower, and wall plots.
- Hold the interact key to stream coins into a plot.
- Economy must be level-balanced against gold the player can actually collect.
  A campaign level should start with enough gold for a real opening choice, and
  income upgrades should pay back inside a few minutes of siege.
- No day, no night, no bell. Building is always available and never safe.
- Income is credited automatically; ground coins come from combat and conquest.
- Nothing repairs itself — damage and ruins are paid for with the same
  hold-to-build verb.
- Threat is the clock, and every whole level makes every hive muster at once.
- Hordes are produced by visible hive nests, continuously.
- Hive nests are real bases: health, defenders, and blighted ground.
- Lane nodes are taken by presence, pay income, and unlock a real expansion
  fort: Forward Camp, watchtower, and a palisade where the ground pinches.
- The map hides items worth going to look for. Heroes pick them up by walking
  over them, carry a limited pack, can drop what they do not want, and keep
  what they carry out — in survival as well as campaign.
- Node, hive and city-site placement are derived from terrain, never from a ring.
- What a node IS may be readable from the map. Who HOLDS it must not be, until
  the player has scouted it.
- Camps are faucets that muster squads forever.
- No individual army micro. Squads are autonomous, but the player sets the
  global army stance: defend city, follow the hero, or hunt outward toward
  enemies and hive nests.
- No individual squad micro. Squads are autonomous; the player sets the global
  stance: Defend city, Follow hero, or Push the lanes.
- Hero level-ups must be visible and player-directed. Each point can improve
  the hero aura, one of two passive paths, or ult damage. The HUD must show
  derived hero stats and whether the aura is affecting allies or enemies.
- Persistent WC3-style heroes, items, relics, quests, and campaign progress.

Do not turn Survival back into a generic RTS or a debug launcher.

## Current Shipped Loop

Labyrinth mode uses one authored branching map for every run. Players clear
six required brood chambers, can risk an optional reward branch, and descend
to the final boss in the Sunless Throne. A rear Pursuit Clock escalates from
scouts into a sustained zombie flood. The run is won only by killing the final
boss.

1. The player founds a city at a flagged site.
2. The siege runs continuously. The player builds, upgrades, repairs and
   rebuilds at any time, and nothing pauses while they do.
3. Camps muster squads forever. The player sets one global stance; the army
   pushes the lanes and takes nodes on its own.
4. Every living hive musters squads on a timer that tightens as Threat climbs.
   Each whole Threat level triggers a simultaneous surge from every hive.
5. Campaign maps end when every hive is razed and the champion leading the
   final counterattack is killed — or when the Keep falls.
6. The campaign is the war for Earth (five authored fronts). Past it the
   galaxy is procedural and endless: frontier worlds are deterministic from
   their number, get larger and harder with depth, and stay liberated on the
   player's profile once cleared.

Survival mode is endless; the score is the Threat level reached. The backend's
`best_day` column carries that number.

The Labyrinth is the third solo mode: a hero gauntlet with no colony, no
economy, and no army. Three authored trials (level ids 9001+) use the
`labyrinth` landform — a serpentine canyon of chambers. Every chamber holds a
hive brood nest; razing it advances the revive checkpoint and offers each
player a pick-1-of-3 blessing (run-scoped stat boons). The horde's flow field
is seeded on the heroes, the team shares a pool of lives, and razing every
chamber summons the trial's champion — kill it to clear the trial. Labyrinth
runs never advance campaign progress or unlock galaxy planets.

The Labyrinth is playable solo and co-op up to 3 players, through both online
rooms and manual invite codes. Multiplayer setup screens carry war-mode chips
(Campaign / Survival / Labyrinth) in the header; only the host may retarget a
room's mode, and doing so clears every guest Ready vote like any other setup
change. The shared life pool grows by one per extra hero, every living hero
seeds the horde's flow field, and each player gets their own pick-1-of-3
blessing choice per razed chamber.

## Longer-Range Direction

`docs/design-vision.md` holds the next horizon: folklore factions as
rule-changers, fog of war, world-placed missions, landmarks, and a strategic
galaxy simulation. Those systems are not implemented. The endless procedural
frontier worlds are implemented. Prove the siege loop with human playtesting
before you add more strategic systems.

## Production UX Rules

- Production must be account-first.
- The signed-in home screen is multiplayer-first. `Play Online` is the primary
  action. `Play Solo` contains Story Campaign, Survival, and The Labyrinth.
- Campaign and Survival own their saved runs. Show Resume inside the matching
  solo mode. Do not add a generic Continue button to the home screen.
- Treat Campaign as the finite story/onboarding path. Do not present it as the
  whole product or as the primary repeat-play action.
- The player should see a real sign-in gate before the game shell.
- Google-backed Zillions accounts are the durable identity.
- After Google sign-in, the player must choose a public username for that
  email-backed account. Other players see the username, not the email address or
  Google account name.
- Guest/local/offline mode is only for static dev fallback. Do not present it as
  a production profile.
- Do not show the phrase `local profile` in player UI.
- Do not let players edit their display name from the main menu at all times.
- Public display name is the chosen username. Do not derive public identity from
  email local parts or Google profile names.
- Empty lobbies must show an empty state. Do not seed fake rooms or fake players.
- Stats must be real account stats or a clean zero state.
- Movement orientation is fixed, not camera-relative. W moves north/up, A moves
  west/left, S moves south/down, and D moves east/right on the minimap. The
  minimap and player view must show the same movement direction.

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
- Active games support read-only Watch. Previous guests can Rejoin their seat.
- The room blocks Start until every guest connects and loads the battlefield.
- Campaign Start blocks a level that any seated player has not unlocked.
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
- Global lobby chat (`lobby_chat`).
- Friend requests, accepted friends, and friend online state (`friendships`).
- Room setup chat and in-game team chat (`room_chat.channel = 'room' | 'game'`).

Vercel owns:

- Static game host.
- `/api/auth-config`
- `/api/state`
- `/api/lobby`

Vercel Blob is a temporary compatibility layer for guest smoke tests and old
state mirror data. It is not the source of truth for signed-in chat, friends,
accounts, or rooms.

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
