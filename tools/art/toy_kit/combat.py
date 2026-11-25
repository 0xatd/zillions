"""Painted frontier combat family. Ground-centred, +Z facing, named pivots.

Broad sculpted planes carry the value grouping; no texture or new material.
The crowd uses low-ring lofts rather than subdivided spheres.
"""
import math
from kit import shade, xform


def loft(P, c, rings, x=0, y=0, z=0, n=8, rx=0, ry=0, rz=0):
    """Rings are (height, half-width, half-depth, forward offset)."""
    vs = [(math.cos((i+.5)*math.tau/n)*w, h,
           math.sin((i+.5)*math.tau/n)*d+off)
          for h, w, d, off in rings for i in range(n)]
    M = xform(x,y,z,rx,ry,rz)
    P.emit(vs, [tuple(range(n-1,-1,-1))], shade(c,.78), M)
    for j in range(len(rings)-1):
        for i in range(n):
            q = (i+1)%n
            # Painted folds: consistent light ridge, cool dark lower planes.
            value = .89 + .10*j/max(1,len(rings)-2) + .055*math.cos(i*math.tau/n)
            P.emit(vs, [(j*n+i,j*n+q,(j+1)*n+q,(j+1)*n+i)], shade(c,value), M)
    P.emit(vs, [tuple((len(rings)-1)*n+i for i in range(n))], shade(c,1.08), M)


def armor(P,c,w,h,d,x=0,y=0,z=0,rx=0,ry=0,rz=0):
    loft(P,c,[(0,w*.4,d*.4,0),(h*.18,w*.5,d*.5,0),
              (h*.78,w*.5,d*.5,0),(h,w*.36,d*.35,0)],x,y,z,rx=rx,ry=ry,rz=rz)


def cloth(P,c,top,z,w,length):
    # Three billowing folds with an uneven hem, solid front/back surfaces.
    for i in range(3):
        xx=(i-1)*w*.3
        verts=[(xx-w*.18,top,z),(xx+w*.18,top,z),
               (xx+w*.23,top-length+(i%2)*.055,z-.15),
               (xx,top-length-.015,z-.22),(xx-w*.23,top-length+(i%2)*.055,z-.15)]
        P.emit(verts,[(0,1,2,3,4),(4,3,2,1,0)],shade(c,.84+i*.09),xform())


def infantry(k,pal,role):
    B,G=k.B,k.G
    steel=0xb6c4cf; dark=pal['dark']; gold=0xc7a465
    coat={'soldier':0x3b6091,'ranger':0x456b49,'sniper':0x645784}[role]
    for name,x in [('leg_l',-.105),('leg_r',.105)]:
        L=k.part(name,origin=(x,.37,0))
        loft(L,0x525d66,[(0,.066,.07,0),(.27,.075,.075,0)],x,.09)
        armor(L,dark,.17,.12,.25,x,0,.035)
        armor(L,steel if role=='soldier' else 0x7f7765,.12,.13,.055,x,.16,.07)
    loft(B,coat,[(0,.17,.12,0),(.13,.16,.12,0),(.35,.235,.14,0),(.40,.16,.1,0)],y=.3)
    B.prism(dark,8,.18,.18,.055,0,.4,0,sz=.74,phase=math.pi/8)
    B.box(gold,.075,.06,.035,0,.4,.14)
    if role=='soldier':
        armor(B,steel,.31,.25,.09,0,.47,.12)
        # A curved sallet and a dark visor, not a cube head.
        loft(B,steel,[(0,.12,.13,0),(.10,.17,.16,0),(.24,.15,.14,-.01),(.29,.06,.08,-.02)],y=.72)
        B.box(dark,.25,.055,.035,0,.83,.15)
        G.box(pal['glow'],.17,.022,.025,0,.848,.17)
        armor(B,gold,.055,.14,.23,0,.99,-.01)
    else:
        loft(B,coat,[(0,.17,.14,-.01),(.17,.18,.17,-.025),(.29,.08,.11,-.06),(.34,.025,.03,-.10)],y=.71)
        armor(B,pal['skin'] if role=='ranger' else dark,.20,.16,.07,0,.76,.13)
        B.box(dark,.18,.035,.025,0,.84,.17)
        G.box(pal['glow'] if role=='ranger' else 0xbda8e0,.055,.025,.025,.05,.85,.18)
        cloth(B,coat,.72,-.12,.43,.48)
    for name,sx in [('arm_l',-1),('arm_r',1)]:
        A=k.part(name,origin=(sx*.23,.67,0))
        loft(A,coat,[(0,.055,.06,0),(.2,.07,.07,0)],sx*.24,.39)
        armor(A,steel if role=='soldier' else coat,.21,.15,.24,sx*.23,.62,-.01)
        armor(A,gold if role=='soldier' else 0x8b7860,.12,.12,.15,sx*.24,.38,.02)
        if sx==-1 and role=='soldier':
            # Convex kite shield with a clear tapered lower point.
            loft(A,gold,[(0,.015,.025,0),(.14,.19,.045,0),(.43,.20,.045,0),(.49,.13,.03,0)],-.3,.22,.16)
            loft(A,coat,[(0,.02,.025,0),(.13,.16,.035,0),(.37,.17,.035,0),(.42,.10,.025,0)],-.3,.26,.20)
            A.box(gold,.035,.30,.025,-.3,.34,.24)
        elif sx==-1 and role=='ranger':
            # Bent bow limbs, separated from the straight luminous string.
            for side in (-1,1):
                A.prism(0xb7a27c,5,.026,.018,.32,-.27,.46,.16,rz=side*.16,rx=side*.35+(math.pi if side<0 else 0))
            A.box(dark,.045,.12,.055,-.27,.40,.16)
        elif sx==1 and role!='ranger':
            length=.79 if role=='sniper' else .53
            armor(A,dark,.12,.13,.32,.24,.42,.18)
            A.prism(steel,6,.035,.027,length,.24,.48,.23,rx=math.pi/2)
            armor(A,coat,.14,.09,.19,.24,.53,.17)
            A.box(gold,.09,.09,.07,.24,.435,.23+length)
            if role=='sniper':
                A.prism(dark,6,.04,.04,.20,.24,.63,.25,rx=math.pi/2)
        if role=='ranger' and sx==1:
            A.prism(0xc6b38c,5,.016,.01,.40,.23,.45,.10,rx=math.pi/2)
    if role=='ranger':
        loft(B,0x826744,[(0,.07,.07,0),(.32,.075,.075,0)],.13,.43,-.18,rz=-.18)
        for dx in (-.035,.035): B.prism(0xd8c8a2,4,.012,.012,.18,.13+dx,.68,-.18)


