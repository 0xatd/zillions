# Zillions — Gameplay Review & Design Vision

A full review of the current game, a cleaned-up statement of the long-term
vision, and a concrete proposal for the next gameplay model.

`docs/agent-brief.md` and `docs/product-contract.md` remain the source of truth
for what is live.

**Status.** Phases 1-3 of the build order in §11 are implemented: the lane
graph, camps as faucets, hives as producers, Forward Camps, the Threat clock,
the economy without dawn, paid repair and rebuild, the enemy roles, and tower
targeting doctrine, plus terrain-derived lane nodes with the ground-versus-owner
split and territory-based supply. Balance is a first pass tuned against
simulated runs: levels 1 and 5 complete, level 3 does not, and more hives
currently makes a map easier rather than harder. See the Balance Status section
of `docs/agent-brief.md` before tuning.

**Phases 4-6 are NOT implemented** and remain design intent: the folklore
factions (§7), world-placed side missions (§8), fog of war and landmarks (§9),
and the planet and galaxy layers (§10).

---

## 1. The pitch, in one paragraph

> **Zillions is a game about taking planets.** You are a persistent hero
> commander. The Hive is eating the galaxy world by world. You drop onto a
> contested planet, plant a hold, and push outward — buying pressure, taking
> ground, and deciding which of the planet's older, stranger natives to ally
> with and which to burn. When the planet is yours, it stays yours, and you
> take your hero, your gear, and your grudges to the next one.

Every fight in the game is a **conquest of one planet**. Everything above that
— the galaxy, the campaign, the persistence — is the frame. Everything below it
— the hero, the city, the coins — is the texture.

---

## 2. Where the game actually is today

### What works, and works well

These are real strengths. Do not lose them in any migration.

- **The hold-to-build interaction is excellent.** Standing at a foundation and
  watching coins arc out of your purse (`_updatePlots`, `src/game.js`) is
  tactile, readable, and unique. It is the game's best single verb. Every new
  system should reuse it rather than inventing a new interaction.
- **The pre-planned city is the right call.** `src/plots.js` generating a
  closed rampart with four gates, flanking tower pairs, and lanes to the plaza
  means the player never faces a blank-canvas base-builder. The city looks
  designed before a coin is spent. Keep this.
- **Hero-as-avatar is the right camera.** Direct WASD control with auto-attack,
  a passive aura, and one special is the correct amount of hero. The player
  never micros, they *position*.
- **Fixed-seed determinism and lockstep discipline** (`exec()`, seeded RNG,
  snapshot/restore) is real engineering that most prototypes skip. It is also
  the single biggest constraint on everything proposed below.
- **The corpse physics, coin fountains, and readable combat feedback** carry
  more of the fun than they get credit for.

### What is holding it back

Ordered by how much they cost you.

**1. The bell makes stalling the optimal strategy.**
Day is untimed (`_updatePhase` just counts `phaseT` up during `day`). There is
no cost to not ringing. The mechanically correct play is to farm ambient
creeps, hand-raze nests with your hero, build everything you can afford, and
only then ring. The game's most powerful move is *waiting*. Removing day/night
is correct — but the important half is not "remove night," it is **replace the
missing clock with a pressure the player can see and blame themselves for.**

**2. Nothing has consequences past sunrise.**
`_repairCity` sets every building to full HP and rebuilds destroyed plots for
free every dawn. A lost tower costs one night of income. There is no attrition,
no scarring, no failure spiral — so there is no dread, and no comeback story
either. Runs have no memory of themselves.

**3. The two win conditions don't fight each other.**
"Survive 10 nights" and "raze every nest" both exist, and razing nests *also*
reduces the number of spawn directions (`_planNight` picks from living nests).
So the aggressive line is strictly better and strictly safer. A conquest game
needs the aggressive line to be a genuine gamble: pushing out should mean your
city is thinner while you're gone.

