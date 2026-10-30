# Audio licences

Runtime music, ambience, and sound effects live in `assets/audio/cc0/`.
Every source below is CC0. Files were trimmed, given an equal-power loop
crossfade where they loop, and gain-matched. That edit does not change the
licence. `assets/audio/LICENSES.md` is the same record.

Music beds are linear-gain matched to about -16 LUFS with true peak at or
under -1.4 dBFS. Ambience is matched to about -22 LUFS so it sits under the
bed. Effects are peak-matched: interface around -18 dBFS, footsteps around
-10 dBFS, and combat around -6 dBFS. A limiter on the master bus stops stacks
from clipping.

## Music

| File | Plays | Measured | Licence | Author | Source |
| --- | --- | --- | --- | --- | --- |
| `audio/cc0/music/menu.ogg` | Title and menus | -16.0 LUFS, peak -3.0 dB | CC0 | polosik | https://opengameart.org/content/simple-menubackground-music-loop |
| `audio/cc0/music/select.ogg` | Planet and mission select | -16.3 LUFS, peak -1.4 dB | CC0 | Écrivain | https://opengameart.org/content/icy-heights (`theme-loop.ogg`) |
| `audio/cc0/music/build.ogg` | Founding and quiet siege | -17.6 LUFS, peak -1.4 dB | CC0 | pmiller | https://opengameart.org/content/calm-track |
| `audio/cc0/music/combat.ogg` | Wave and combat | -16.1 LUFS, peak -2.9 dB | CC0 | Cleyton Kauffman | https://opengameart.org/content/rpg-battle-theme-ii |
| `audio/cc0/music/victory.ogg` | Victory sting | -17.1 LUFS, peak -3.3 dB | CC0 | Kenney | https://kenney.nl/assets/music-jingles (`jingles_STEEL07.ogg`) |
| `audio/cc0/music/defeat.ogg` | Defeat sting | -19.6 LUFS, peak -3.9 dB | CC0 | Kenney | https://kenney.nl/assets/music-jingles (`jingles_HIT15.ogg`, pitched down) |

The build bed is -17.6 LUFS because holding the peak at -1.4 dBFS used up the
gain that would have reached -16. The short stings are peak-limited; their
integrated LUFS is less stable than a full bed.

## Ambience

| File | Landform | Measured | Licence | Author | Source |
| --- | --- | --- | --- | --- | --- |
| `audio/cc0/ambient/meadow.ogg` | Moor | -22.2 LUFS | CC0 | isaiah658; Écrivain | https://opengameart.org/content/ambient-bird-sounds and https://opengameart.org/content/icy-heights |
| `audio/cc0/ambient/swamp.ogg` | Fen | -22.1 LUFS | CC0 | LokiF | https://opengameart.org/content/swamp-environment-audio |
| `audio/cc0/ambient/volcanic.ogg` | Ash wastes, labyrinth | -21.9 LUFS | CC0 | Umplix | https://opengameart.org/content/ambience-of-a-fallen-age |
| `audio/cc0/ambient/snow.ogg` | Barrow hills | -22.1 LUFS | CC0 | Écrivain | https://opengameart.org/content/icy-heights (`wind.ogg`) |
| `audio/cc0/ambient/valley.ogg` | Riven vale | -22.1 LUFS | CC0 | Écrivain; isaiah658 | https://opengameart.org/content/icy-heights and https://opengameart.org/content/ambient-bird-sounds |

## Sound effects

| Cue | Files | Licence | Author | Source |
| --- | --- | --- | --- | --- |
| UI click, hover, deny | `sfx/ui-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/interface-sounds |
| Building placed (3) | `sfx/build-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/impact-sounds |
| Building upgraded | `sfx/upgrade.ogg` | CC0 | Kenney | https://kenney.nl/assets/digital-audio |
| Coins | `sfx/coin-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/casino-audio and https://kenney.nl/assets/rpg-audio |
| Footsteps (5) | `sfx/step-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/impact-sounds |
| Melee (3) | `sfx/melee-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/rpg-audio |
| Shots and towers | `sfx/hero-*.ogg`, `sfx/tower-*.ogg`, `sfx/flame-*.ogg`, `sfx/ballista.ogg`, and the other weapon files | CC0 | Kenney | https://kenney.nl/assets/sci-fi-sounds |
| Hits (5), keep (3) | `sfx/impact-*.ogg`, `sfx/keep-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/impact-sounds and https://kenney.nl/assets/sci-fi-sounds |
| Wave horn | `sfx/horn-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/impact-sounds |
| Abilities | `sfx/ability-*.ogg` | CC0 | Kenney | https://kenney.nl/assets/sci-fi-sounds and https://kenney.nl/assets/digital-audio |
| Zombie groans (5) | `sfx/zombie-groan-*.ogg` | CC0 | StarNinjas | https://opengameart.org/content/16-monster-growls |
| Zombie attacks and deaths (5) | `sfx/zombie-attack-*.ogg`, `sfx/zombie-death-*.ogg` | CC0 | Darsycho; StarNinjas | https://opengameart.org/content/monster-snarls and https://opengameart.org/content/16-monster-growls |

Kenney's packs are Creative Commons Zero: https://creativecommons.org/publicdomain/zero/1.0/