def enemy(k,key,accent):
    B=k.B; E=k.part('eyes',glow=True)
    dark=0x30283e; hide=0x62516e; shell=0x85738d; bone=0xb7a68c
    # (hip, shoulder, width, depth, head height, forward lean)
    h,pv,w,d,head,lean={
        'walker':(.30,.71,.21,.16,.79,.09),
        'runner':(.29,.59,.17,.15,.62,.23),
        'brute':(.29,.83,.34,.23,.89,.14),
        'spitter':(.28,.70,.22,.18,.88,.11),
        'burrower':(.18,.47,.27,.25,.49,.20),
        'sieger':(.28,.78,.32,.28,.62,.30),
        'caller':(.40,.88,.17,.15,.99,.04),
    }[key]
    for sx in (-1,1):
        x=sx*w*.53
        loft(B,dark,[(0,w*.25,d*.34,0),(h*.55,w*.22,d*.26,-.025),(h,w*.3,d*.34,0)],x,.025)
        armor(B,dark,w*.58,.08,d*.95,x,0,.04)
    loft(B,hide,[(0,w*.64,d*.7,0),(.20,w,d,lean*.25),
                 (pv-h,w*.92,d*.85,lean*.7),(pv-h+.06,w*.65,d*.6,lean)],y=h)
    # Layered dorsal shell follows the curved spine; restrained role accent.
    for j in range(3 if key in ('brute','sieger') else 2):
        yy=h+.15+j*.12
        armor(B,accent if j==1 else shell,w*1.8,.13,d*.8,0,yy,-d*.72+j*.025,rx=-.25)
    loft(B,shell,[(0,.09,.10,0),(.08,.14,.15,.015),(.19,.11,.12,-.01),(.23,.045,.06,-.03)],y=head-.06,z=lean)
    armor(B,dark,.17,.065,.11,0,head-.065,lean+.10)
    for sx in (-1,1):
        E.box(0xe5d7b3,.045,.032,.028,sx*.063,head+.055,lean+.15)
        B.prism(bone,4,.023,0,.09,sx*.07,head-.07,lean+.15,rx=math.pi)
    A=k.part('arms',origin=(0,pv,.02))
    armw=.105 if key in ('brute','sieger') else .06
    for sx in (-1,1):
        x=sx*(w+.04)
        armor(A,shell,armw*2.5,.17,armw*2.8,x,pv-.06,lean*.4)
        loft(A,hide,[(0,armw,armw,0),(.18,armw*.8,armw*.75,.03),(.36,armw*.6,armw*.8,.08)],
             x,pv-.10,lean*.4,rx=math.pi/2+.35,rz=sx*.18,n=6)
        for claw in (-1,1):
            A.prism(bone,4,.023 if key!='burrower' else .04,0,.13 if key!='burrower' else .25,
                    x+claw*armw*.45,pv-.2,.37+lean*.4,rx=math.pi/2+.7)
    if key=='spitter':
        loft(B,accent,[(0,.12,.10,0),(.17,.25,.24,0),(.32,.17,.15,0),(.39,.05,.06,0)],y=.46,z=-.20)
    if key in ('brute','sieger','burrower'):
        for sx in (-1,1):
            B.prism(bone,5,.065,0,.26,sx*w*.78,pv,-.06,rz=-sx*.5,rx=-.3)
    if key=='runner':
        for j in range(3): B.prism(accent,4,.05,0,.20-j*.03,0,.55+j*.07,-.15-j*.08,rx=-.7)
    if key=='caller':
        for sx in (-1,0,1):
            B.prism(accent,5,.045,0,.28 if sx else .35,sx*.14,1.12,-.03,rz=-sx*.45)
        cloth(B,dark,.76,-.12,.42,.45)
