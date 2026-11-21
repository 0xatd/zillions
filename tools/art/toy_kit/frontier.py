"""Original expedition fortress kit. Game-space authoring; no sim changes.

Default culture asset IDs stay stable. Steel frames, chamfered ceramic armor,
recessed access doors and service machinery replace medieval silhouettes.
"""
import math
from kit import shade, xform

HULL=0xc3c9c5
EDGE=0xe2ded0
FRAME=0x34454e
STEEL=0x71848a
PANEL=0x456876
AMBER=0xeaa45a
LIGHT=0x86d9dc
DARK=0x202e36


def shell(B,c,w,h,d,x=0,y=0,z=0,cut=.22,taper=.05):
    """Eight-sided horizontal footprint with sloped shoulders, no roof pyramid."""
    cut=min(cut,w*.22,d*.22)
    ring=[(-w/2+cut,-d/2),(w/2-cut,-d/2),(w/2,-d/2+cut),(w/2,d/2-cut),
          (w/2-cut,d/2),(-w/2+cut,d/2),(-w/2,d/2-cut),(-w/2,-d/2+cut)]
    v=[(a,0,b) for a,b in ring]+[(a*(1-taper),h,b*(1-taper)) for a,b in ring]
    faces=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    B.emit(v,faces,c,xform(x,y,z))


def hatch(B,G,x,z,y=.16,w=.42,h=.91):
    # A dark recess with two inset sliding leaves and a deep lintel.
    B.box(FRAME,w+.18,h+.12,.13,x,y,z)
    B.box(DARK,w,h,.15,x,y+.025,z+.012)
    for s in (-1,1):
        B.box(STEEL,w*.45,h*.94,.035,x+s*w*.25,y+.04,z+.095)
    B.box(EDGE,w+.22,.12,.23,x,y+h+.08,z+.025)
    G.box(AMBER,.09,.08,.04,x+w*.5+.10,y+h*.61,z+.11)


def vent(B,x,y,z,w=.42,h=.28):
    B.box(DARK,w,h,.04,x,y,z)
    for i in range(4):
        B.box(STEEL,w*.87,.025,.055,x,y+.035+i*h*.21,z+.025)


def window(B,G,x,y,z,w=.4):
    B.box(FRAME,w+.08,.22,.05,x,y,z)
    G.box(shade(LIGHT,.72),w,.11,.055,x,y+.06,z+.015)


def module(k,w,d,h,x=0,z=0,y=0):
    B,G=k.B,k.G
    shell(B,FRAME,w+.06,.19,d+.06,x,y,z)
    shell(B,HULL,w,h,d,x,y+.16,z,taper=.07)
    shell(B,EDGE,w+.06,.12,d+.06,x,y+h+.16,z,taper=.04)
    shell(B,PANEL,w*.85,.15,d*.8,x,y+h+.28,z,taper=.10)
    for sx in (-1,1):
        B.box(STEEL,.12,h*.85,.15,x+sx*(w/2-.13),y+.2,z+d/2-.04)
    hatch(B,G,x,z+d/2+.025,y+.18)
    # Readable service faces on every side, not only the street-facing door.
    B.box(FRAME,w*.70,h*.56,.035,x,y+.40,z-d/2+.035)
    B.box(shade(HULL,.86),w*.61,h*.47,.045,x,y+.47,z-d/2+.025)
    B.box(AMBER,w*.23,.10,.052,x-w*.17,y+.55,z-d/2+.015)
    for sx in (-1,1):
        B.box(FRAME,.035,h*.53,d*.65,x+sx*(w/2-.035),y+.43,z)
        B.box(PANEL,.047,h*.40,d*.51,x+sx*(w/2-.026),y+.51,z)
        for j in range(3):
            B.box(STEEL,.058,.035,d*.40,x+sx*(w/2-.015),y+.59+j*.12,z)
    return y+h+.43


def mast(B,G,x,y,z,h=.8):
    B.box(FRAME,.07,h,.07,x,y,z)
    B.box(EDGE,.38,.13,.16,x,y+h*.58,z)
    G.box(LIGHT,.07,.07,.07,x,y+h,z)


def house(k,t,pal):
    B,G=k.B,k.G
    h=1.35+(t-1)*.21
    top=module(k,1.48,1.34,h,z=-.06)
    window(B,G,-.43,.67,.64,.23)
    vent(B,.38,top-.03,.29,.34)
    shell(B,STEEL,.45,.23,.55,-.38,top-.10,-.32,cut=.06)
    for i in range(3): B.box(DARK,.31,.025,.055,-.38,top+.135,-.48+i*.14)
    if t>=2: window(B,G,0,h-.03,.62,.76)
    if t>=3: shell(B,HULL,.65,.35,.64,.30,top-.10,-.25)
    if t>=4: mast(B,G,-.48,top,-.4,.66)


