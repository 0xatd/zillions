# Asset licences

Presentation meshes only. None of these files are read by the simulation.

## Quaternius Ultimate Animated Character Pack (November 2019)

- Author: Quaternius
- Licence: CC0 1.0 Universal
- Source: https://opengameart.org/content/animated-characters-pack
- File: `ultimate_animated_character_pack_by_quaternius.zip`

Used as the rigged bases for the seven heroes and the zombie crowd. The
generator is `tools/blender/build_characters.py`. It recolours each figure,
adds original weapon and hive props, and exports:

- `assets/characters/heroes/hero_*.glb` — skinned clips `idle`, `run`,
  `attack`, `ability`, `hit`, `death` (the pack's Idle, Walk, Punch or
  Shoot_OneHanded, Victory, RecieveHit, and Defeat).
- `assets/characters/zombies/zombie_*.vat.bin` — baked walk, attack, and
  death frames for the instanced horde.

The zip itself is not committed. Re-download it and pass `--src` to the
generator to rebuild the GLBs and vertex clips.
