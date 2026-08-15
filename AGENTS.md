# AGENTS.md - Zillions Agent Handoff

## Product

Zillions is a browser Thronefall-style survival defense game.

Production player URL: `https://zillions.taborlin.co`.
`https://zillions-iota.vercel.app` is the Vercel fallback. GitHub Pages is a
static fallback and asset-review surface.

It should feel like Thronefall mixed with They Are Billions-scale zombie pressure and Warhammer-style grim space marines.

The player rides a hero, holds Space on fixed city foundations to spend coins, and survives zombie waves.

## Hard Constraints

- Keep zero-install local play. A static file server must be enough for the game.
- Keep the backend optional. localStorage is the offline fallback, and the browser must not fail if `/api/state` or `/api/lobby` is missing.
- Do not introduce a bundler, framework, or build step unless Alex explicitly asks.
- Do not restore old RTS placement or automation surfaces unless Alex explicitly reverses the Thronefall-only direction.
- Do not commit API keys, model prompts with secrets, or private source material.
- Treat generated media as runtime assets only when `src/audio.js`, `src/ui.js`, or another runtime module references it. Do not expose repo review tools inside the game screen.

## Where To Look

- `index.html` - Game entry point.
- `assets.html` - Audio/asset browser for GitHub Pages.
- `src/config.js` - Balance, heroes, buildings, units, zombies, waves.
- `src/game.js` - Main simulation.
- `src/plots.js` - Survival foundation plan and funding helpers.
- `src/main.js` - Bootstraps renderer, UI, game loop, profiles, saves, and Vercel backend mirroring.
- `src/backend.js` - Browser client for optional cloud state and lobby APIs.
- `src/ui.js` - DOM HUD and hero picker.
- `src/audio.js` - Runtime generated MP3 audio plus WebAudio fallback.
- `api/state.js` - Vercel Blob-backed JSON state API.
- `api/lobby.js` - Vercel Blob-backed lobby presence and chat API.
- `docs/backend.md` - public backend handoff. Read this before changing auth, profiles, saves, lobbies, rooms, Supabase, or Vercel API routes.
- `supabase/schema.sql` - planned full backend schema for accounts, profiles, saves, match history, rooms, and chat.
- `docs/backend-and-marketplace.md` - backend rollout and marketplace sequencing notes.
- `assets/audio/manifest.json` - Audio pack index.
- `docs/hero-audio-pack.md` - Hero audio notes.
- `docs/faction-audio-pack.md` - Faction and SFX audio notes.

## Current Hero Design

- Captain Scott: close-range tank, red/white identity, Whirlwind, War Cry, Purifying Light, Sun Strike.
- Alexander: green/gold map-control marksman, Entangling Roots, Teleportation, Marksman's Focus, Assassinate.
- Danny: blue/black stealth sniper, Death Pulse, Beetle Swarm, Cloak & Dagger, Time Lapse.

## Current Modes

- Survival is the playable mode. It supports solo play and the existing WebRTC co-op flow.
- Survival uses the Thronefall-style ruleset only: pre-planned city plots around the Command Center, small foundation markers, hero movement, hold-Space building, construction previews/timers on inspected plots, one coin spend path, dawn payouts, and a dusk raid every day.
- Old RTS placement, economy automation, and extra mode cards are not part of the playable surface.
- The Vercel online lobby is presence and chat. The Multiplayer shell presents it as a StarCraft-style Open Lobbies browser with a room table, selected-room detail, player slots, chat, quick start, and host actions. The actual co-op simulation still uses WebRTC invite/reply codes.
- Supabase project `skqggyvkblqtyggtcxbc` owns the account backend: Auth, Google sign-in, profiles, stats, cloud saves, and match history. Rooms, ready state, hero picks, and room chat are still next. Do not point Zillions at Soshi or another product's Supabase project.
- The bottom bar in Survival must stay focused on ride/build/dawn/foundation context. Do not reintroduce selected-unit cards, manual train buttons, or Army commands into the Survival ruleset. Barracks squads rally and replenish automatically at dawn.

## Audio State

Runtime audio uses generated MP3 assets first and keeps procedural WebAudio fallback for offline or blocked playback.

Current wiring:

- Hero-select and map music play from `assets/audio/music/` after a user gesture.
- Hero picker clicks use the short `assets/audio/click-pack/` selection bark. The longer `assets/audio/voices/` files are review/future-cinematic assets, not default picker spam.
- Hero click barks play from `assets/audio/click-pack/`.
- Army, townsfolk, and zombie barks play from current gameplay events. Robot and alien barks are ready in the manifest for future factions.
- SFX play from `assets/audio/sfx-pack/` for UI, combat, colony, horde, hero, and zombie events.
- Hero cinematics play in the hero picker from `assets/heroes/videos/`.

When you change generated audio:

- Keep WebAudio fallback.
- Start playback only after user gesture.
- Respect mute state.
- Add per-category cooldowns.
- Do not overlap repeated click barks aggressively.
- Keep hero voices louder than faction ambience.
- Keep `/assets.html` available for repo review, but do not add an in-game button for it.

## Review Checklist

Before you call a change good:

- Run `npm run check`.
- Run `git diff --check`.
- Serve with `python3 -m http.server 8000`.
- Open `/` and confirm the game starts.
- Confirm the game screen does not show a repo-only asset browser link.
- Start Survival and confirm glowing foundations render, clicking one sends the hero there, standing alone does not spend coins, and holding Space on it funds construction while the ghost building becomes more visible and the timer/details update.
- Confirm W/A/S/D moves the hero straight north/west/south/east on the minimap.
- Select a unit group and confirm the bottom command bar updates. Selection cards should focus units, and double-clicking a card should select that unit type.
- Open `/assets.html` and confirm manifests load.
- If backend code changed, deploy or run with Vercel and test a `POST /api/state` insert.
- If lobby code changed, test `POST /api/lobby` join/chat and confirm stale/offline play does not break.
- Check desktop and mobile widths for obvious layout clipping.
- Confirm no secret strings were committed.

Use:

```bash
rg -n 'source credential|api key|private key' .
jq empty assets/audio/manifest.json
```

## Style

- Use plain JavaScript modules.
- Keep functions small enough to inspect.
- Prefer local constants and config objects over hidden behavior.
- Document new systems in README or `docs/` when they affect future agent work.