def castle(k,t,pal):
    B,G=k.B,k.G
    top=module(k,2.1,1.9,1.75+.25*t,z=.04)
    # Offset communications tower and low side power bay establish asymmetry.
    h=3.35+.48*t
    shell(B,FRAME,.93,.25,.93,-1.03,0,-.58)
    shell(B,HULL,.86,h-.2,.86,-1.03,.2,-.58,taper=.16)
    shell(B,EDGE,1.05,.18,1.05,-1.03,h,-.58)
    window(B,G,-1.03,h-.46,-.13,.58)
    mast(B,G,-1.03,h+.18,-.58,.72)
    shell(B,STEEL,.65,1.15+.18*t,1.22,1.16,.08,-.31)
    hatch(B,G,0,1.05,.18,.72,1.2)
    B.box(AMBER,.65,.12,.05,0,1.66,1.13)
    for x in (-.6,.6): window(B,G,x,1.52,1.0,.35)
    for x in (-.52,0,.52): shell(B,PANEL,.40,.10,.66,x,top,-.2,cut=.05)
    if t>=3: shell(B,EDGE,1.08,.52,.8,.25,top,-.35)
    if t>=4:
        core=k.part('part_core',origin=(1.16,2.1,-.31),glow=True)
        core.prism(LIGHT,8,.17,.17,.65,1.16,2.1,-.31)


def tower(k,t,pal):
    B,G=k.B,k.G
    h=2.25+.37*t
    shell(B,FRAME,1.48,.24,1.48)
    shell(B,HULL,1.22,h,1.22,y=.18,taper=.22)
    for x in (-.47,.47): B.box(STEEL,.18,h*.8,.22,x,.23,.52)
    shell(B,FRAME,1.48,.22,1.48,y=h+.18)
    shell(B,EDGE,1.42,.13,1.42,y=h+.4)
    vent(B,0,1.20,.57,.45,.4)
    G.box(LIGHT,.25,.06,.04,0,1.03,.63)
    head=k.part('part_turret',origin=(0,h+.53,0))
    shell(head,PANEL,.86,.46,.85,y=h+.53)
    for x in ([-.23,.23] if t>=3 else [0]):
        head.box(FRAME,.13,.14,1.0,x,h+.69,.63)
        head.box(STEEL,.19,.20,.21,x,h+.66,1.08)
    if t>=4: head.box(LIGHT,.48,.06,.06,0,h+.93,.42)


def camp(k,t,pal,trade='militia'):
    B,G=k.B,k.G
    h=1.4+.23*t
    top=module(k,1.77,1.51,h,z=-.14)
    hatch(B,G,-.17,.65,.18,.69,1.13)
    c={'militia':AMBER,'ranger':0x83aa82,'sniper':0xa392bf}[trade]
    B.box(c,.79,.17,.08,-.15,1.5,.69)
    if trade=='militia':
        shell(B,STEEL,.55,.58,.65,.45,top-.05,-.3)
        vent(B,.45,top+.07,.04,.36)
    elif trade=='ranger':
        mast(B,G,.48,top,-.35,.83)
        B.prism(PANEL,8,.29,.23,.13,.48,top+.43,-.35,rx=.55)
    else:
        shell(B,STEEL,.37,.90,.39,.50,top-.03,-.40)
        window(B,G,.50,top+.57,-.18,.25)
    for x in (-.67,.67): B.box(AMBER,.15,.025,.29,x,.05,.88)


def farm(k,t,pal):
    B,G=k.B,k.G
    shell(B,FRAME,1.85,.14,1.85)
    # Hydroponic grow beds and an environmental service tower.
    for z in (-.56,0,.56):
        shell(B,STEEL,1.15,.23,.40,-.23,.14,z,cut=.06)
        B.box(DARK,1.02,.06,.27,-.23,.37,z)
        for i in range(5): B.ico(0x7da46d,.095,-.65+i*.21,.47,z,sx=.7,sy=1,sz=1)
        for x in (-.78,.32): B.box(EDGE,.04,.62,.04,x,.14,z)
        B.box(EDGE,1.14,.06,.13,-.23,.76,z)
        G.box(shade(LIGHT,.75),1.02,.025,.06,-.23,.735,z)
    shell(B,HULL,.40,1.2+.25*t,1.24,.66,.14,-.16,cut=.08)
    vent(B,.66,.85,.48,.25)
    if t>=2: B.prism(STEEL,10,.21,.21,.65,.63,1.3+.25*t,-.5)


def mill(k,t,pal):
    B,G=k.B,k.G
    top=module(k,1.25,1.25,1.0+.2*t,z=-.12)
    h=2.55+.3*t
    shell(B,STEEL,.45,h,.42,0,.18,-.2,taper=.30)
    rotor=k.part('part_rotor',origin=(0,h,.18))
    rotor.prism(FRAME,12,.52,.52,.20,0,h,.18,rx=math.pi/2)
    rotor.prism(STEEL,12,.42,.42,.22,0,h,.19,rx=math.pi/2)
    for i in range(5):
        a=i*math.tau/5
        rotor.box(PANEL,.12,.40,.07,0,h,.32,rz=a)
    rotor.prism(AMBER,8,.13,.10,.12,0,h,.37,rx=math.pi/2)
    for x in (-.45,.45): shell(B,PANEL,.32,.09,.8,x,top,-.10,cut=.04)


