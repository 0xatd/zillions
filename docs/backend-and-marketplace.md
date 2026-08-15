# Backend And Marketplace Plan

Zillions should use `https://zillions.taborlin.co` as the canonical game URL.
Other surfaces should link there unless a storefront requires its own hosted
build.

## Backend Direction

Use Supabase for the StarCraft-style shell and lobby layer:

- Supabase Auth for player identity.
- `profiles` for handle, display name, selected hero, and presence.
- `player_stats` for lifetime games, wins, losses, kills, best day, and buildings.
- `save_slots` for latest run snapshots and future save slots.
- `match_history` for completed runs and leaderboard-ready summaries.
- `rooms`, `room_players`, and `room_chat` for public/private room lists, ready
  state, hero picks, and room chat.

Keep Vercel as the web/API host. Keep Vercel Blob and localStorage as fallback
until the browser UI is fully migrated to Supabase-backed accounts.

Current Supabase project:

- Name: `zillions`
- Ref: `skqggyvkblqtyggtcxbc`
- Org: `taborlin`
- Region: `us-west-2`
- Site URL: `https://zillions.taborlin.co`

The schema source of truth is `supabase/schema.sql`.

## Marketplace Direction

Listing the game on a marketplace is useful, but not as the first production
home. The best sequence is:

1. Make `zillions.taborlin.co` the canonical playable build.
2. Add real sign-in, profiles, rooms, room chat, and match history.
3. Run small web playtests through direct links and lightweight game directories.
4. Use itch.io or similar as the first public listing if the game loop can retain
   players for at least one full session.
5. Wait on Steam until onboarding, save/account migration, screenshots/trailer,
   retention, and support basics are strong.

Do not launch a big marketplace page while the game still depends on local-only
identity or a placeholder lobby. That creates traffic without retention.

Good early channels:

- Direct link: `https://zillions.taborlin.co`
- itch.io web build
- Newgrounds or web-game communities if the browser build fits their rules
- Discord/friend playtests
- Short clips on X/YouTube/TikTok that point to the canonical URL

Steam is a later move. It can work, but only after the game has a clean first
five minutes, stable save/profile handling, a real trailer, and a clear reason
to wishlist.
