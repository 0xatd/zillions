# Hero Audio Pack

These are saved concept assets for Zillions. They are short, Warcraft III / Dota-style click barks and first-pass generated audio samples.

The current game still synthesizes runtime sound through WebAudio. These files are stored so the voice direction, map music, and line writing do not get lost.

## Voice Direction

| Hero | Location flavor | Voice sample | Direction |
| --- | --- | --- | --- |
| Alex / 0xATD | Near Portland | `assets/audio/voices/alex-midnight-operator-elevenlabs-will.mp3` | Sharp founder/operator energy. Fast, impatient, money-minded. |
| Scott | Chicago | `assets/audio/voices/scott-chicago-elevenlabs-roger.mp3` | Deeper and steadier. Dry, practical, pressure-forward. |
| Danny | San Francisco | `assets/audio/voices/danny-san-francisco-elevenlabs-charlie.mp3` | Lighter and more theatrical. Performer energy with foggy SF weirdness. |

Use distinct voice IDs for each hero. Do not use cloned or imitated voices unless we have consented source samples.

## Alex / 0xATD - Near Portland

Selection:

- "Ship it."
- "Portland-adjacent and fully online."
- "What moves money?"
- "Show me the wedge."
- "Rain check? No. Launch check."

Repeated clicks:

- "Stop clicking and ship."
- "This is not the bottleneck."
- "You are burning runway."
- "Did we instrument this?"
- "If you click me again, I'm launching another product."

Move/order:

- "Cut scope."
- "Find demand."
- "Route around it."
- "Into the mist."
- "Automate the rest."

Attack:

- "Bad funnel."
- "Thin moat."
- "No distribution."
- "I found the spread."
- "Midnight UTC."

## Scott - Chicago

Selection:

- "Yeah?"
- "Chicago online."
- "What's the angle?"
- "Keep it sharp."
- "Wind's at our back."

Repeated clicks:

- "You done?"
- "I heard you."
- "This is not deep dish strategy."
- "Click me again and pay the city tax."
- "Very bold for someone in tower range."

Move/order:

- "Taking the Loop."
- "Across the river."
- "Good route."
- "Rotating."
- "Cold path, clean kill."

Attack:

- "South side pressure."
- "Windy City work."
- "Bad positioning."
- "No permit for that."
- "That's getting towed."

## Danny - San Francisco

Selection:

- "I'm on."
- "SF checking in."
- "What's my cue?"
- "Fog's rolling."
- "Let's make it weird."

Repeated clicks:

- "You know I can hear that."
- "Again? Bold choice."
- "This UX needs work."
- "That's not rhythm. That's harassment."
- "Very San Francisco of you."

Move/order:

- "Up the hill."
- "Through the fog."
- "I know a side street."
- "Entrance left."
- "With feeling."

Attack:

- "Wrong neighborhood."
- "Hit the mark."
- "That's the remix."
- "Bridge toll."
- "And blackout."

## Three-Hero Banter

- Alex: "Portland sets the timer."
- Scott: "Chicago brings the pressure."
- Danny: "San Francisco makes it theatrical."

- Scott: "Do we have a plan?"
- Alex: "We have a market."
- Danny: "So no plan."

## Music Pack

| Track | File | Vibe |
| --- | --- | --- |
| Midnight Operator Hero Select | `assets/audio/music/hero-select/midnight-operator-hero-select-loop-elevenlabs-music.mp3` | Fantasy MOBA hero-select loop with modern game-menu energy. |
| Portland Rainwood | `assets/audio/music/maps/portland-rainwood-loop.mp3` | Wet forest, moss, hunt. |
| Chicago Ironfront | `assets/audio/music/maps/chicago-ironfront-loop.mp3` | Cold city, steel, brawl. |
| San Francisco Fogspire | `assets/audio/music/maps/san-francisco-fogspire-loop.mp3` | Fog, hills, weird magic. |
| Midnight Bazaar | `assets/audio/music/maps/midnight-bazaar-loop.mp3` | Time-decay market, arcane economy. |

## Implementation Notes

- Add a lightweight asset loader before wiring these into selection clicks or map starts.
- Keep the existing WebAudio synth as a fallback for browsers that block autoplay until user input.
- Use short one-shot files for selection, move, attack, and repeated-click barks if we expand beyond the three first-pass samples.
- Add per-hero cooldowns so repeated clicks feel intentional and do not spam overlapping audio.
