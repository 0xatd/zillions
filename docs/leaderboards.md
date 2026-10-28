# Leaderboards: anti-cheat plan

Zillions has no leaderboard yet. This note records how one should work, so the
match pipeline keeps what it will need.

## What comparable games do

Small indie games with leaderboards accept the client's score, bound it with
cheap server checks, and clean up the top of the board afterwards. None of them
re-simulates every match on the server.

- **Thronefall** has no in-game global board. The community leaderboard needs
  a screenshot or video of every entry and is moderated by hand.
- **Slay the Spire** trusts the submitted daily score, and its top entries are
  routinely faked. In Slay the Spire 2, Mega Crit made dailies friends-only
  rather than add invasive anti-cheat.
- **Bloons TD 6** flags cheating accounts (automatically or by hand), removes
  their scores from event leaderboards, and keeps them out of competitive modes.
- **Steam leaderboards** can be set to *Trusted* writes, so only the
  developer's server can post a score. They can also attach a replay to each
  entry.

## Plan for Zillions

Every match already gets the cheap checks: a signed single-use ticket, a
duration measured from the server clock, plausibility bounds on every counter,
and the loot table. Campaign perks are part of that ticket. The bounds widen
only for the counters those perks can raise. `verifyReplay()` rebuilds the
match with the perk stack stored on the replay log.

1. **Server-only writes.** Only the server writes a leaderboard row, from
   `match_reports`. Clients never post scores, which is the same idea as
   Steam's Trusted writes.
2. **Only bests keep a log.** `match_reports.replay_log` is stored for personal
   bests, first clears, survival bests and suspicious runs
   (`reviewReasons()` in `src/match-replay.js`). Its `replay_status` starts as
   `unverified`, and the reporter's camp is rebuilt from server data.
3. **Verify the top N before showing it.** A small job (cron or admin action)
   takes each board's top N entries plus any `flagged` ones that are still
   `unverified`. It runs `verifyReplay()` on each and sets `replay_status` to
   `verified` or `mismatch` (filling `replay_mismatch`). The board shows only
   `verified` rows. Below the top N it may show `unverified` rows, or hide
   them. Rewards are never affected.
4. **Flags.** `flagged` marks runs whose counters sit above half their bound, a
   duration faster than 1.5x the server clock, or a very early boss kill.
   Flagged rows are verified first, or reviewed by hand.
5. **Admin hide and remove.** `match_reports.leaderboard_hidden` hides an
   entry without deleting it. Removing an account from the boards should be
   one flag on the account, as in Bloons TD 6, rather than per-row edits.
6. **Engine drift.** A `mismatch` is not proof of cheating, because float
   maths can differ between a browser and Node. Hide the entry and review it.
   Don't punish the account automatically.

If replays prove too slow for a function, run verification in a background
worker. It never sits on the reward path, so a slow replay delays only a board
entry, never a payout.
