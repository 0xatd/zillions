# Zillions Product Contract

This is the source of truth for future agents. Read it before you change game
systems, menus, backend code, or docs.

## Chapter-first product decision (Alex, 2026-11-22)

The persistent identity is the player's chapter: name, colors, insignia and
server-confirmed conquests. A new player creates the chapter and a customizable
Vanguard founder, then recruits the seven existing named heroes as companions
through Earth victories. Each companion can lead a mission and keeps its own
gear/XP. The chapter owns campaign territory and the shared Alloy wallet.
The five Earth battlefields are presented as city campaigns; clearing Earth
opens the existing procedural frontier. This is an account campaign, NOT a
persistent shared world, politics simulator or region-worker system.

The chapter map is the signed-in home. Deploy opens existing mission setup;
Armory/Quartermaster, Forge and skills are optional between-run services, not
mandatory NPC errands. Existing character IDs, builds and equipment are kept;
the first existing character (or explicitly stored founder) is the founder,
other legacy commanders remain accessible. No destructive migration. New
companion slots are additive. First-hour shopping is no longer compulsory.
Only server-confirmed campaign progress determines online conquests/unlocks.
Cosmetic chapter metadata cannot award victories, currency or items.

This decision supersedes older character-first menu guidance below. Keep the
siege, co-op, reward and economy invariants unchanged.

## Hero roster expansion (authorized, implementation in progress)

The target is the full Dota-reference roster, not seven renamed kits. The
127-entry reference inventory in `docs/roster/coverage.json` tracks coverage;
only actual implemented kits belong in selection. Academy recruitment and
exploration are distinct acquisition routes. Exploration can discover humans
and nonhumans. Chapter recruitment culture may exclude new nonhuman recruits;
changing culture must not delete already-owned companions or their gear.
Numbered/prime variants are requested but not implemented.

Core-kit implementation is not exact patch parity. Missing talents, facets,
item-granted abilities and innate mechanics must remain explicit in the coverage
report. Use our own visuals, not extracted Dota assets. New kit commands and
all their pending/cooldown/resource state must survive snapshot and lockstep.
Q/E/R are active slots; the rebindable secondary-bar action exposes three more.

## Target

Zillions is a browser siege game. The living world (overworld, planet hubs,
galaxy map, Orbital Lifts, parties, encounters, companies, markets, and region
workers) was removed. Do not reintroduce a persistent shared world without a
new product decision.

A new player can press Play on the title and fight as a guest stored in
this browser. Google or an email magic link is offered to save progress
and is not required to start. An existing signed-in account still opens
that account's chapter. Guest play never writes player stats, match
history, wallets, or items.

The player signs in, picks a character, deploys to a mission, rides a hero,
founds a fortified city, buys pre-planned plots with coins, and pushes the
front line outward until the map is taken. Signed-in characters keep their
level, gear, and Lattice between sieges.

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
- Damage and ruins use the same hold-to-build input with distinct Repair and
  Rebuild actions. Repair takes priority over upgrades; completing a repair
  requires a fresh press before upgrading. Paid support infrastructure may
  repair nearby structures; ruins still require rebuilding.
- Threat is the clock, and every whole level makes every hive muster at once.
- Hordes are produced by visible hive nests, continuously.
- Living allied heroes and troops reveal the battlefield around them. Ground
  outside allied vision is almost black. The soft edge keeps movement readable
  and makes unseen approaches threatening.
- Hive nests are real bases: health, defenders, and blighted ground.
- Lane nodes are taken by presence and become flag-centered expansion forts.
  Build or upgrade from anywhere inside the owned territory circle. The first
  Forward Camp pays income and musters troops forever; later tiers add its
  palisade, twin towers, heavier fire, and repair support.
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
  stance: Defend city, Follow hero, or Push the lanes. The stances sit on
  F1–F3, not the number row — see Controls below.
- Each human muster is one persistent formation. Its troops keep stable slots
  while defending, escorting, and marching. Zombies never use formation slots;
  their identity is an irregular flood.
- One living hive must materially outproduce one human camp. The player closes
  that gap by capturing nodes, raising several Forward Camps, and destroying
  the nest that feeds the lane.
- Hero level-ups must be visible and player-directed. Each point can improve
  the hero aura, one of two passive paths, or ult damage. The HUD must show
  derived hero stats and whether the aura is affecting allies or enemies.
