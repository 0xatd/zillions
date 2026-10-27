"""Culture registry: a culture = a palette + a building shape set + a unit set.

Only `european` is fully built (it is the default). The other three are
registered with their own palettes so the kit pipeline is ready for them;
until their shape sets are authored they borrow the European builders, which
makes them palette previews only (`--culture asian` etc.), not shipped art.
See docs/toy-kit.md and the art Page for the four-culture proposal.
"""
import european

CULTURES = {
    'european': {
        'status': 'built',
        'palette': european.PALETTE,
        'buildings': european,     # castle, tower, house, farm, mill, mine, camp, outpost, workshop, hero_forge
        'units': european,         # trooper, ranger, marksman, hero(), enemy()
    },
    'asian': {
        'status': 'proposal',
        'palette': dict(european.PALETTE, stone=0xf1e6d8, stone2=0xd9c4ae, stone3=0x9a6a52, roof=0x2f6b62,
                        roof2=0x24524c, trim=0xe6b94a, banner=0xc8463a, accent=0xc8463a, glow=0xffb86b,
                        cloth=0xc8463a),
        'buildings': european, 'units': european,
    },
    'south_american': {
        'status': 'proposal',
        'palette': dict(european.PALETTE, stone=0xd9cfa8, stone2=0xb9ae84, stone3=0x7f7a5a, roof=0x3f8a5a,
                        roof2=0x2f6a46, trim=0xf2b632, banner=0x1f9a8a, accent=0xd8642a, glow=0xffd34a,
                        cloth=0x1f9a8a),
        'buildings': european, 'units': european,
    },
    'middle_eastern': {
        'status': 'proposal',
        'palette': dict(european.PALETTE, stone=0xf3dcb2, stone2=0xe2c08c, stone3=0xb98e5a, roof=0x2f8fb0,
                        roof2=0x22708c, trim=0xf0c75a, banner=0x2f8fb0, accent=0xb8432f, glow=0x7fe8ff,
                        cloth=0xe9e3d3),
        'buildings': european, 'units': european,
    },
}
