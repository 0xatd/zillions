"""Culture registry: a culture = a palette + a building shape set + a unit set.

All four are built. `european` is the default. Each culture authors its own
keep, towers, houses, camps, ramparts (wall segment, post, gatehouse) and
line troops; the economy buildings, outposts, heroes, horde and props are
shared builders re-coloured by the culture palette.
"""
import european
import asian
import south_american
import middle_eastern

CULTURES = {
    'european': {
        'status': 'built',
        'palette': european.PALETTE,
        'buildings': european,     # castle, tower, house, farm, mill, mine, camp, outpost, workshop, hero_forge
        'units': european,         # trooper, ranger, marksman, hero(), enemy()
    },
    'asian': {
        'status': 'built',
        'palette': asian.PALETTE,
        'buildings': asian, 'units': asian, 'walls': asian,
    },
    'south_american': {
        'status': 'built',
        'palette': south_american.PALETTE,
        'buildings': south_american, 'units': south_american, 'walls': south_american,
    },
    'middle_eastern': {
        'status': 'built',
        'palette': middle_eastern.PALETTE,
        'buildings': middle_eastern, 'units': middle_eastern, 'walls': middle_eastern,
    },
}
