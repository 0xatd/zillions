# Leader navigation

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