**4. Camps are a garrison, not a faucet.**
`_refillCamp` tops a camp back up to `def.count` at dawn. Buying a camp buys
you 3–5 permanent soldiers. That's a stat, not a system. **This is exactly what
your Dota instinct is reaching for** — see §4.

**5. Hive nests are HP piñatas.**
A nest is `{ x, z, hp, alive }`. It doesn't reinforce, escalate, react, or
rebuild. Its garrison is scattered once at map generation and never replaced.
Killing one is a chore with a fixed price, not a battle against a base.

**6. The enemy only ever asks one question.**
Walker, runner, brute — three stat blocks that all do the same thing: walk at
the nearest thing and bite it. So every defense is the same defense, every map
plays the same, and towers never face a counter-play. This is the biggest
single gap in moment-to-moment combat depth.

**7. Towers always shoot the nearest target.**
`_updateTowers` picks minimum distance, full stop. Chaff soaks your ballista
while the brute walks past. There is no targeting intent to express.

**8. The map is noise, not a place.**
`GameMap.generate()` is elevation/moisture noise plus nest spots plus three
sites. There is nothing on it to *find*. Ambient creeps drop a coin 5% of the
time (`DROPS.smallChance`), so exploring is actively unrewarded. A 160×160 map
where 90% of the tiles are meaningless does not read as vast — it reads as
empty.

**9. There is no fog of war.** (The only `fog` in the codebase is
`THREE.FogExp2` — atmosphere, not information.) Nothing to scout, nothing to
reveal, no map filling in as you take it.

**10. Side quests are invisible during play.**
`LEVELS[].quests` are predicate checks evaluated at `_gameOver`, surfaced only
in the pause menu. They're achievements wearing a quest costume. Nothing about
them is a *mission*.

**11. Hero builds converge.**
Level 10 grants 9 points across 4 tracks capped at 3 each (12 possible). By the
end you have nearly everything. There is no build identity and little replay
variance.

---

## 3. The vision, cleaned up

The vision is sound. It just needs to be stated as **three nested loops** so
that every future decision can be checked against the loop it belongs to.

### Loop 1 — The Minute (moment-to-moment)

> Ride, shoot, hoover coins, hold-to-build, reposition.

This is already good. Protect it. The only thing it's missing is **a reason to
be in one place rather than another** — which Loop 2 provides.

### Loop 2 — The Planet (one session, the current "map")

> Land → found a hold → buy pressure → take ground → strangle the hives →
> break the warlord → the planet is yours.

This is the loop that needs the most work, and it's what the rest of this
document is about. Today it's "build, ring bell, survive, repeat ×10." It
should be **a front line that moves.**

### Loop 3 — The Galaxy (the meta)

> Your hero, your gear, your allies, your grudges, and your planets persist.
> The Hive spreads while you're away. Choose where to go next.

Barely exists today (items + relics + hero level carry between maps). This is
where "vast" actually comes from — not from bigger tactical maps.

### The fiction, cleaned up

Three-body problem, not good-vs-evil:

- **You** — a hero commander of a young, spreading civilization.
- **The Hive / the Xeno** — the thing that eats worlds. Not evil, not
  negotiable, not intelligent in a way you can talk to. The clock on every
  planet.
- **The Folk** — werewolves, vampires, fae, deep kin, the barrow dead. **They
  were here first.** They are not monsters; they are *natives being eaten too*.
  Some will fight beside you. Some want a price you may not want to pay. Some
  would rather the planet burn than be yours.

That third leg is what makes the lore matter mechanically instead of
decoratively. Every planet asks: *who do I ally with, and what does it cost?*

And it scales forever: **every planet has its own Folk.** That's the engine
that keeps the galaxy generating new content without new systems.

---

## 4. The core proposal: Pressure & Territory

This is the big one. It is your Dota instinct, sharpened — and it happens to
fix problems 1, 2, 3, 4, 5, and 8 simultaneously.

### The current documented plan is weaker than what you're describing

