# Audio licenses

Combat sprites live in `assets/vfx/` and are recorded in `assets/vfx/LICENSES.md` (Kenney Particle Pack, CC0).

## Runtime sound effects

The match sounds — hits, kills, building upgrades, the wave horn, and the
victory and defeat stingers — are synthesized in `src/audio.js` when they
play. They are original to Zillions. No sampled recording is used for those
cues, and nothing in that file was taken from another game.

The synthesis is part of this repository. Keep new match cues in the same
style: short, generated in the browser, and quiet when the player mutes.

## Generated concept packs

These folders were generated for Zillions and are stored with the repo:

- `assets/audio/sfx-pack/` — concept effects. Not played during a match.
  See `sfx-pack/index.json`.
- `assets/audio/faction-voice-pack/` — faction barks. Not played during a match.
- `assets/audio/click-pack/` — hero click barks. The runtime plays these
  after a user gesture. See `click-pack/index.json`.
- `assets/audio/voices/` and `assets/audio/music/` — concept voice and music
  loops. Not the match music bed. The match bed is the synth in `src/audio.js`.

They are not third-party CC0 recordings, and they are not samples ripped
from another game. Each `index.json` records how that pack was produced.
Do not add someone else's recordings without a license note in this file.
