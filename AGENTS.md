# AGENTS.md - Zillions Agent Handoff

## Product

Zillions is a static browser survival RTS.

It should feel like They Are Billions mixed with Warcraft III hero mechanics, StarCraft command flow, and Warhammer-style grim space marines.

The player builds a colony, survives zombie waves, controls a hero, and can let the Overseer bot handle economy/defense automation.

## Hard Constraints

- Keep the game static. Do not add a backend.
- Keep zero-install local play. A static file server must be enough.
- Do not introduce a bundler, framework, package manager dependency, or build step unless Alex explicitly asks.
- Do not remove the existing game loop, hero system, or Overseer behavior unless the task is specifically about replacing them.
- Do not commit API keys, model prompts with secrets, or private source material.
- Treat generated media as concept assets until wired into runtime code.

## Where To Look

- `index.html` - Game entry point.
- `assets.html` - Audio/asset browser for GitHub Pages.
- `src/config.js` - Balance, heroes, buildings, units, zombies, waves.
- `src/game.js` - Main simulation.
- `src/ui.js` - DOM HUD and hero picker.
- `src/audio.js` - Runtime synthesized audio.
- `assets/audio/manifest.json` - Audio pack index.
- `docs/hero-audio-pack.md` - Hero audio notes.
- `docs/faction-audio-pack.md` - Faction and SFX audio notes.

## Current Hero Design

Each hero is auto-attack + one passive aura + one special (Space at night, Q anytime):

- Scott English: shotgun brawler (short range, heavy splash hits, slow rate). Aura: Heavy Gravity (slows nearby dead). Special: Gravity Hammer (massive AoE melee slam + brief stun).
- Alexander Thomas: long-range marksman. Aura: Nanite Swarm (heals nearby troops/heroes). Special: Concussion Grenade (blast ahead + knockback, hero hops backward).
- Danny Donovan: long-range stealth sniper. Aura: Nutrient Siphon (drains nearby dead, leeches back to him). Special: The Weave (invisible + fast, passes through the horde, damages everything brushed).

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

- Run `git diff --check`.
- Serve with `python3 -m http.server 8000`.
- Open `/` and confirm the game starts.
- Open `/assets.html` and confirm manifests load.
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
