# Leader navigation

## Shared-overworld decision (Alex, 2026-11-26)

**The overworld itself is multiplayer:** WoW-style cooperative parties inside
one persistent Bannerlord-style strategic map shared by everyone in that
world/realm. It is not a collection of private party worlds, nor a solo
mission selector that becomes multiplayer only when a battle starts. Players
can travel together or separately and encounter other players and parties.
Party membership is a social/cooperative grouping within the world, separate
from character identity, faction membership, rank and political hierarchy.
The current four-seat battle-room limit is not a limit on the shared world's
population. Do not infer PvP or faction leadership from this design.

Returning characters enter that world directly. New characters use guided
creation and the first-world introductory campaign. Whether tutorial content
or battles use separate instances is not decided here; do not silently make
the whole overworld private. Shared-world time cannot pause for one player's
menu; battle readiness barriers concern encounter participants, not everyone
in the realm.

This is the new product decision superseding older "siege game only / no
living world" target language below. The shipped baseline still has a campaign
mission selector, private co-op rooms and siege battles—not shared strategic
travel, world population or persistent world authority. This navigation PR
keeps those working and shows unbuilt destinations/actions as disabled. Do
not relabel the existing selector as a completed shared world or reactivate
removed world-worker code without a reviewed implementation plan.

## Affiliation correction (Alex, 2026-11-26)

A character is not automatically a faction ruler. Several characters and
parties may belong to the same house/faction. Houses and factions may belong
to larger kingdoms/empires. Character, party, political membership, leadership
rank and organizational hierarchy are separate concepts. The navigation must
not force faction founding during character creation. The existing account
chapter is a shared campaign banner, not an implemented political hierarchy.
Join/found affiliations and parent relationships stay disabled until built.
No membership migration or simulated hierarchy is part of this navigation PR.

## Entry

- Title → Play → existing leader roster, or creation for an empty roster.
- Roster remembers selection. Enter World opens the existing Earth campaign.
- Create Character is independent of entering an existing character.
- Creation has six steps and saves only on final Create leader.
- Existing faction identity and founder are retained when adding a leader.
- Campaign services include equipment, crafting, skills and unlocked companions.
- Multiplayer remains accessible through Invite, Party and Custom Games.

## Future surfaces

Unimplemented destinations and actions are disabled and labelled Coming soon.
Background specializations and custom hero adaptations cannot be selected.
Existing recruited heroes are not removed by the custom archetype roadmap.
World travel, persistence of map position, independent factions per leader,
shared strategic simulation and new character models are not shipped here.

## Archetype reference

The 20 entries in src/leader-archetypes.js use the descending pub_pick field
from https://api.opendota.com/api/heroStats, fetched 2026-11-26. This is a
point-in-time reference, not a lifetime or professional-play top-20 ranking.
Human designs should read as distinct space marines; aliens should retain
recognizable roles and silhouettes in an original science-fiction treatment.
No extracted third-party models are included.

## Compatibility

The menu foundation integrates PR160/161 on top of PR159. Explicit Ready,
all-loaded barriers, reconnect catch-up and authenticated relay are unchanged.
Faction/campaign data retains its existing account ownership. New leaders use
the existing authoritative inventory registration path when signed in.

## Visual pass — 2026-11-26

Roster and creator share an original carrier environment backplate (132KiB
WebP), a live character preview and warm-metal interaction accents. The plate
is illustration, not a newly implemented 3D world. On phones it ends behind
the character stage; controls continue on a quiet dark surface. The hero name
is primary; level/class move into supporting text. Character creation remains
separate from returning-player entry. Future destinations and affiliations
remain disabled, not fake working routes.

Human custom characters now reuse the existing authored marine-kit head
sculpts, mapped to the four identity families and supported hairstyles. This
is shared by creator, armory and gameplay. Missing kit assets retain a
procedural fallback. Preview loading refreshes the latest selection, never a
stale character. Shared template geometry is retained on disposal; materials
are per-instance. Armor adds chamfered plates and a stronger silhouette while
keeping every cosmetic/equipment layer, rig pivot and simulation field intact.
Robot identity is retained. This is not twenty new playable character kits.

Preview lighting uses warm key / cool rim, a contact shadow and restrained
motion; reduced-motion preference stops rotation. The long-term character
sculpt/material quality target remains above this incremental model pass.

Deployment correction: production's marine-kit URL was verified to return a
132-byte LFS pointer (HTTP200), not `glTF` bytes. Both compact runtime kit files
(<2MiB combined) are now ordinary Git binaries via exact `.gitattributes`
exceptions. This also restores the existing authored colony-troop path on
Git-based deployments. Do not infer actual asset delivery from HTTP200 alone;
verify the GLB magic bytes in preview/release checks.
