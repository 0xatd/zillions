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
    'soldier': dict(width=1.18,plate=HULL,mark=AMBER,barrel=.47,pack=.33),
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
    if role=='ranger':
        B.box(FRAME,.035,.27,.035,-.10,.75,-.22)
        G.box(LIGHT,.045,.035,.045,-.10,1.0,-.22)

def trooper(k,pal): infantry(k,'soldier')
def ranger(k,pal): infantry(k,'ranger')
def marksman(k,pal): infantry(k,'sniper')

def hero(k,key,pal):
    legacy.hero(k,key,pal)
    if key=='scott':
        # Preserve Scott's gravity-maul/bike identity; establish armored weight
        # with broad structural plates rather than more oversized body scale.
        for x in (-.29,.29):
            armor(k.B,STEEL,.20,.20,.32,x,.90,-.10)
            k.B.box(AMBER,.12,.045,.025,x,1.05,.07)