`docs/agent-brief.md` currently says the next loop is *"waves arrive every
fixed interval."* That's just the bell with the player's agency removed. The
waves still come from nowhere, on a schedule nobody caused, and the player
still just stands in their city waiting.

**Recommendation: replace "waves on a timer" with "two economies pumping units
at each other along lanes."** The enemy attacks because their hives are
*producing*, not because a timer fired. Then wave pressure is something the
player can see, blame themselves for, and turn down with a crowbar.

### The model

**Nodes.** The planet gets a graph of ~12–20 capture points: crossroads,
bridges, ore fields, shrines, ruined villages, watchtowers. Each has an owner:
`neutral | player | hive | folk`. Hive nests are nodes too — the *producing*
kind.

**Lanes.** Edges between adjacent nodes, precomputed as walkable paths at map
gen. Units walk lanes. Lanes are where the game happens.

**Barracks become faucets, not garrisons.**
Replace `_refillCamp`'s fill-to-count with: every N seconds, a camp emits a
squad of `def.count`, which is assigned a lane and marches out. Camp tier
raises squad size and quality; a second camp doubles the flow. **You are not
buying soldiers, you are buying pressure per minute.** That is the whole
mental shift, and it's what makes a defense game feel like a conquest game.

**Squads are autonomous.** They walk their lane, fight what's on it, and stop
at contested nodes. No micro — which keeps the existing "no unit micro" product
rule intact. The player's control surface stays global.

**Taking a node gives you:**
- a vision bubble (once fog exists)
- a small income trickle
- a **forward spawn point** — your squads now spawn from the furthest owned
  node on that lane, exactly like Dota barracks pushing the creep meeting point
- one buildable slot for a Forward Camp, watchtower, or shrine

**Hives produce hostile squads on their own timer along their lanes.** Living
hives = constant pressure. Raze a hive = you can *hear* the pressure drop.
Razing hives stops being a checkbox and becomes turning down a dial.

### Your specific ask, spelled out

> *"when they find a hive they start spawning immediately for that"*

Two mechanisms, and you want both:

1. **Siege focus.** When a friendly squad captures the node adjacent to a hive,
   your camps *retarget* — subsequent squads walk straight down that lane
   instead of spreading. The army noses toward the exposed hive on its own. The
   player sees their whole military lean toward the kill.
2. **Forward Camps.** A captured node can be bought (hold-to-build, same verb,
   out in the field) into a cheap barracks that spawns squads *right there*.
   Now the front line has its own supply, the map genuinely gets conquered
   rather than raided, and the long walk back stops being the dominant cost of
   pushing.

Forward Camps are also the risk half of §2's problem 3: they're outside the
rampart, they're expensive, and if the lane collapses you lose them.

### Why this makes the game more fun

- **The player always has a real decision:** which front do I go stand on? The
  hero is the swing factor — a lane with the hero in it wins. So every second
  you're pushing east, you're choosing to abandon the west. That tension is the
  entire game, and today it doesn't exist.
- **The map gets memory.** The front line's shape at minute 12 is the story of
  what you did in minutes 1–11.
- **Leaving the city becomes a genuine gamble**, which is exactly what the
  aggressive line is missing.
- **It scales to co-op perfectly.** Three players, three lanes. That is a much
  better multiplayer game than three heroes standing on the same wall.

---

## 5. What actually replaces day/night

Removing the bell removes four things at once. Each needs a replacement, or the
migration will feel worse than what it replaced.

| Removed | What it did | Replacement |
| --- | --- | --- |
| Dawn payout | All income | Continuous trickle + event bursts |
| Dawn repair | Free full heal + rebuild | Paid repair, same hold-to-build verb |
| The bell | Player-controlled pacing | Threat meter + hive production |
| Night | Escalation, drama | Environmental events (see §7) |

**Income.** Buildings credit gold at a low continuous rate straight to the
purse. **Physical coins drop only from combat and conquest** — kills, razed
hives, captured nodes, boss deaths. This is a strict improvement: it deletes
the "drive laps around your own town picking up litter" chore, and it moves the
coin-hoover joy onto the part of the game you *want* the player doing.