- Persistent WC3-style heroes, items, relics, quests, and campaign progress.
- Signed-in inventory, equipment, item creation, and Salvage Alloy are
  server-owned. Economic requests are atomic, idempotent, revision-checked,
  and audited. Static local play cannot change the online economy.

Do not turn Survival back into a generic RTS or a debug launcher.

## Current Shipped Loop

Labyrinth mode uses one authored branching map for every run. Players choose
mutually exclusive routes through bespoke bridge, rotunda, ambush, causeway,
crypt, and holdout room contracts, then descend to the final boss in the
Sunless Throne. Active room fights seal the encounter and pause the rear
Pursuit Clock. Between fights, that clock escalates from scouts into a
sustained zombie flood. The run is won only by killing the final boss.

1. The player founds a city at a flagged site.
2. The siege runs continuously. The player builds, upgrades, repairs and
   rebuilds at any time, and nothing pauses while they do.
3. Camps muster squads forever. The player sets one global stance; the army
   pushes the lanes and takes nodes on its own.
4. Every living hive musters squads on a timer that tightens as Threat climbs.
   Each whole Threat level triggers a simultaneous surge from every hive.
5. Campaign maps end when every hive is razed and the champion leading the
   final counterattack is killed — or when the Keep falls.
6. After the five Earth missions, campaign maps are generated from their level
   number alone and continue without end. Campaign progress is server-owned
   for signed-in players.

Survival mode is endless; the score is the Threat level reached. The backend's
`best_day` column carries that number.

The Labyrinth is the third solo mode: a hero gauntlet with no colony, no
economy, and no army. Three authored trials (level ids 9001+) use the
`labyrinth` landform — a serpentine canyon of chambers. Every chamber holds a
hive brood nest; razing it advances the revive checkpoint and offers each
player a pick-1-of-3 blessing (run-scoped stat boons). The horde's flow field
is seeded on the heroes, the team shares a pool of lives, and razing every
chamber summons the trial's champion — kill it to clear the trial. Labyrinth
runs never advance campaign progress or unlock procedural campaign maps.

The Labyrinth is playable solo and co-op up to 3 players, through both online
rooms and manual invite codes. Multiplayer setup screens carry war-mode chips
(Campaign / Survival / Labyrinth) in the header; only the host may retarget a
room's mode, and doing so clears every guest Ready vote like any other setup
change. The shared life pool grows by one per extra hero, every living hero
seeds the horde's flow field, and each player gets their own pick-1-of-3
blessing choice per razed chamber.

A share link is another way into the same lockstep siege. The host presses
Invite, copies one URL, and a friend opens it with no account. Campaign and
Survival links seat four players. A Labyrinth link keeps the three-player cap.
The friend must join before the host starts. An invalid code, an expired link,
a full siege, a host who left, or a link opened after the start is refused.

## Controls

The control scheme follows Path of Exile 2's WASD mode, because that is the
grammar a player arriving from an action RPG already has in their hands.

- Movement is WASD and is never camera-relative.
- Build and Fight are explicit input contexts. WASD movement is shared.
- In Build mode, Space builds, upgrades, repairs, or rebuilds. B is a secondary
  accessible build binding. Space cannot dodge and Q cannot cast.
- In Fight mode, Space is the dodge roll. It is a committed burst with a short
  invulnerable window and a cooldown longer than the roll, issued as a lockstep
  command and carried in the snapshot. Construction input is disabled.
- Q, E and R are the Fight-mode ability slots. Only Q is used today, because a hero has
  one controlled ability; E and R are declared and shown as reserved rather
  than hidden, so the layout does not shift when a second ability lands.
- X draws the other weapon set.
- Alt toggles Build and Fight mode. Founding and funding a colony is the half of
  this game an action-RPG layout has no opinion about, and it keeps its key.
- Army stances take F1–F3. They moved off 1/2/3 deliberately: Path of Exile
  puts consumables there, Zillions commands squads and Path of Exile does not,
  and 1/2 are now reserved for a consumable system that does not exist yet.
- Every binding is rebindable in Settings → Controls, which reads the same
  table `src/keybinds.js` dispatches through. The code, the Settings screen,
  the in-game help and the README controls table cannot drift apart:
  `scripts/keybind-check.mjs` fails the build if they do.

Two actions that can be listening at the same moment may not share a key. That
is decided by scope — where an action is live — and not by the group it is
displayed under. A battle has movement, combat, army and interface actions all
listening at once, so a key shared across those groups leaves one of them dead.
An action's fixed alternates count as its keys for this purpose.

