"""Reusable expedition infantry rigs. Stable role IDs and named limb pivots.

Other cultures retain their own weapons and shapes; only this kit selects
these industrial helmets, armor and three weapon silhouettes.
"""
import math
import european as legacy
from european import enemy, tree_round, tree_pine, rock, cliff
from combat import armor, loft
from frontier import HULL, FRAME, STEEL, PANEL, AMBER, LIGHT

ROLES = {
    'soldier': dict(width=1.32,plate=HULL,mark=AMBER,barrel=.47,pack=.33),
    'ranger': dict(width=.86,plate=PANEL,mark=0x91b596,barrel=.37,pack=.23),
    'sniper': dict(width=.95,plate=STEEL,mark=0xb39acb,barrel=.92,pack=.27),
}

def infantry(k,role):
    r=ROLES[role];w=r['width'];B,G=k.B,k.G
    for name,s in [('leg_l',-1),('leg_r',1)]:
        x=s*.11*w;L=k.part(name,origin=(x,.39,0))
        armor(L,FRAME,.13*w,.30,.14,x,.09,0)
        armor(L,r['plate'],.14*w,.14,.08,x,.17,.075)
        armor(L,FRAME,.18*w,.10,.26,x,.015,.045)
    armor(B,FRAME,.29*w,.15,.24,0,.35,0)
    armor(B,r['plate'],.43*w,.31,.29,0,.47,0)
    armor(B,PANEL,.26*w,.18,.065,0,.54,.155)
    B.box(r['mark'],.14,.045,.025,0,.66,.195)
    armor(B,FRAME,.28*w,r['pack'],.16,0,.48,-.21)
    for x in (-.09,.09): B.box(STEEL,.06,r['pack']*.7,.035,x,.51,-.305)
    # Sealed faceted helmet with one broad dark visor.
    loft(B,r['plate'],[(0,.13,.13,0),(.13,.15,.15,0),(.24,.10,.12,-.025)],y=.79)
    B.box(FRAME,.26,.07,.035,0,.88,.14)
    G.box(LIGHT,.20,.025,.025,0,.902,.163)
    for name,s in [('arm_l',-1),('arm_r',1)]:
        x=s*.245*w;A=k.part(name,origin=(x,.72,0))
        armor(A,FRAME,.13,.27,.14,x,.40,0)
        armor(A,r['plate'],.23*w,.17,.25,x,.66,0)
        armor(A,r['plate'],.14,.14,.15,x,.42,.035)
        if s==1:
            armor(A,FRAME,.14,.15,.35,x,.44,.18)
            Bx=x
            A.box(STEEL,.075,.075,r['barrel'],Bx,.50,.35+r['barrel']/2)
            A.box(r['mark'],.15,.10,.18,Bx,.51,.21)
            A.box(FRAME,.13,.13,.10,Bx,.47,.35+r['barrel'])
            if role=='sniper':
                A.box(FRAME,.08,.10,.27,Bx,.61,.28)
                G.box(LIGHT,.055,.04,.025,Bx,.65,.42)
        elif role=='soldier':
            armor(A,FRAME,.23,.33,.12,x,.31,.14)
            armor(A,HULL,.20,.29,.06,x,.33,.21)
            A.box(AMBER,.06,.22,.025,x,.36,.25)
    if role=='soldier':
        # Braced heavy silhouette: a broad rear power unit and shoulder collar.
        armor(B,FRAME,.49,.28,.22,0,.64,-.22)
        for x in (-.21,.21): armor(B,STEEL,.12,.25,.20,x,.73,-.20)
    if role=='sniper':
        # Low asymmetric sensor hood, distinct from the heavy's squared pack.
        armor(B,PANEL,.31,.09,.37,0,.98,-.04)
        armor(B,FRAME,.12,.50,.16,-.24,.40,-.23)
    if role=='ranger':
        B.box(FRAME,.035,.27,.035,-.10,.75,-.22)
        G.box(LIGHT,.045,.035,.045,-.10,1.0,-.22)

def trooper(k,pal): infantry(k,'soldier')
def ranger(k,pal): infantry(k,'ranger')
def marksman(k,pal): infantry(k,'sniper')

def hero(k,key,pal):
    if key!='scott':
        legacy.hero(k,key,pal)
        return
    B,G=k.B,k.G
    # Scott retains his red heavy hoverbike and gravity maul. The sealed
    # command helmet and powered shoulder yoke replace the knight crest.
    look=dict(legacy.HERO_LOOK['scott'],trim=HULL,bike=FRAME,glow=LIGHT)
    legacy._bike(B,G,look,1.02,.50,.27,.28,'heavy')
    armor(B,FRAME,.38,.22,.32,0,.49,-.12)
    armor(B,0x9f3432,.49,.36,.35,0,.68,-.10)
    armor(B,HULL,.30,.22,.07,0,.77,.095)
    B.box(AMBER,.17,.05,.025,0,.90,.14)
    armor(B,FRAME,.42,.28,.19,0,.76,-.34)
    loft(B,0x9f3432,[(0,.18,.16,0),(.20,.19,.17,0),(.29,.14,.14,-.015)],y=1.08,z=-.10)
    B.box(FRAME,.33,.09,.045,0,1.18,.065)
    G.box(LIGHT,.26,.035,.026,0,1.21,.095)
    for name,side in [('leg_l',-1),('leg_r',1)]:
        x=side*.22;L=k.part(name,origin=(x,.63,-.07))
        armor(L,FRAME,.16,.25,.22,x,.35,.03)
        armor(L,HULL,.17,.14,.11,x,.43,.16)
        armor(L,FRAME,.19,.10,.30,x,.28,.12)
    for name,side in [('arm_l',-1),('arm_r',1)]:
        x=side*.30;A=k.part(name,origin=(x,1.02,-.10))
        armor(A,HULL,.28,.22,.35,x,.91,-.10)
        armor(A,0x9f3432,.18,.29,.19,x,.65,.01)
        armor(A,STEEL,.20,.15,.24,x,.61,.09)
        if side==1:
            A.box(FRAME,.065,.82,.065,x+.10,.60,.12,rz=-.32)
            armor(A,FRAME,.47,.25,.30,x+.22,1.26,.12)
            armor(A,HULL,.10,.29,.34,x+.42,1.24,.12)
            G.box(LIGHT,.035,.16,.23,x+.48,1.30,.12)
