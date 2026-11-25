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
    # Stepped duplex: tall living pod, low utility wing, sheltered entrance.
    h=1.40+(t-1)*.24
    top=module(k,.88,1.43,h,x=-.30,z=-.10)
    shell(B,FRAME,.65,.17,1.05,.43,0,.05)
    shell(B,HULL,.62,.87+.10*t,1.02,.43,.17,.05)
    shell(B,PANEL,.68,.12,1.07,.43,1.04+.10*t,.05)
    window(B,G,-.30,.88,.64,.53)
    hatch(B,G,.43,.59,.18,.32,.76)
    # Pitched solar canopy is a large sloping plane, not a tiny roof prop.
    B.box(PANEL,.92,.10,1.12,-.30,top+.02,-.12,rz=-.16)
    for z in (-.46,-.12,.22): B.box(STEEL,.86,.025,.035,-.30,top+.08,z,rz=-.16)
    if t>=2: window(B,G,-.30,h-.12,.64,.50)
    if t>=3:
        shell(B,HULL,.59,.48,.69,.43,1.16+.10*t,-.12)
        window(B,G,.43,1.43+.10*t,.24,.33)
    if t>=4: mast(B,G,-.54,top,-.53,.67)


def hangar(B,w,d,h,z=0):
    # Faceted vaulted roof, extruded along the deep service bay.
    profile=[(-w/2,0),(-w/2,h*.60),(-w*.34,h*.91),(0,h),
             (w*.34,h*.91),(w/2,h*.60),(w/2,0)]
    verts=[(x,y+.18,zz+z) for zz in (-d/2,d/2) for x,y in profile]
    faces=[tuple(range(6,-1,-1)),tuple(range(7,14))]+[(i,(i+1)%7,(i+1)%7+7,i+7) for i in range(7)]
    B.emit(verts,faces,HULL,xform())
    for zz in (-d*.36,0,d*.36):
        for (x1,y1),(x2,y2) in zip(profile[1:5],profile[2:6]):
            dx,dy=x2-x1,y2-y1
            B.box(STEEL,math.hypot(dx,dy)+.03,.06,.08,(x1+x2)/2,(y1+y2)/2+.20,zz+z,rz=math.atan2(dy,dx))


