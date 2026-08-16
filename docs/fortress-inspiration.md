# Fortress Inspiration

Why Zillions' cities are shaped the way they are, and where each rule came from.

The short version: **for almost all of history, nobody built a wall where the
ground already was one.** A fort is a negotiation between a plan and a place.
Two forts built to the same doctrine, a valley apart, do not look alike — one
walls three hundred metres of open ridge, the other walls forty metres of neck
between two cliffs and lets the sea do the rest.

That is the design target. A base in Zillions is a PLAN (a silhouette, a gate
count, a street pattern — level-specific, in `CITY_PLANS`) finished by the
GROUND it lands on (`generatePlots` reads the terrain under the rampart line).
Pick a different site and you get a different fortress out of the same plan.

---

## 1. Anchor the line on impassable ground

**Promontory and spur forts.** A promontory fort takes a headland and walls
only the landward neck; the cliffs are the other three sides. Countisbury
Castle in Devon used sea cliffs to the north and river gorges to the south, and
put its rampart and ditch across the single gentle approach from the east.
Bosigran in Cornwall runs one wall between two granite cliffs and calls it done.
Spur castles do the same on an inland ridge: steep on three sides, built on one.

**Field armies did it too.** Napoleonic and Civil War fieldworks were
"securely anchored on impassable terrain features such as a wide river, large
swamp, or steep ridge" — you hold the gap and let the marsh hold the flank.

**Great Zimbabwe** is the purest version: dry-stone walls run between the
granite kopjes and around natural boulders, incorporating them into the wall
rather than replacing them.

**In game:** the rampart band is *not* levelled when a city is founded. Where
the silhouette crosses crag, deep water or thick wood, no wall plot is created —
the land is the wall, and it is free and indestructible. Wall plots are only
raised across the gaps. Because barrier cost scales per tile, a site where the
ground closes half the line costs about half as much to wall. `naturalShare`
across the campaign's 15 city sites ranges from about 2% to 77%.

## 2. The gaps are the gates, and the gates are the design

**Dún Aonghasa**, on the Aran cliffs: three dry-stone walls running cliff to
cliff, a chevaux-de-frise of thousands of set stone spikes outside them, and an
entrance of narrow passages that "funnel visitors into smaller enclosures" so
defenders control the flow.

**Maiden Castle**: three to four lines of bank and ditch, and an east entrance
of overlapping ramparts and staggered passages that lengthen the walk under
fire. Excavators found pits of sling stones at the gateways — the whole entry
sequence exists to keep attackers in range longer.

**Mycenae's Lion Gate**: a bastion on the right of the approach, so attackers
must expose their unshielded side, entering a courtyard 15m × 7m that limits how
many can reach the doors at once.

**In game:** only an open stretch of rampart can carry a gate, so terrain
decides how many entrances a city has — 2 to 4 depending on the site. Every gate
is a **ward**: two flanking towers and its own muster camp, so the squads that
hold that gate and the squads that push out of it start at the gate. The
plan's two principal gates are always cut open, so a site can never be sealed
in with no way to sortie.

## 3. Layers, not a line

**Krak des Chevaliers**: a spur castle rebuilt concentric — outer and inner
enceintes, the outer overlooked from the inner at every point, the space between
them inside easy bowshot. Its entrance ramp runs 137m with a hairpin turn
(a "bent entrance", from Byzantine practice) covered from several towers.

**Japanese yamashiro**: ridges cut with `horikiri` trenches so the approach
cannot come along the ridgeline, flattened `kuruwa` baileys stacked in sequence,
and `kirigishi` — slopes deliberately steepened — as the most important element
of the whole design. Later castles curved their earthworks so an enemy at the
wall was shot from the side as well as the front.

**In game:** two plans (square fort, throat keep) carry an `inner` ward — a
second wall around the Keep with its own gates and towers standing in the yard
*between* the walls. Where there is an inner ward, gate roads bend to the inner
gate before reaching the plaza: a longer walk, under the towers.

## 4. Cheap works out where the land pinches

**Abatis and palisade.** Felled trees, sharpened and interlaced, laid across a
gap: the cheapest fortification there is. Used since antiquity, and decisive at
Carillon in 1758, where 3,600 French troops behind a dense abatis beat 16,000.
The doctrine is always the same — put the obstacle where the ground already
narrows, cover it with fire, and make the enemy come through it.

**In game:** `TerrainField._findChokepoints` reads the map for gaps 2–9 tiles
wide pinched between two impassable masses with open ground on both sides.
The three best of them near the city become **outer works**: a palisade plot
spanning the gap plus a watchtower behind it. A barrier costs by the tile, so a
three-tile fence across a pass is nearly free — and it always carries a gate, so
your own squads march through while the horde funnels under the tower.

## 5. What the player is choosing between

Every map offers three city sites, and after this pass they are genuinely
different fortresses:

- a shore or crag site where the ground closes most of the wall line, but the
  buildable ground is thin;
- an open crossroads where you build every metre of wall but can expand and
  push in every direction;
- ore inside the walls: rich, and worth taking from you.

Riding up to a flag surveys it and says so, including what fraction of the wall
line that ground closes for you. That is the Masada/Sigiriya bargain in
miniature — a site can be nearly impregnable and still lose you the game if it
cannot feed an army.

---

## Sources

- [Countisbury Castle promontory fort, Historic England](https://historicengland.org.uk/listing/the-list/list-entry/1020807)
- [Promontory fort](https://grokipedia.com/page/Promontory_fort) · [Spur castle](https://grokipedia.com/page/Spur_castle)
- [Dún Aonghasa, Heritage Ireland](https://heritageireland.ie/places-to-visit/dun-aonghasa/) · [Irish Archaeology](https://irisharchaeology.org/dun-aonghasa/)
- [Krak des Chevaliers](https://en.wikipedia.org/wiki/Krak_des_Chevaliers) · [Entrance system, Ministère de la Culture](https://archeologie.culture.gouv.fr/crac-chevaliers/en/redesign-entrance-system) · [Bent entrance](https://en.wikipedia.org/wiki/Bent_entrance)
- [Maiden Castle history, English Heritage](https://www.english-heritage.org.uk/visit/places/maiden-castle/history/) · [The battlemap entrance of Maiden Castle](https://moltensulfur.com/post/the-battlemap-entrance-of-maiden-castle/)
- [Great Zimbabwe, The Met](https://www.metmuseum.org/essays/great-zimbabwe) · [Smarthistory](https://smarthistory.org/great-zimbabwe/)
- [Engineering defense at Japan's mountain castles, Nippon.com](https://www.nippon.com/en/japan-topics/g00731/engineering-defense-at-japan%E2%80%99s-mountain-castles.html) · [Kuruwa](https://grokipedia.com/page/kuruwa)
- [Fortifications of Mycenae](https://en.wikipedia.org/wiki/Fortifications_of_Mycenae) · [Lion Gate](https://en.wikipedia.org/wiki/Lion_Gate)
- [Abatis](https://en.wikipedia.org/wiki/Abatis) · [Glossary of fortification terms, American Battlefield Trust](https://www.battlefields.org/learn/articles/glossary-fortification-terms)