A scheme is never stored in a conflicting state. Rebinding a key that another
action holds hands that action the key being replaced; anything that still
cannot be given a free key is stored unbound and shown as such, because an
unbound action is honest and a shadowed one is a silent bug.

## Character Progression

A persistent character carries a build between sieges, and it has three layers
that must stay separate.

Gear is rolled. An item is a key that resolves to a base, an item level, a
rarity and its affixes; item level comes from the mission and its difficulty, so
loot quality is tied to how deep into the campaign the player has gone. Eleven slots are available:
head, chest, hands, legs, boots, weapon, off-hand, a second weapon set, and two
implants. Visible armour changes the procedural character silhouette. Weapon
and off-hand exist twice, and X draws the other set in the field on a
four-second cooldown.

Characters choose one of two free origins: Human or Robot. Origins are balanced
sidegrades. They never decide account access or payment status. Character
creation also stores face, body, head, leg, and armour-color choices.

The Orbital Exchange rotates deterministic level-scaled gear. Salvage Alloy
buys gear and is paid for sold gear. Vendor sell prices stay below buy prices.
Mission gold remains mission-only. Launch content and progression are free.
Entitlement metadata exists for future owned cosmetics and subscriptions, but
the launch UI does not gate content.

The Lattice is one shared 646-node passive tree with thirteen origins. A class
picks where it starts, not what it can become. A character spends one point per
level plus campaign points, capped at 122, so a build excludes far more than it
takes. Nodes can be pinned to one weapon set. Rewiring returns every point for
Salvage Alloy.

Weapons carry the damage numbers. A hero without an equipped weapon fights with
their signature weapon, which is that hero's original stats exactly. Damage is
split across kinetic, thermal, shock and void, and enemies resist or are
vulnerable to each.

The rules these must keep:

- Depth belongs between runs. Gear, the Lattice and weapon sets all resolve to
  flat numbers before a run starts; the simulation never queries them while it
  runs, and the tactical minute stays one hero, one gold resource, one input.
- The three layers own different jobs. In-run hero upgrades own the run, the
  Lattice owns the character, the meta tree owns the account. Two systems must
  not sell the same bonus.
- Nothing is unrecoverable. A reshaped tree, a lost level or a rewire refunds
  and prunes; it never breaks a character.
- The server owns rewards. Signed-in XP, levels, loot, Salvage Alloy, and stats
  are granted only by `api/match-result.js`. The client reports what happened;
  it never grants. Guest progress stays in the browser and is never uploaded.
- No trade until a server owns item creation.
- Do not activate player trade or paid inventory until the server owns item
  creation, inventory, currency, and every buy/sell transaction.

## Longer-Range Direction

`docs/design-vision.md` holds possible future ideas: folklore factions as
rule-changers, persistent explored-map memory, and landmarks. None of them are
implemented. A persistent shared world is out of scope.

## Production UX Rules

- Production must be account-first.
- Signed-out players see the login screen. Signed-in players see Character
  Select. The generic marketing title is not an account home.
- Character Select shows the complete roster and owns `Deploy`, character
  creation and deletion, Character Info, Custom Games, system options, and Log Out.
  `Deploy` opens mission select.
- The in-match Game Menu owns Resume, How to play, Settings, Restart, and Quit
  to menu. It does not reuse Character Select as a pause menu.
- Character Info uses separate Character, Equipment, Abilities, and Lattice
  views. Equipment is interactive. The player can inspect and compare items,
  click or double-click to equip and unequip, drag an item between the stash
  and a compatible body slot, and drag items to reorder the stash. The model
  remains the authority for requirements and legal equipment.
- Custom Games has two primary views. Live Games lists real backend rooms that
  can be joined or watched. Arcade catalogs prebuilt Zillions maps that a
  player can play immediately or use to host a room. Recent and Favorites are
  filters inside Arcade, not separate product sections.
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

- Open games are real backend rooms.
- Room players have real seats, ready state, hero picks, and chat.
- Active games support read-only Watch. Previous guests can Rejoin their seat.
- The room blocks Start until every guest connects and loads the battlefield.
- Campaign Start blocks a level that any seated player has not unlocked.
- Starting a room launches the current WebRTC match for now.
- Match results are reported to `api/match-result.js`; the server writes
  stats, history, character progress, loot, and Alloy.

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
- Server-owned characters, item instances, wallets, and match reports.

