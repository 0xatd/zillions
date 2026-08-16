# Live QA Report — zillions.taborlin.co

**Date:** 2026-08-16
**Build:** production `https://zillions.taborlin.co`
**Code at test start:** `main` @ `c2a9f40` (SHA-256 of live static assets matched that commit)
**Later main (not re-tested live):** `38059c4` (PRs #24 four heroes + #25 multiplayer-first menu merged after this session)
**Testers:** Lyra (`@lyra`, host, Google sign-in via lyra@taborlin.co) + Alex (`@atd`, guest, human)
**Session:** public room **B48083** — Campaign · Greenfall Marches · Normal · Scott English
**Audience:** main agent. Fix the multiplayer bugs first. The rest is human-voice polish.

This is a playtest report, not a code audit. Written as a player who sat down with a friend and tried to have a war.

---

## Verdict

### 2026-08-16 lobby coordination fix pass

The implementation attached to this report now addresses the staging-room
coordination and lifecycle findings:

- Online staging puts the roster, readiness, room status, and chat beside a
  compact host setup panel.
- Guests must mark Ready after they choose a hero.
- The host can launch only after every guest is Ready and directly connected.
- Back performs a real leave. A host closes the staging room. A guest removes
  their seat.
- Page shutdown marks a seat offline on a best-effort basis. Explicit Leave is
  authoritative because browsers do not wait for asynchronous unload work.
- Account and lobby code share one Supabase client.

This pass still needs one fresh production test with two signed-in browsers
before merge. The original gameplay replication, movement, and spawn findings
remain separate blockers unless that test proves current `main` already fixed
them.

Solo campaign is playable and the economy/threat loop works.
**Co-op is not a co-op game yet.**

The lobby connects. The room starts. Rejoin works. Gold and threat tick.
Then your friend says: *"I don't see your guy moving at all."*

That is the report.

---

## How we tested

- Host signed in with the real Lyra Google account. No throwaway emails.
- Guest was a real second human (`@atd`), not a second bot.
- Played like people: lobby → create public room → wait for friend → launch 2 players → found city → try to build → run around → quit/rejoin → keep playing.
- Host also ran a full solo L1 to death first (Greenfall, Normal, Scott).
- Screenshots live in the tester workspace (`zillions-qa/`). Key ones: `lobby-connected.png`, `room-b48083-host.png`, `game-started.png`, `coop-stuck.png`, `coop-founded.png`, `coop-play.png`, `coop-desync-test.png`, `city-fell.png`.

Not fully tested this pass: Watch mode, private rooms, Brutal, maps 2–5, victory, 3-player, post-#24/#25 live build.

---

## What actually works

- Google sign-in + `@lyra` username claim.
- Lobby connects in ~6s. Real presence (`@lyra` / `@atd`). Real chat with timestamps.
- Empty lobby copy is honest: "No public wars right now — start one..."
- Create public room is instant for the host. Code `B48083` appeared in OPEN GAMES as 1/3.
- Room seats, host setup summary, room chat, "LAUNCH N PLAYERS" all make sense.
- Game start did **not** freeze. `mpRole=host`, `peers=1`, `netMode=true`, phase `found` then `live`.
- Host net was healthy the whole time: **rtt 7–9ms**, peers stayed at 1.
- Guest **quit + rejoin worked**. That is the one multiplayer feature that felt finished.
- Host could see the guest position updating (`otherPos` ~68.1, 93.8).
- Economy ticked. Gold recovered after spends (62 → 4 → 220 → 510). Threat climbed 0.19 → 5.25. Zombies sat ~185–225. No host crash, no silent freeze.
- Solo L1 ran to a real defeat ("THE CITY HAS FALLEN") with clean stats. Zero JS errors on host through the whole solo run.

---

## P0 — Co-op is one-way

### BUG-MP-1 — Host hero does not replicate to guest

**Player quote:** *"i dont see yoru guy moving at all"*

**What happened:**
Host ran, sprinted, cast Q, funded plots. Guest never saw the host hero move. Host *could* see the guest.

**Why this kills the game:**
You cannot play together if only one person can see the other. You cannot rally, cover a gate, or even know if your friend is dead.

**Repro:**
1. Host creates public room, guest joins, launch 2 players.
2. Host runs around in view of guest.
3. Guest: host is missing or frozen.

**Asymmetry:** guest → host works. host → guest does not.
Rejoin did **not** fix it.

**Fix direction:** host outbound hero snapshot / lockstep unit id for the host avatar. Guest is applying peer heroes and skipping the host, or host never broadcasts its own unit the same way guests do.

---

### BUG-MP-2 — Guest movement feels nothing like solo

**Player quote:** *"all of a sudden i got transported to town and could move but it is super laggy and not smooth walking around like it normally is in campaign solo"*
**After rejoin:** *"i quit and could rejoin, but it still isnt smooth movemnt ... when i run around"*

**What happened:**
Same map, same hero family, same ~8ms rtt — guest walk is stuttery. Solo is fine. This is not "my wifi."

**Why it matters:**
Movement is the whole verb. If WASD feels like remote desktop, people leave.

**Fix direction:** client-side prediction + reconcile for the local hero. Do not wait on lockstep snapshots to place your own feet. Interpolation is for *other* people.

---

## P1 — First 30 seconds of a friend's game

### BUG-MP-3 — Guest spawns inside impassable trees

**Evidence:** guest screenshot / `coop-stuck.png`. First impression is "I can't move."

Eventually the guest got yanked to town. Until then the session was dead.

**Fix:** spawn on a walkable tile next to the found site / keep. Reject tree/water/crag. If a spawn is impassable, snap immediately and say so — don't wait for a mystery teleport.

---

### BUG-MP-4 — Room list takes ~20s to show the person who just joined

**Player quote:** *"strange it takes so long to show atd in the spot (like 20s)"*

Host already had the room. Guest had joined. The roster still said 1/3 long enough that it felt broken. Then it flipped to 2/3 and START became "LAUNCH 2 PLAYERS."

**Fix:** optimistic local insert on join ack + realtime roster, not a slow poll. If #21 / #16 were supposed to kill this, they didn't on live during this session.

---

### BUG-MP-5 — "Found the city" is a proximity lottery

Host started on the site and the button still did not appear until the hero was force-teleported onto the flag. Prompt only showed when *exactly* on it: `🏳️ Found the city HERE SPACE`.

In solo it was merely tight. In co-op it felt broken.

**Fix:** bigger found radius. Always-visible world flag. Persistent HUD button while `phase === 'found'`. Don't hide the only verb that starts the game.

---

## P2 — Solo is playable, but the game is hard to *see*

### BUG-SOLO-1 — Build targeting is "pay the nearest yellow ring"

76 identical thin rings. Hold Space. The farm at d=2.9 beat the house at d=3.1. Three tries to fund one house; two accidental spends (keep + farm).

No preview. No name. No highlight before gold leaves.

**Fix:** brighten the *current* target, put its name + cost over it, ignore plots behind the camera / outside a 30° facing cone, or click-to-lock a plot.

---

### BUG-SOLO-2 — Combat is green dots until something dies

No damage numbers. No zombie HP bars. Units are tiny. Attack animations / projectiles vanish at default zoom. You feel the economy more than the fight.

**Fix (cheap):** floating damage, enemy HP on the unit you're hitting, a slightly larger hero, a camera that doesn't treat the player like a pebble.

---

### BUG-SOLO-3 — Tutorial / first minute is directionless

Copy says "Ride to a flagged site" with no flag in the starting view. Objectives stay gray until a city exists. Tutorial text is duplicated center + bottom-right and the bottom box sits on the Build button.

Keep upgrade prompt ("56") fights the "build your first buildings" lesson. Actual charge was 42 — either pro-rate or stop lying about the number.

Threat ticks while you read. Fine for veterans. First launch should pause or dim threat until the city is founded.

---

### BUG-SOLO-4 — Defeat screen hides the retry

"THE CITY HAS FALLEN" is clear. Stats are good (64 slain, 198 coins, 5 structures razed, side quests including failed "Not One Stone").
**"Try again" is below the fold.** After a loss you get a wall of text and a scrollbar.

Post-defeat return to menu took ~15s of "Checking account…". Fresh reload is ~4s. Not a hang. Still feels dead.

**Fix:** pin Restart / Menu. Don't make the player scroll to keep playing.

---

### BUG-SOLO-5 — START on the setup screen ate an accessibility click

Agent-browser a11y click on the enabled START button reported success and did nothing. A raw DOM `.click()` launched immediately. Overlay / canvas is probably sitting on the button.

Humans with real pointers may never see this. Anyone whose click lands on the canvas will swear the button is broken.

**Fix:** check `elementFromPoint` at the button center; `pointer-events` on the canvas vs the setup overlay.

---

## Console / engineering noise

| Signal | Severity | Notes |
|---|---|---|
| `Multiple GoTrueClient instances detected` | Medium | Fires on room / game enter. `auth.js` + `online.js` both construct clients. Supabase says this can corrupt the shared storage key. |
| `ObjectMultiplex - orphaned data` for `app-init-liveness` / `background-liveness` | Ignore as game bug | `contentscript.js` — wallet/extension, guest browser. Ugly in a playtest console. Not yours. |
| Host JS errors during solo | None | Clean run. |
| Host freeze | None this session | Start, play, rejoin all stayed alive on host. |

**Fix the GoTrue double client.** One shared client. The warning is not cosmetic.

---

## Human complaints (as if we queued with a buddy)

- "Took 20 seconds for you to even show up in the room. Feels broken."
- "Spawned me in trees I couldn't walk out of."
- "I don't see your guy moving at all."
- "Walking here is nothing like solo. Super laggy, even after I rejoin."
- "The found-city button never came up until I was standing on the pixel."
- "I keep pouring gold into the wrong building because every ring looks the same."
- "I can't tell if I'm killing anything."
- "I lost and couldn't find Try again without scrolling."
- "Why does going back to the menu take 15 seconds?"

And the honest good lines:

- "Rejoin actually worked."
- "Ping is fine. This isn't a net problem."
- "Once the city existed, gold and zombies and threat all did something."

---

## Easy wins (do these after the P0/P1 net bugs)

1. **Safe spawns.** Walkable tile, always. Unstick in <1s if you get it wrong.
2. **Instant roster.** When someone joins, they are in the list *now*.
3. **Found-city HUD button** the entire `found` phase, plus a world flag you can see from the spawn camera.
4. **Target lock for build.** Highlight + name the plot Space will pay.
5. **Damage numbers + HP on the current target.**
6. **One GoTrue client.**
7. **Defeat: Restart pinned.**
8. **Nameplates over allied heroes.** Even when replication works, two tiny units in trees are unreadable.
9. **Don't start threat until the city exists** on first-ever run.
10. **Plot rings need types.** House / farm / tower should not be the same yellow doughnut.

---

## Suggested fix order for the main agent

1. Host → guest hero replication (BUG-MP-1). If this is still broken, stop shipping lobby features.
2. Local movement prediction for guests (BUG-MP-2).
3. Walkable spawn + unstick (BUG-MP-3).
4. Roster freshness (BUG-MP-4).
5. Found-city radius / always-on button (BUG-MP-5).
6. Shared Supabase client.
7. Build-target highlight.
8. Combat readability.
9. Defeat CTA above the fold.

Do not add more heroes, more menu chrome, or more lobby copy until two people can see each other run.

---

## Scope holes (don't pretend we tested these)

- Watch / spectator
- Private rooms / codes typed by a third person
- 3-player
- Brutal / Casual pacing
- Rotmire, Cinder Wastes, Barrow Hills, The Black Vale
- Victory
- The four extra heroes and the multiplayer-first menu that landed on `main` *after* this live session (`38059c4`)

Re-run B48083-style co-op on the current live SHA after the net fixes. If guest can see host sprint, the report is stale in the right way.

---

## Appendix — host end state, room B48083

| Field | Value |
|---|---|
| phase | live |
| time | 584s+ |
| threat | 5.25 |
| gold | 510 |
| zombies | 225 |
| nearZ | 2 |
| plots | 76 |
| keep | yes |
| completed buildings in poll | 0 (partial funding / poll filter — gold *did* leave on a house) |
| otherPos | 68.1, 93.8 |
| net | host, rtt 7ms, peers 1 |
| freeze | no |

---

# Campaign playthrough — live notes (session 2)

**Started:** 2026-08-16 ~19:37 UTC
**Protocol:** Alex hosts public rooms. Lyra (@lyra) joins as guest. New hero each mission. Stop → note → push PR #27 → resume.
**Live build:** `main` @ `38059c4` (PR #24 four heroes + PR #25 multiplayer-first menu now on prod).
**PR:** https://github.com/0xatd/zillions/pull/27

## Mission 1 — room `2C7EC1` (in lobby / waiting to start)

| | |
|---|---|
| Host | @atd · Alexander Thomas |
| Guest | @lyra · **Turtle Voss** (first new-hero pick) |
| Host setup (after settle) | Campaign · **The Black Vale** · Normal · 2/3 |
| Status | guest seated, "WAITING FOR HOST TO START", P2P "🟢 Connected" |

### NOTE-1 — Public game list is late (again)
Lobby first painted with **zero** open games while Alex already had a room up. ~8s later: `OPEN GAMES · 1` / `atd's war` / Campaign · The Black Vale · 1/3. Same class as BUG-MP-4. Still not instant.

### NOTE-2 — Lobby card vs room disagree on the map
- Lobby list: **The Black Vale**
- First paint after Join: host setup said **Greenfall Marches**, and the guest map picker highlighted L1 Greenfall with maps 2–5 🔒 locked
- Seconds later, host-setup strip flipped to **The Black Vale**
Guest map cards never flipped — Black Vale stayed locked on my picker even after the setup strip said that's the map. I cannot visually confirm the host's map from the picker. Confusing as hell if you're joining a friend's "endgame" room and the UI is still selling tutorial moorland.

### NOTE-3 — Guest hero click is flaky
A11y/ref click on Turtle did **not** change my seat (stayed Scott English). Direct `button.click()` did. Seat then: `Turtle Voss · in room · 🔒 unlocked through Level 1`.
The lock badge on a hero I just successfully selected is nonsense. Either hide it once selected, or don't let me pick locked heroes.

### NOTE-4 — Guest still sees L1-only unlocks in a host-owned room
Host is on The Black Vale. Guest profile is 0/5 fronts. Guest UI still greys Rotmire→Vale. Fine if the *host* owns the map pick — but then **don't show the guest a locked-looking map grid that contradicts the setup strip.** Show the host's map as the locked-in battlefield, not a fake campaign select.

### Ready
In room. Turtle kit panel looks good (Bulwark / Reactive Plating / Iron Will / Last Stand 12s). Waiting for start. Pathing + replication + spawn are the watch items once we're in.


### NOTE-5 — The room screen is a solo menu cosplaying as a lobby (host + guest UX)

**Player quote (Alex, waiting in 2C7EC1):** *"what do you think of this screen we are on now... the game lobby... i really dont like it"*

**Agreed. It's the weakest screen in the game.** Guest view, itemized:

1. **80% of the guest's screen is controls the guest cannot use.** Full map grid (locked to *guest's* campaign), difficulty selector (host-only), 8 hero cards. The things a guest needs — seats, host setup, start status, chat — are below two screens of readonly scroll. Priority is inverted: the most important info is the smallest.
2. **The screen contradicts itself three ways.** Host-setup strip: The Black Vale. Guest map grid: Greenfall highlighted, 2–5 locked. Selected hero: Turtle Voss with a 🔒 "unlocked through Level 1" badge *after* picking him successfully. Locks on things you just used destroy trust.
3. **Whose meta is it?** "The war for Earth: 0/5 fronts won" in a host-owned room. Does playing the host's Black Vale progress MY campaign? The screen never says. Guest can't even confirm which map launches from their own picker.
4. **No ready check.** Guests have no "ready" signal; host launches on faith. This is the root of the "wait for every guest before lockstep" class of bug — a ready toggle is the communication fix, not just a netcode fix.
5. **Chat buried** at the very bottom of the scroll. In a waiting room, chat *is* the room.
6. **Emoji density.** 🗺️🏰🔪🪖🐢🐼🐯🔮⏳🔗🔗 — reads prototype. Fine for now, but it's carrying semantics (lock, status, connection) that real UI states should carry.

**Redesign sketch (do this when net bugs are fixed):**
- Guest room = **match card**: big host-map banner (name, boss, terrain), host setup summary line, seat list with heroes, READY button, chat docked and always visible. No map grid, no difficulty control, no fake campaign select.
- Host keeps the full setup screen; publish a compact read-only card to guests.
- Kill lock badges on anything selectable/selected. Hide locked maps entirely in guest room context — show only the host's pick.
- Add guest ready checks; host LAUNCH shows `n/n ready`.
- Pin "WAITING FOR HOST TO START" / "LAUNCH" — never below the fold.
- Hero picker → compact carousel with the kit panel (the kit panel content itself is good — keep it).

**Root cause guess:** the room screen reuses the campaign-select component for both roles. Split it: `RoomSetupHost` vs `RoomSummaryGuest` sharing one summary card. That one refactor removes bugs NOTE-2/3/4 *and* most of this note.

#### Visual reference — Warcraft III custom-game lobby

Use Alex's Warcraft III lobby screenshots as the information-hierarchy reference for this redesign. Do not copy the ornamental chrome; copy what the screen makes obvious:

- **Roster first.** Seats, teams, player names, hero picks, ready state, and empty slots own the main panel. A player should understand who is in the war without scrolling.
- **One authoritative match setup.** The host's map, mode, and difficulty appear once in a compact map/match card. Guests never see a second, contradictory campaign picker.
- **Clear ownership.** Host-editable controls look editable. Guest views look intentionally read-only. Do not render disabled host controls as if they belong to the guest.
- **Pinned social layer.** Room chat and connection state stay visible while players wait; they are not buried below setup controls.
- **One unmistakable action.** Guest `READY` and host `LAUNCH N/N READY` stay pinned in the lower action area. They never fall below the fold.
- **Dense, not noisy.** Use the available width for a compact seat table and map preview rather than tall hero/map cards. Keep Zillions' sci-fi visual language and replace emoji-carried status with real state styling.

Suggested desktop composition: compact match/map card on the left, seat/hero roster in the center, chat on the right or directly below the roster, and a fixed Ready/Launch action row. On narrow screens, keep the order match summary → roster → chat → pinned action.

### NOTE-6 — Back abandons the room without closing it

**Player observation (Alex):** after leaving the room with Back, the lobby still showed `atd's war` as an open 1/3 game. The online list also still showed `@ted` after Ted's browser had been fully stopped.

This is real backend state, not just stale lobby rendering:

- `#s-back` only changes the visible screen. It does not leave the current room.
- The host room remains `open`, and the host seat remains in `room_players`.
- `beforeunload` calls async `endGame()`, but browsers do not guarantee that the Supabase update completes while the page is closing.
- Lobby presence is freshness-based, so a browser that disappears without an explicit disconnect remains online until `last_seen_at` ages out.

**Expected:** Back from an online room must explicitly leave it. A host should close/cancel an unstarted room; a guest should remove or mark its seat offline. The client must clear room channels, heartbeat timers, local room state, pending peers, and refresh the lobby immediately. Page close should be a fallback, not the primary cleanup path. Stale presence and abandoned rooms also need a bounded server-side expiry so crashes cannot leave ghosts indefinitely.

**Severity:** P1. The lobby advertises games nobody is hosting and people who are no longer online, so players cannot trust either list.