def mine(k,t,pal):
    B,G=k.B,k.G
    shell(B,FRAME,1.8,.20,1.6)
    shell(B,HULL,.65,1.1+.2*t,1.3,-.52,.20,-.1)
    h=1.8+.24*t
    for x in (-.05,.65): shell(B,STEEL,.17,h,.22,x,.20,-.2,cut=.03)
    B.box(AMBER,.94,.22,.42,.3,h,-.2)
    rotor=k.part('part_rotor',origin=(.3,1.1,-.2))
    rotor.prism(FRAME,10,.28,.17,1.1,.3,.2,-.2)
    for j in range(5): rotor.prism(STEEL,10,.31,.26,.08,.3,.25+j*.18,-.2,phase=j*.2)
    hatch(B,G,-.52,.58,.22,.33,.85)


def workshop(k,t,pal):
    B,G=k.B,k.G
    top=module(k,1.75,1.54,1.20+.25*t,z=-.1)
    hatch(B,G,-.25,.70,.18,.75,1.0)
    for x in (.30,.65):
        B.prism(STEEL,8,.13,.13,.65,x,top,-.4)
        B.prism(FRAME,8,.18,.18,.10,x,top+.65,-.4)
    B.box(AMBER,.60,.16,.06,-.25,1.35,.74)


def hero_forge(k,t,pal):
    B,G=k.B,k.G
    top=module(k,1.70,1.55,1.2+.2*t)
    shell(B,FRAME,.82,.20,.9,y=top-.05)
    B.prism(STEEL,10,.33,.33,.65,0,top+.15,0)
    G.prism(LIGHT,10,.28,.28,.23,0,top+.38,0)
    shell(B,EDGE,.8,.12,.8,y=top+.80)


def outpost(k,t,pal):
    tower(k,t,pal)
    hatch(k.B,k.G,0,.64,.20,.38,.82)
    for x in (-.55,.55): shell(k.B,PANEL,.30,.42,.52,x,.20,.52,cut=.05)


def wall_seg(k,t,pal):
    B,G=k.B,k.G
    h=1.45+.27*t
    B.box(FRAME,1.04,.22,.68,.5,0,0)
    shell(B,HULL,1.04,h,.56,.5,.18,0,cut=.04,taper=.12)
    B.box(STEEL,1.04,.17,.64,.5,h+.18,0)
    B.box(EDGE,1.04,.12,.58,.5,h+.35,0)
    for s in (-1,1):
        B.box(PANEL,.76,h*.57,.035,.5,.56,s*.278)
        B.box(AMBER,.15,.12,.04,.80,.35,s*.31)
        B.box(STEEL,.06,h*.6,.05,.10,.49,s*.29)
    if t>=3: G.box(LIGHT,.26,.055,.025,.5,h+.20,.334)


def wall_post(k,t,pal):
    B,G=k.B,k.G
    h=1.85+.27*t
    shell(B,FRAME,.86,.22,.86)
    shell(B,STEEL,.71,h,.71,y=.18,taper=.12)
    shell(B,EDGE,.83,.18,.83,y=h+.18)
    for z in (-.36,.36):
        B.box(PANEL,.42,.73,.04,0,h*.46,z)
        G.box(LIGHT,.15,.055,.035,0,h+.04,z)


def gatehouse(k,t,pal):
    B,G=k.B,k.G
    h=2.65+.25*t
    # Clear centre +/- .91: wider than the former stone pylons.
    # Paired front/rear jambs give the entrance real passage depth.
    for s in (-1,1):
        x=s*1.36
        shell(B,FRAME,.90,.20,1.32,x)
        shell(B,HULL,.81,h,1.20,x,.18,0,taper=.07)
        shell(B,EDGE,.91,.16,1.32,x,h+.18)
        for z in (-.50,.50):
            B.box(STEEL,.13,h*.86,.16,x-s*.32,.20,z)
            G.box(LIGHT,.055,.65,.035,x-s*.25,.66,z+(.10 if z>0 else -.10))
        # Retracted blast-door leaves are visibly stored in the side housings.
        B.box(FRAME,.10,1.70,.83,x-s*.35,.20,0)
        vent(B,x,1.70,.61,.46,.40)
        B.box(AMBER,.36,.18,.045,x,.42,.64)
    # Raised door cassette, overhead control room and deep projecting canopy.
    shell(B,FRAME,2.0,.28,1.20,0,2.12)
    shell(B,HULL,2.10,.55,1.18,0,2.40)
    shell(B,EDGE,2.22,.13,1.40,0,2.95)
    for z in (-.62,.62):
        B.box(DARK,1.26,.22,.05,0,2.56,z)
        G.box(shade(LIGHT,.65),1.05,.075,.055,0,2.64,z)
        B.box(AMBER,.56,.11,.06,0,2.28,z)
    for s in (-1,1):
        B.box(STEEL,.16,1.9,1.18,s*.94,.16,0)
        B.box(AMBER,.18,.018,1.25,s*.78,.015,0)
    if t>=2: mast(B,G,-1.36,h+.35,-.25,.70)
    if t>=3: shell(B,PANEL,.64,.40,.8,1.36,h+.35,0)