**Repair.** Buildings no longer auto-heal. Stand next to a damaged structure
and hold the build key to repair it for gold. Destroyed plots must be re-bought
(at a discount, say 50%). Now damage is real, the player has a gold sink under
pressure, and there's a genuine decision between *repair the wall* and *buy the
next camp*. Zero new UI, zero new verbs.

**The clock.** A **Threat meter** that rises from: time elapsed, hives left
standing, and your own aggression. At thresholds the Hive answers — a named
assault, a new nest burrowing in, an elite spawning. Crucially it's **readable
and blameable**: the player caused it. That's the difference between a timer
and a clock.

**Escalation drama.** See §7 — this is where the moon comes back.

---

## 6. Combat depth: give the enemy more than one question

The cheapest large fun-gain available. Right now every enemy walks at the
nearest thing and bites it, so every defense is the same defense. Give the
horde **roles** and every tower placement, wall segment, and hero pick suddenly
has an argument behind it.

| Unit | Behavior | The question it asks |
| --- | --- | --- |
| **Spitter** | Ranged, outranges walls, hits buildings from outside | *You cannot turtle. Someone has to go out there.* |
| **Burrower** | Ignores walls, surfaces inside the rampart | *Your towers all face outward. Now what?* |
| **Caller / Shrieker** | Buffs and re-aggros nearby horde; fragile | *Kill the right target.* Gives the sniper a job. |
| **Sieger / Hulk** | Only attacks buildings, ignores units entirely | *Intercept it. Your defenses won't.* |
| **Swarm brood** | Many, weak, fast, splits on death | *Splash or drown.* Makes the flame tower matter. |

Five behaviors, not five stat blocks. That's the whole point.

**Tower targeting priority.** Add a free per-tower toggle: `Nearest / Strongest
/ Siege-first / Ranged-first`. Trivial code change on `_updateTowers`, large
tactical payoff, and it gives players something to feel clever about.

**Hero kit.** Don't grow the skill tree. Instead: **one extra active per
allied Folk faction.** Ally the Fae and your hero gains Bramble Snare. Ally the
Deep Kin and you gain a Stonewall. This makes hero variety grow through the
*world* rather than through a menu, and it makes alliances feel like power
rather than paperwork.

---

## 7. The Folk: lore that changes the rules

**Rule: no faction is a reskin.** Each one changes a rule of the game. If you
can't say what rule it changes, it's not ready to ship.

Each Folk gets:
- a home region on the planet
- a **Law** — a persistent rule they impose while they hold it
- a standing meter: `hostile → wary → allied`
- a unique unit or building unlocked by alliance
- a real cost, and a betrayal price

### Werewolves — the Lycan Clans

**This is how you keep the moon after you delete day/night.**

The day/night *cycle* is being removed as a pacing system. That doesn't mean
the sky can't turn. Keep the beautiful lighting, keep the lunar drama — and
make the moon a **werewolf faction rule** instead of a build/fight phase gate:

- The moon waxes and wanes on its own cycle, visible in the sky and on the HUD.
- **Full moon**: Lycans go berserk everywhere on the planet — huge damage, they
  ignore lanes and go straight at whatever's nearest. Hostile Lycans become a
  disaster. *Allied* Lycans become an artillery strike you didn't have to aim.
- So the sky still tells you something is coming, but it's a weather system,
  not a phase gate. You keep the drama and lose the stalling.

Clans are plural and feuding: helping one alpha makes another your enemy. That
gives you a per-planet choice with a visible consequence, and it's cheap to
author.

### Vampires — the Crimson Court

The diplomacy faction. They don't want the planet razed; they want it **fed**.

- **The Tithe**: give them a share of your houses' output each cycle and they
  field elite night-hunter squads that ask nothing else of you.
- Refuse, and they don't attack your walls — they turn your *settlers*. Houses
  start producing hostiles from the inside.