def castle(k,t,pal):
    B,G=k.B,k.G
    # Broad command podium and offset communications spine. Occupies the
    # existing HQ square, not adjacent streets; tier changes add real mass.
    shell(B,FRAME,3.65,.26,3.45,y=.02,cut=.38)
    shell(B,STEEL,3.40,.32,3.16,y=.28,cut=.34)
    top=module(k,2.48,2.36,2.12+.28*t,x=-.12,z=-.22,y=.57)
    # A forward recessed deployment hall reads before any roof detail.
    shell(B,HULL,2.72,.74,1.10,-.10,.60,1.01)
    shell(B,FRAME,1.72,1.58,.30,-.10,.60,1.50)
    hatch(B,G,-.10,1.67,.62,1.20,1.40)
    B.box(AMBER,1.60,.16,.05,-.10,2.18,1.78)
    for x in (-1.38,1.18):
        shell(B,HULL,.34,1.85,.62,x,.56,1.17,cut=.08)
        G.box(LIGHT,.12,.06,.035,x,2.12,1.49)
    # Low reactor shoulder contrasts with the tall control spine.
    shell(B,FRAME,.84,1.46,1.65,1.23,.56,-.36)
    shell(B,PANEL,.79,.26,1.56,1.23,2.02,-.36)
    for z in (-.85,-.38,.09): B.prism(STEEL,8,.22,.22,.34,1.23,2.28,z)
    h=4.15+.43*t
    shell(B,FRAME,.88,h,.90,-1.18,.50,-.93,taper=.10)
    shell(B,HULL,.73,h-.2,.75,-1.18,.55,-.93,taper=.14)
    shell(B,EDGE,1.12,.23,1.05,-1.18,h+.5,-.93)
    shell(B,PANEL,.96,.48,.91,-1.18,h+.73,-.93)
    window(B,G,-1.18,h+.86,-.46,.69)
    mast(B,G,-1.18,h+1.21,-.93,.50)
    for x in (-.72,.25): window(B,G,x,2.66,1.0,.62)
    # Large roof plates, not a field of tiny greebles.
    for x in (-.68,.30): shell(B,PANEL,.82,.16,1.62,x,top,-.36,cut=.10)
    if t>=2: shell(B,HULL,1.48,.52,1.28,.18,top,-.42)
    if t>=3: shell(B,FRAME,1.18,.31,1.0,.18,top+.52,-.42)
    if t>=4:
        core=k.part('part_core',origin=(1.23,2.65,-.36),glow=True)
        core.prism(LIGHT,8,.16,.16,.45,1.23,2.65,-.36)


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
    h=1.35+.23*t
    c={'militia':AMBER,'ranger':0x83aa82,'sniper':0xa392bf}[trade]
    shell(B,FRAME,1.90,.18,1.80)
    if trade=='militia':
        hangar(B,1.76,1.65,h,z=-.08)
        B.box(FRAME,1.24,1.15,.08,0,.18,.78)
        hatch(B,G,0,.81,.18,.96,1.03)
        B.box(c,1.20,.16,.07,0,1.40,.81)
        if t>=2: shell(B,PANEL,.66,.26,.65,0,h+.12,-.35)
        if t>=3: shell(B,STEEL,.42,.48,.45,-.44,h,-.36)
    elif trade=='ranger':
        # Two low equipment wings around a recessed deployment porch.
        for x in (-.54,.54):
            shell(B,HULL,.65,h*.74,1.48,x,.18,-.12)
            shell(B,PANEL,.70,.12,1.52,x,h*.74+.18,-.12)
        shell(B,STEEL,1.65,.30,.60,0,h*.74+.25,-.48)
        hatch(B,G,0,.22,.18,.43,.94)
        B.box(c,1.65,.11,.09,0,h*.74+.18,.66)
        mast(B,G,.52,h*.74+.30,-.40,.72+.16*t)
        B.prism(PANEL,10,.36,.27,.13,.52,h*.74+.75,-.40,rx=.55)
    else:
        # Offset sensor tower and low crew wing; no shared square barracks box.
        top=module(k,.93,1.44,h+.32,x=-.35,z=-.12)
        shell(B,HULL,.66,.92,1.16,.46,.18,.02)
        shell(B,PANEL,.73,.13,1.23,.46,1.10,.02)
        shell(B,FRAME,.70,.18,.65,-.35,top,-.34)
        shell(B,c,.52,.48+.13*t,.48,-.35,top+.18,-.34)
        window(B,G,-.35,top+.35,-.08,.35)
        hatch(B,G,.46,.63,.18,.35,.80)
    for x in (-.67,.67): B.box(c,.15,.025,.29,x,.05,.85)


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
    # Runtime spins part_rotor around Z. Keep the vertical auger static and
    # animate its front-facing drive wheel on that established axis.
    B.prism(FRAME,10,.28,.17,1.1,.3,.2,-.2)
    for j in range(5): B.prism(STEEL,10,.31,.26,.08,.3,.25+j*.18,-.2,phase=j*.2)
    rotor=k.part('part_rotor',origin=(.3,1.2,.17))
    rotor.prism(STEEL,10,.25,.25,.10,.3,1.2,.17,rx=math.pi/2)
    rotor.box(AMBER,.41,.055,.055,.3,1.1725,.23)
    rotor.box(AMBER,.055,.41,.055,.3,.995,.23)
    hatch(B,G,-.52,.58,.22,.33,.85)


def workshop(k,t,pal):
    B,G=k.B,k.G
    # Open gantry with a rear service room and visible work deck.
    shell(B,FRAME,1.85,.18,1.73)
    shell(B,HULL,1.64,1.05+.18*t,.61,0,.18,-.51)
    hatch(B,G,-.38,-.18,.18,.40,.85)
    for x in (-.72,.72):
        B.box(STEEL,.20,1.72+.20*t,.24,x,.18,.42)
        shell(B,FRAME,.34,.22,.46,x,.18,.42,cut=.05)
    B.box(AMBER,1.70,.27,.42,0,1.90+.20*t,.42)
    B.box(FRAME,.14,.49,.14,.28,1.41+.20*t,.42)
    shell(B,STEEL,.78,.34,.67,0,.18,.24)
    B.box(PANEL,.88,.08,.72,0,.52,.24)
    for x in (.30,.64): B.prism(STEEL,8,.12,.12,.57+.18*t,x,1.23+.18*t,-.52)
    if t>=2: shell(B,PANEL,1.68,.13,.69,0,1.35+.18*t,-.51)
    if t>=3: B.box(EDGE,.16,.23,1.34,-.72,2.28,-.02)


def hero_forge(k,t,pal):
    B,G=k.B,k.G
    # Cylindrical fabrication chamber with open supporting yokes.
    B.prism(FRAME,10,.83,.83,.22,0,0,0)
    B.prism(HULL,10,.64,.55,1.02+.20*t,0,.22,0)
    B.prism(STEEL,10,.65,.65,.15,0,1.24+.20*t,0)
    G.prism(LIGHT,10,.50,.50,.27,0,1.39+.20*t,0)
    for x in (-.69,.69):
        shell(B,STEEL,.22,1.65+.30*t,.48,x,.22,0,cut=.04)
    shell(B,EDGE,1.65,.20,.66,0,1.87+.30*t,0)
    hatch(B,G,0,.65,.22,.42,.88)
    if t>=2: B.prism(PANEL,10,.47,.33,.36,0,1.66+.20*t,0)
    if t>=3: mast(B,G,-.68,2.97,0,.40)


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
