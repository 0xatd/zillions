# Faction Audio Pack

These are generated audio assets for Zillions with Warcraft, StarCraft, and
grim sci-fi flavor.

The game still uses procedural WebAudio for most runtime SFX. Some UI, alert,
weapon, zombie, and town sounds are referenced by the runtime audio layer as
sweeteners. The robot and alien groups are manifest-ready for future factions.

## Faction Voices

The generated voice pack is in `assets/audio/faction-voice-pack/`.

- `assets/audio/faction-voice-pack/index.json` lists every line and file.
- There are 80 MP3 barks.
- Each faction has 16 barks.
- Categories are `selection`, `move`, `attack`, and `alert`.

| Faction | Voice | Direction |
| --- | --- | --- |
| Fortress Army | ElevenLabs Brian | Grim space-marine infantry. Clipped, disciplined, command-radio energy. |
| Iron Choir Robots | ElevenLabs Bill | Cold machine auxiliaries. Synthetic, obedient, and unsettling. |
| Frontier Townsfolk | ElevenLabs Matilda | Human colony workers. Tired, practical, and brave because there is no other option. |
| Void Brood Aliens | ElevenLabs River | Alien brood or hivemind. Elegant, hungry, ancient, and insectile. |
| Ash Dead Zombies | ElevenLabs Callum | Plague dead. Low, broken, hungry, and almost human. |

## Sound Effects

The generated sound effect pack is in `assets/audio/sfx-pack/`.

- `assets/audio/sfx-pack/index.json` lists every sound and source.
- There are 29 MP3 effects.
- Groups are `ui`, `weapons`, `aliens`, `zombies`, `robots`, and `town`.
- 28 effects were generated through Venice.
- `town/mine_collapse.mp3` is a local synthetic fallback because the final Venice retrieve failed after generation.

## UI Effects

- Dark RTS UI click.
- Grim command-denied buzz.
- Arcane minimap waypoint ping.
- Horde alarm siren.
- Hero level-up relic sting.
- Hero revive drop-pod cue.

## Combat Effects

- Bolter burst.
- Lasgun volley.
- Plasma rifle charge.
- Chainsword swing.
- Sniper railshot.
- Grenade explosion.
- Flamethrower burst.

## Creature Effects

- Alien screech.
- Acid spit.
- Spore cloud release.
- Psychic pulse.
- Zombie horde groan.
- Brute roar.
- Flesh impact.
- Infection burst.

## Colony And Machine Effects

- Robot servo march.
- Robot death spark.
- Shield overload.
- Mech laser.
- Construction hammering.
- Town bell alarm.
- Generator hum.
- Mine collapse.

## Implementation Notes

- Keep the existing WebAudio synth as fallback.
- Load these files after the first user gesture so browser autoplay policy does not block playback.
- Use short cooldowns on voice barks so repeated orders do not overlap.
- Route factions through separate gain nodes. Creature barks should sit lower than hero barks.
- Before adding new audio files, check whether `src/audio.js` already has a procedural or MP3-backed cue for that event.