- Mechanically this is a toggle with a real cost: income down, elite military
  up, and a slow moral itch. That's a good decision, and it's a *different
  shape* of decision than anything else in the game.

### The Fae / Hollow Ones — the wilds

Mechanically the most delicious, because of something already in the code:
`TILE.FOREST` is `walk: false`. Forests are walls. So:

- **Allied**: forests become passable *to your units only*. New lanes open
  across the map that the Hive cannot use. This is an enormous strategic swing
  from one alliance, and it's nearly free to implement.
- **Hostile**: building on their groves triggers hexes — plots cost more,
  structures decay, squads get lost.

### Deep Kin — the ore

They own what `oreClusters()` already finds.

- **Allied**: deep-mine tier, and stone that unlocks a wall tier above Bastion.
- **Hostile**: mines outside the rampart get raided, permanently.

### The Barrow Dead — the aftermath

Corpses currently sink into the mud and vanish. Make them a **battlefield
resource** instead:

- Corpses persist for a while where they fell.
- The Barrow Dead (and the Hive) harvest them into new units.
- So do you, if allied.
- **The site of your last big battle shapes your next one.** That's a gorgeous
  amount of emergent drama for a small amount of code, and it makes fighting in
  the same chokepoint over and over feel *different each time*.

### The Wild Hunt — the roaming threat

A world boss that isn't attached to any nest. It wanders the planet, hunting.
It doesn't care about your city; it cares about *you*. Kill it for a
planet-defining relic. Ignore it and it keeps finding you at bad moments.

Every planet should have exactly one of these. It's the thing players tell
stories about.

---

## 8. Side missions that are actually missions

Today's quests are end-of-run predicate checks. Make them **objects that exist
in the world**, with a beacon on the minimap, and — for some of them — a
**timer**, so that going to look costs you something.

Shapes that work:

- **Rescue** — a burning steading, a countdown. Save it and it becomes a vassal
  that pays tribute or gifts a squad. Fail and it becomes a hive.
- **Escort** — a caravan physically walks a lane across the map. Protecting it
  means committing your army somewhere it wasn't going to be.
- **The Moot** — a Lycan clan asks you to kill a rival alpha. Choosing is the
  quest. Both clans remember.
- **Sealed doors** — a ruin you cannot open without a Deep Kin ally. Visible
  from run one, unopenable until much later. This is what makes a world feel
  like it has depth beyond what you've done in it.
- **The Debt** — a Folk faction saves you unprompted during a bad fight, then
  asks for something later. Pay it or don't.
- **Hunts** — a named elite roams a region. It's marked. It's optional. It's
  worth it.

Design rule: **at least one visible objective in the world at all times, and at
least one of them should be a bad idea to chase right now.** That's what makes
a map feel alive rather than solved.

---

## 9. Making it feel vast

Vastness is not map size. 160×160 is already big, and it reads as empty. Vast
comes from four things:

**1. Density of distinct places.** Not more tiles — more *landmarks with
rules*. A shrine that buffs its region. A cursed lake nothing walks around. A
collapsible bridge. A ruined city with loot and a guardian. Ten of these beat
ten thousand more grass tiles.

**2. Fog of war.** Reveal around units and owned nodes only. Then scouting has
value, the minimap becomes a progress bar for conquest, and "vast" becomes
something the player *experiences shrinking*. This might be the single highest
feeling-per-line-of-code item in this whole document.

**3. The planet view.** Zoom the camera all the way out to a stylized territory
map of the whole planet: your regions, hive regions, Folk regions, the front
line. One screen. It sells "I am conquering a planet" harder than any mechanic
below it.

**4. Named things that persist.** A Hive warlord that *escapes* at 10% health
and comes back three planets later, stronger, with a name and a grudge and a
scar where you hit it. Nemesis-lite is cheap — a name, a stat modifier, and a
memory of how the last fight ended — and nothing else on this list generates as
much player storytelling per unit of effort.

---

## 10. The galaxy layer

