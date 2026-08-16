# Multiplayer hardening — issues + best-practices roadmap

**Session:** 2026-08-16 ~21:25–21:45 UTC · **Build:** `71f9880` (post-#27 merge, deployed) · **Room:** A2F6F9 (Campaign · Greenfall Marches · Normal · 3/3: atd host, lyra, ted)

Follow-up to `QA-REPORT-LIVE-2026-08-16.md`. This session confirmed #27's fixes work, then hit two new P1s and prompted a strategic question from Alex: **"this doesn't seem like we are leveraging best practices of other multiplayer games"** — correct, and this document is the answer.

---

## What #27 already fixed (verified this session)

- ✅ Room appears in OPEN GAMES in ~3–5s (was ~20s) — refresh-race fix landed
- ✅ Roster shows per-seat hero + ready state (host can see who's green)
- ✅ Seat, hero, and ready state all survive guest page refresh + rejoin

---

## P1 — BUG-MP-7: GoTrue auth deadlock wedges ALL Supabase calls silently

**Repro (guest, ~21:30):** sit in a room long enough / re-enter room screens → click READY FOR BATTLE → nothing. No error, no state change, ever.

**Isolation data (guest page, live):**

| Probe | Result |
|---|---|
| `updateRoomPlayer({ready})` | hung >6s, never settled |
| `refreshCurrentGame()` (plain read) | hung too |
| Raw REST fetch to same Supabase project | **HTTP 200, instant** |
| `navigator.onLine` | true |
| `sb.auth.getSession()` | **never resolves** |
| Console | "Multiple GoTrueClient instances" warning (present since B48083) |

**Chain:** second GoTrue client → cross-instance lock deadlocks → auth never settles → every supabase-js data call awaits auth internally → silent infinite hang. No timeout, no banner, no retry.

**Player impact:** guest looks "in room", never flips to ready; host's START gates forever with zero feedback. Hostage situation. (Manual workaround: full page refresh + rejoin.)

**Fixes:**
1. **Module-level Supabase client singleton** — one client, imported everywhere. Kills the multiple-instances class outright.
2. **Timeout wrapper on all Supabase writes** (e.g., 8s) → visible banner on failure ("Couldn't reach server — retrying"), auto-retry with backoff.
3. Surface per-player connection health in the roster (see BUG-MP-8).

---

## P1 — BUG-MP-8: no P2P retry after guest rejoin → host stuck on "CONNECTING 1 PLAYER"

**Exact sequence (A2F6F9):**
1. Guest hit BUG-MP-7 → page refresh → rejoin (seat/hero/ready restored ✅)
2. **But the direct game connection never re-established** — dial-in only runs at first room join, not on seat rejoin (`a.net = null`, peers = 0)
3. Host sees all 3 seats + ready checkmarks, presses START → button becomes `⏳ CONNECTING 1 PLAYER` (that player = the rejoined guest), disabled, **no timeout, no retry, no indication who**
4. Host backs out → host leaveRoom deletes room → **guests left on a ghost room screen** ("WAITING FOR HOST TO START") with no notification

Alex's quote: *"it says connecting 1 player... but the room looks full.."* — the UI renders seats/ready fine but hides connection state entirely.

**Fixes:**
1. Re-run P2P dial-in when a seat-holding guest rejoins the room
2. Watchdog: connection stalled >10s → "reconnecting…" on that player in roster + manual Reconnect button (both sides)
3. Room-lifecycle broadcast: host leaves / room deleted → guests kicked to lobby with toast ("Host closed the room")

---

## UX (Alex's notes, verbatim intent)

### Ready system → WC3/StarCraft host-start + countdown (21:31)
> "in wc3 and starcraft you can just start the game whenever the host wants and then you see the 5 4 3 2 1 countdown in the text box with the sound of a countdown that everyone can hear"

Host presses START **anytime**; 5-4-3-2-1 countdown in room chat + audible tick for everyone → launch. Players without a hero get their last pick or default. Ready state becomes cosmetic. This eliminates the entire failure family above: wedged guests can't hold the room hostage, stale ready seats don't matter.

### Hero list spacing (21:41)
> "you should NOT have to scroll to see all the possible heroes"

7 heroes in a vertical stack = hero 7+ below the fold. Suggest 2-column compact grid (or horizontal strip), perk list collapses to icons on unselected cards. Target: all heroes visible without scrolling at 1080p.

### Lobby map-card mismatch (recurring, 2C7EC1 family)
Lobby list card said "Campaign · The Black Vale" while host setup was Greenfall Marches. Card appears to render a stale/preview value before the host's map choice propagates.

---

## Strategic: best-practices gap analysis → prioritized roadmap

Everything hit tonight is a solved-problem class. Priority order:

| # | Workstream | Kills | Effort |
|---|---|---|---|
| 1 | **Supabase singleton + write timeouts + error banners** | BUG-MP-7 class (auth deadlock → silent hangs) | S |
| 2 | **WC3 lobby flow**: connect-on-join, per-player conn state in roster, host force-START, 5s audible countdown | ready-gate hostage UX | M |
| 3 | **Connection resilience**: auto-reconnect w/ backoff, re-dial on rejoin, >10s watchdog, host-leave broadcast | BUG-MP-8 | M |
| 4 | **Netcode re-architecture: replace lockstep with host-authoritative snapshots + client prediction + interpolation** | laggy guest input, freeze-on-slowest-peer, and the *entire* desync/asymmetric-replication bug class (B48083 et al) — host is truth, nothing to keep in sync | L |
| 5 | **Mid-game rejoin polish**: auto-offer Rejoin on disconnect, full snapshot on re-entry | drop → dead session | S–M |
| 6 | **Hero select layout** (2-col, no scroll) | UX complaint | S |

**Why #4 is the big one:** lockstep round-trips every input through host→all before any frame advances — guest input feels laggy at any RTT, one wedged peer freezes everyone, and replication asymmetry is structurally possible. Host-authoritative snapshots (10–20Hz state from host, client predicts own hero, interpolates everything else) is the standard for casual co-op (Minecraft, Terraria, DRG, Helldivers). Desync becomes impossible by construction. Biggest project; changes how the game *feels*.

**Caveat:** the shape is right — Supabase lobby + WebRTC host-star is a legit zero-backend indie pattern. What's missing is the reliability layer everywhere, and the netcode model choice is wrong for the feel Alex wants.

---

## Session evidence

- Full isolation probes + quotes: `notes.md` (zillions-qa workspace, sections dated 21:26–21:46)
- Earlier-session context (asymmetric replication, spawn bugs, lag data): `QA-REPORT-LIVE-2026-08-16.md` — spawn fix from #27 verified deployed (`_frontierSpawnPoints` live on prod)

---

## Addendum (21:53) — Stance system audit: Alex's read is correct

Alex: *"it feels like the defend one doesn't work at all, i never use the follow me button and the third option is the only one that seems to work."* Audit confirms all three observations. File refs from `src/game.js`.

### 1. DEFEND is freeze-in-place, not "defend city" (P1)
- `setStance('defend')` stamps `holdX/holdZ = u.x, u.z` — each unit's **current** position (line 1731). No pathing home, no anchor, no perimeter.
- Pressed mid-push (the common case), the army strands itself wherever it stands while zombies walk past to the walls. The toast says *"The army falls back to hold the line"* — it never falls back anywhere. UI lies.
- Re-press while already in Defend is a no-op (`st === this.stance` early return, line 1729) — can't re-anchor hold points without cycling stances.
- Units only engage what wanders into weapon range (~6–8 tiles, config.js) while the flow field sends the horde at the Keep — a thin line on open ground covers a small arc of a long wall.

### 2. GUARD (follow hero) is a no-value order — correct to never use it
- Permanent 1.8-tile escort ring around nearest hero (game.js:2892–2912). Drags the army through danger, abandons node-holding (ground decays), units idle if the hero dies mid-fight. No economic or defensive function.

### 3. ATTACK is the only stance with real orders — why it "works"
- Routes, destinations, re-picking (`_pushLane`), hunting seek radius (10 tiles vs weapon range), hive-siege priority (`_pickPushTarget`, siege-guard override). The other two stances are one-liners by comparison.

### 4. Co-op: stance is global, last-press-wins (P1 for MP feel)
- One shared army, any player's 1/2/3 overrides everyone instantly, no attribution in the toast (`setStance` message doesn't say who ordered it). In 3-player runs a teammate's habitual "3" silently undoes your Defend within seconds — likely why Defend felt dead *tonight specifically*.

### Fix directions
1. **Defend = route to anchor**: ring around Keep/wall perimeter (or player-placed rally flag) — actually "hold the line." Allow re-press to re-anchor.
2. **Consider the Thronefall model**: army follows hero loosely by default; trim to two meaningful orders (Follow / Push) — Defend-with-anchor can be the default state when hero idles in town.
3. **Co-op**: toast should say who set the stance (`@atd set DEFEND`); longer term, per-player squads.
