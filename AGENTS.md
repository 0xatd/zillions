# AGENTS.md - Zillions Agent Handoff

## Product

Zillions is a browser survival RTS.

It should feel like They Are Billions mixed with Warcraft III hero mechanics, StarCraft command flow, and Warhammer-style grim space marines.

The player builds a colony, survives zombie waves, controls a hero, and can let the Overseer bot handle economy/defense automation.

## Hard Constraints

- Keep zero-install local play. A static file server must be enough for the game.
- Keep the backend optional. localStorage is the offline fallback, and the browser must not fail if `/api/state` is missing.
- Do not introduce a bundler, framework, or build step unless Alex explicitly asks.
- Do not remove the existing game loop, hero system, or Overseer behavior unless the task is specifically about replacing them.
- Do not commit API keys, model prompts with secrets, or private source material.
- Treat generated media as concept assets until wired into runtime code.

## Where To Look

- `index.html` - Game entry point.
- `assets.html` - Audio/asset browser for GitHub Pages.
- `src/config.js` - Balance, heroes, buildings, units, zombies, waves.
- `src/game.js` - Main simulation.
- `src/main.js` - Bootstraps renderer, UI, game loop, profiles, saves, and Vercel backend mirroring.
- `src/backend.js` - Browser client for optional cloud profile/settings/saves.
- `src/ui.js` - DOM HUD and hero picker.
- `src/audio.js` - Runtime synthesized audio.
- `api/state.js` - Vercel Blob-backed JSON state API.
- `assets/audio/manifest.json` - Audio pack index.
- `docs/hero-audio-pack.md` - Hero audio notes.
- `docs/faction-audio-pack.md` - Faction and SFX audio notes.

## Current Hero Design

- Captain Scott: close-range tank, red/white identity, Whirlwind, War Cry, Purifying Light, Sun Strike.
- Alexander: green/gold map-control marksman, Entangling Roots, Teleportation, Marksman's Focus, Assassinate.
- Danny: blue/black stealth sniper, Death Pulse, Beetle Swarm, Cloak & Dagger, Time Lapse.

## Audio State

Runtime audio is still procedural WebAudio. Generated MP3 packs are saved for review and later integration.

Saved packs:

- Hero samples.
- Hero click barks.
- Faction voices.
- SFX.
- Hero-select and map music.

If you wire generated audio into the game:

- Keep WebAudio fallback.
- Start playback only after user gesture.
- Respect mute state.
- Add per-category cooldowns.
- Do not overlap repeated click barks aggressively.
- Keep hero voices louder than faction ambience.

## Review Checklist

Before you call a change good:

- Run `npm run check`.
- Run `git diff --check`.
- Serve with `python3 -m http.server 8000`.
- Open `/` and confirm the game starts.
- Open `/assets.html` and confirm manifests load.
- If backend code changed, deploy or run with Vercel and test a `POST /api/state` insert.
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