Vercel owns:

- Static game host.
- `/api/auth-config`
- `/api/match-result` (the only reward grant path)
- `/api/economy`

Vercel Blob is no longer used. The legacy `/api/state` and `/api/lobby` Blob
routes were removed once nothing called them.

WebRTC still owns match transport. The server does not simulate combat; it is
authoritative for rewards and economy.

Mission rooms support one to four players. Players create or join rooms from
Play Online or Custom Games.

## Non-Negotiables

- Preserve the production account backend when porting gameplay.
- Preserve `package.json` and `npm run check`.
- Preserve `api/auth-config.js`.
- Preserve `src/auth.js` and `src/backend.js`.
- Remove any wrong product Supabase URL before merge.
- Do not expose `assets.html` from the game screen.
- Do not add fake room rows, fake players, fake stats, or fake account labels.
- Update this document when the product target changes.

## Perimeter and inspection clarification

Main bases and fortified road outposts require one coherent terrain/wall/gate
perimeter at every tier. Deliberately open satellite positions are not forts.
Tower placement must protect entrances while leaving troop routes clear.
Clicking a unit inspects it; it never grants individual-unit commands. Carried
items must be readable by click/tap, not hover alone.

## Builder orders

A visible shared colony crew can carry out Maintain, Develop, Expand, Fortify,
Prosper or Mobilize orders. Host-controlled policy, pause and a protected gold
reserve replace individual worker micro. Manual construction remains available
and takes precedence. The crew uses existing planned plots and paid actions;
it does not claim territory, fight or create a separate economy. See
[Builder orders](builder-orders.md) for spending, specialisations and recovery.
## Hero-led combat controls

Inspection remains read-only until the player explicitly chooses **Focus
attacks** in an enemy's details. Focus only prioritizes that enemy for the local
hero while it remains within weapon range and personal vision (19 tiles).
It does not move the hero or command troops. **Clear attack focus** returns to
automatic targeting. Death or lost range clears focus automatically.

Spitters telegraph an interruptible acid impact at a fixed ground position
before damaging units; brutes wind up a short ground smash. Moving out of the
ring or stunning/killing the attacker avoids the pending strike. The nearest
impact victim takes full damage; other victims share a splash budget of 25%
of that hit, so crowded autonomous troops do not multiply its damage. Existing
spitter attacks against structures retain their siege behavior. Warning rings
come from pending simulation state, so pause, saves and Watch preserve them.

Nearby living heroes already share XP from allied kills; distant heroes do not
receive remote kill XP. Gold remains collectible on the ground, and signed-in
progression remains server-owned. There is no last-hit requirement or new
client-side reward authority.

## Friend groups — authorized 2026-11-23

A persistent private party coordinates up to four friends between existing
sieges. It is not a living world or shared combat server. Invite links/codes,
leader handoff, removal and another private room are in scope. The chapter's
selected founder/companion remains the player's leader; the party has no legacy
seven-hero list or duplicate Ready screen. Existing rooms still enforce seats,
Ready, campaign eligibility, reconnect and server-owned rewards. Party chat,
public profiles, ally revival and new social blocking systems are not in this
release. Existing lobby friends/chat remain available.

## Opening siege (2026-11-25)

Greenfall keeps site choice and Economy/Defense/Army openings. Its existing
first-siege encounter is bounded: after the first paid build, one named hive
launches the introductory wave from that hive, not unrelated forward nodes.
Other hive reinforcements and time-driven Threat wait until that wave ends,
for at most 180 seconds after the opening build. This deadline survives reload;
keeping one enemy alive cannot create unlimited safe income.
Existing world enemies still fight; this is not invulnerability or a new
build/day phase. Breaking the wave pays the existing 24 mission gold once and
leaves at least 20 seconds on living hive muster timers. Continuous siege then
resumes. Other missions and Survival keep their existing pacing.

The skippable coach teaches movement, founding, building, Defend Keep, actual
combat, the first-wave victory, then Push. It never requires Follow during a
base attack. Bindings come from the player's settings. Army orders remain
global; there is no individual squad micro. Confirming an already-active order
acknowledges the input without resetting squad routes. Keep danger exposes a
Recall army action through the same stance command.

Opening stage/wave state remains in existing snapshots. Multiplayer protocol
16 prevents protocol-15 rooms from accepting the changed simulation. The hash
includes opening state and army stance. Signed-in rewards, account progression,
map generation, and combat authority are unchanged.