Above the planet view: the galaxy. Planets as nodes, the Hive spreading between
them.

- Claimed planets **stay yours**, pay a small standing income, and hold a
  garrison you can call down once per planet as an emergency button.
- The Hive advances while you're elsewhere. Take too long on Rotmire and two
  neighbours fall. **Now the tactical clock and the strategic clock are the
  same clock**, and rushing has a reason to exist.
- A lost planet can be retaken — and it remembers being yours.
- Folk standing is partly galactic. The Crimson Court talks to its cousins.
  Betray them once and the next world's Court opens hostile.

Even a very simple version of this — a static map, a counter, three states per
planet — transforms every tactical decision into a strategic one. It's the
cheapest "vast" on the list because it's mostly UI over a small amount of state.

---

## 11. Suggested build order

Sequenced so each phase is playable and each one unlocks the next.

**Phase 1 — Pressure & Territory** *(the load-bearing one)* — **SHIPPED**
Nodes, lanes, camps-as-faucets, hives-as-producers, forward camps. Delete the
bell. This is the change that makes the game a different genre, and everything
else is better on top of it. Do not do the folklore first, however tempting.

**Phase 2 — Economy without dawn** — **SHIPPED**
Trickle income, combat/conquest coins only, paid repair, the Threat meter.

**Phase 3 — Enemy roles + tower priority** — **SHIPPED**
Cheapest large win in tactical depth. Could honestly be done before Phase 2.

**Phase 4 — First Folk faction: the Lycans** — not started
One faction, done fully: standing, Law, moon events, unlocked unit, betrayal.
Werewolves first because the moon reuse means the lighting work already exists.
Prove the faction template on one before authoring five.

**Phase 5 — Fog, landmarks, world-placed quests** — not started
The "vast" pass. Also where the map stops being noise.

**Phase 6 — Planet view → galaxy layer** — not started
The frame goes on last, once there's a picture worth framing.

---

## 12. Risks worth naming up front

**Determinism.** Every one of these systems is new nondeterminism in a
lockstep-networked sim. Lane assignment, squad targeting, node capture, moon
events, corpse harvesting — all of it must route through seeded RNG and
`exec()`. This is the highest-risk part of the proposal and the easiest to get
subtly wrong. Budget for it, and consider whether co-op should lag a version
behind single-player during the migration.

**Performance.** `ZOMBIE_CAP` is 1600 and continuous production can spiral in a
way the wave model couldn't. You'll need a **global pressure budget** — a cap on
total simultaneous hostiles that hives divide between themselves — not just a
hard entity cap. A hard cap produces silent starvation bugs; a budget produces
readable behavior.

**Scope.** The folklore is the exciting part and the lane system is the
load-bearing part. There is a real risk of building five beautiful factions on
top of a loop that still stalls. Phase 1 first.

**The migration trap.** `AGENTS.md` and the product contract both warn against
half-migrating day/night. That warning applies double here: sim, UI, tutorial,
save summaries, stats labels, balance checks, and docs move together or not at
all.

---

## 13. Quick wins (small, independent, worth doing anytime)

Each of these is small, none of them depend on the big migration:

- ~~Tower targeting priority toggle.~~ **Done** — press `T` beside a tower.
- ~~Make ambient creeps worth killing.~~ **Done** — 14% for 2 coins.
- Show side-quest progress in the HUD, not only in the pause menu.
- ~~Add one enemy role.~~ **Done** — spitter, burrower, sieger and caller all shipped.
- ~~A visible threat/pressure readout.~~ **Done** — the Threat chip and its surge bar.
- ~~Minimap beacons for the front line.~~ **Done** — lane nodes are drawn by owner and pulse while contested.
- ~~Let a lost building be re-bought at a discount instead of free-rebuilt.~~ **Done** — ruins rebuild at half price.
- Name the bosses' escapes: if a boss would die and the player is far away, let
  it flee at 10% and come back next map. Cheap, and it starts the nemesis
  system for almost nothing.
