"""Build the toy kit GLBs.

  blender --background --python tools/art/toy_kit/build.py -- [--culture european] [--out assets/kit]

Writes assets/kit/<culture>/<asset>.glb plus manifest.json listing every
asset and its tier. Deterministic: no randomness anywhere.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from kit import Kit, export_kit  # noqa: E402
from cultures import CULTURES  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

ENEMY_ACCENTS = {
    'walker': 0x86c24e, 'runner': 0xd0c052, 'brute': 0xa060d8, 'spitter': 0xc9d84e,
    'burrower': 0x8a6ad0, 'sieger': 0xd0762e, 'caller': 0x4ec9a8,
}


def jobs(culture):
    c = CULTURES[culture]
    B, U, pal = c['buildings'], c['units'], c['palette']
    out = []
    for t in (1, 2, 3, 4):
        out.append((f'castle_t{t}', lambda k, t=t: B.castle(k, t, pal)))
        out.append((f'tower_t{t}', lambda k, t=t: B.tower(k, t, pal)))
        out.append((f'house_t{t}', lambda k, t=t: B.house(k, t, pal)))
        out.append((f'outpost_t{t}', lambda k, t=t: B.outpost(k, t, pal)))
    for t in (1, 2, 3):
        out.append((f'farm_t{t}', lambda k, t=t: B.farm(k, t, pal)))
        out.append((f'mill_t{t}', lambda k, t=t: B.mill(k, t, pal)))
        out.append((f'mine_t{t}', lambda k, t=t: B.mine(k, t, pal)))
        out.append((f'workshop_t{t}', lambda k, t=t: B.workshop(k, t, pal)))
        out.append((f'hero_forge_t{t}', lambda k, t=t: B.hero_forge(k, t, pal)))
        for trade in ('militia', 'ranger', 'sniper'):
            out.append((f'camp_{trade}_t{t}', lambda k, t=t, trade=trade: B.camp(k, t, pal, trade)))
    out.append(('unit_soldier', lambda k: U.trooper(k, pal)))
    out.append(('unit_ranger', lambda k: U.ranger(k, pal)))
    out.append(('unit_sniper', lambda k: U.marksman(k, pal)))
    for h in ('scott', 'alexander', 'danny'):
        out.append((f'hero_{h}', lambda k, h=h: U.hero(k, h, pal)))
    for e, acc in ENEMY_ACCENTS.items():
        out.append((f'enemy_{e}', lambda k, e=e, acc=acc: U.enemy(k, e, acc)))
    out.append(('prop_tree_round', lambda k: U.tree_round(k, pal)))
    out.append(('prop_tree_pine', lambda k: U.tree_pine(k, pal)))
    out.append(('prop_rock_a', lambda k: U.rock(k, pal, 0)))
    out.append(('prop_rock_b', lambda k: U.rock(k, pal, 1)))
    out.append(('prop_cliff', lambda k: U.cliff(k, pal)))
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    culture = 'european'
    out_root = os.path.join(ROOT, 'assets', 'kit')
    for i, a in enumerate(argv):
        if a == '--culture':
            culture = argv[i + 1]
        if a == '--out':
            out_root = os.path.abspath(argv[i + 1])
    out_dir = os.path.join(out_root, culture)
    names = []
    for name, fn in jobs(culture):
        k = Kit(name)
        fn(k)
        export_kit(k, out_dir)
        names.append(name)
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump({'culture': culture, 'status': CULTURES[culture]['status'], 'assets': names}, f, indent=1)
        f.write('\n')
    print(f'toy kit: {len(names)} assets -> {out_dir}')


main()
