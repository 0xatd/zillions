// Core-kit implementations use our own presentation and siege-scale distances.
// They are NOT the full Dota item/facet/talent system. Selection is gated until
// the kit's simulation, controls and recruitment checks have passed.
export const LINA_KIT = {
  kitStatus:'core',key:'lina',name:'Lina',icon:'🔥',color:0xd7472a,trim:0xffd77e,
  tagline:'Fire waves, delayed stuns and a decisive single-target bolt.',
  hp:350,dmg:35,range:7,rof:1,speed:4.5,noise:12,
  levelHp:32,levelDmg:4,regen:2,mana:650,manaRegen:5,
  aura:null,
  passives:[],fierySoul:{attackSpeed:[.07,.14,.28],moveSpeed:[.01,.015,.025]},
  abilities:[
    {key:'dragon_slave',name:'Dragon Slave',icon:'🔥',spell:'wave',target:'point',cd:[11,10,8],mana:[90,100,120],range:14,radius:1.6,speed:16,damage:[65,125,245],types:{thermal:1},desc:'Aim a travelling wave of fire. Each enemy is hit once.'},
    {key:'light_strike_array',name:'Light Strike Array',icon:'☀',spell:'blast',target:'point',cd:[13,11,7],mana:[100,110,130],range:9,radius:2.5,delay:.5,stun:[1.2,1.6,2.4],damage:[80,125,215],types:{thermal:1},desc:'Aim a delayed explosion that damages and stuns enemies in its circle.'},
    {key:'laguna_blade',name:'Laguna Blade',icon:'⚡',spell:'bolt',target:'enemy',cd:[70,60,50],mana:[150,300,450],range:10,delay:.25,damage:[360,525,690],types:{shock:1},desc:'Select one visible enemy for a powerful lightning strike.'},
    {key:'fiery_soul',name:'Fiery Soul',icon:'♨',passive:true,desc:'Spell hits build up to seven attack/move speed stacks for 16 seconds.'},
  ],
};
LINA_KIT.ability=LINA_KIT.abilities[0];

export const SNIPER_KIT = {
  kitStatus:'core',key:'sniper',name:'Sniper',icon:'🎯',color:0x637c46,trim:0xcdbb87,
  tagline:'Control approaches with Shrapnel, then pick enemies off at range.',
  hp:320,dmg:32,range:11,rof:1.2,speed:4.2,noise:16,two_handed:true,
  levelHp:30,levelDmg:4,regen:2,mana:500,manaRegen:4,
  aura:null,passives:[],
  headshot:{chance:.4,damage:[20,50,110],stun:[.2,.3,.5]},keenScope:.015,
  abilities:[
    {key:'shrapnel',name:'Shrapnel',icon:'💥',spell:'zone',target:'point',cd:.2,mana:75,range:18,radius:4,delay:1.2,duration:10,damage:[30,45,75],slow:.75,charges:3,recharge:35,types:{thermal:1},desc:'Three charges. Aim a delayed ten-second zone that damages and slows enemies. One charge returns every 35 seconds.'},
    {key:'take_aim',name:'Take Aim',icon:'🔭',spell:'aim',target:'self',cd:[22,20,16],mana:50,duration:3,rangeBonus:[1,2,3],desc:'For three seconds, gain range and guaranteed Headshots at the cost of 65% movement speed.'},
    {key:'assassinate',name:'Assassinate',icon:'🎯',spell:'bolt',target:'enemy',cd:[20,15,10],mana:175,range:30,delay:2,channel:true,damage:[300,400,500],stun:.1,types:{kinetic:1},desc:'Select a visible enemy and stand still for two seconds to fire a powerful long-range shot. Moving cancels the aim.'},
    {key:'headshot',name:'Headshot',icon:'✦',passive:true,desc:'Attacks have a 40% chance to deal bonus damage, push the target and briefly stagger it.'},
    {key:'concussive_grenade',name:'Concussive Grenade',icon:'💣',cd:10,mana:50,cast:'grenade',radius:3.75,range:6,hop:3,damage:[200,200,200],dmg:[200,200,200],knock:[3,3,3],stun:[.3,.3,.3],desc:'Throw a grenade ahead; its blast pushes enemies away while you hop backward.'},
    {key:'keen_scope',name:'Keen Scope',icon:'👁',passive:true,desc:'Attack damage increases with the distance to your target.'},
  ],
};
SNIPER_KIT.ability=SNIPER_KIT.abilities[0];

export const AXE_KIT = {
  kitStatus:'core',key:'axe',name:'Axe',icon:'🪓',color:0xa53a32,trim:0x654a3c,
  tagline:'Draw the horde onto you, punish its attacks, and finish wounded foes.',
  hp:640,dmg:35,range:1.8,rof:.9,speed:4,noise:10,melee:true,
  levelHp:52,levelDmg:5,regen:3.5,mana:420,manaRegen:4,aura:null,passives:[],
  counterHelix:{attacks:[7,5,4],damage:[100,120,160],radius:2.75,cd:.3},
  abilities:[
    {key:'berserkers_call',name:"Berserker's Call",icon:'📣',spell:'taunt',target:'self',cd:[18,16,12],mana:[90,100,120],radius:3.15,duration:3,armor:.35,desc:'Force nearby enemies to attack you for three seconds and gain armor.'},
    {key:'battle_hunger',name:'Battle Hunger',icon:'♨',spell:'curse',target:'enemy',cd:[20,15,5],mana:[50,60,80],range:9,duration:12,damage:[12,16,24],slow:.75,types:{thermal:1},desc:'Curse a visible enemy with damage over time and a slow. Its next kill ends the curse.'},
    {key:'culling_blade',name:'Culling Blade',icon:'🪓',spell:'cull',target:'enemy',cd:[80,75,70],mana:[100,125,150],range:2,delay:.3,damage:[275,375,475],pure:true,desc:'Strike a nearby enemy with armor-piercing damage. Killing a champion resets the cooldown and grants lasting armor for this siege.'},
    {key:'counter_helix',name:'Counter Helix',icon:'↻',passive:true,desc:'After several incoming attacks, spin and deal armor-piercing damage to nearby enemies.'},
  ],
};
AXE_KIT.ability=AXE_KIT.abilities[0];

export const SVEN_KIT = {
  kitStatus:'core',key:'sven',name:'Sven',icon:'⚔',color:0x3c669e,trim:0xc7c5c1,
  tagline:'An armored sword fighter who turns a clustered battle into a cleave.',
  hp:580,dmg:55,range:1.9,rof:.85,speed:4.1,noise:10,melee:true,
  levelHp:48,levelDmg:6,regen:3,mana:420,manaRegen:4,aura:null,passives:[],
  cleave:{share:[.4,.6,.9],distance:6,width:3},
  abilities:[
    {key:'storm_hammer',name:'Storm Hammer',icon:'🔨',spell:'bolt',target:'enemy',cd:[21,18,15],mana:110,range:7,delay:.2,projectileSpeed:18,radius:2.5,damage:[95,190,320],stun:[1,1.3,1.6],types:{shock:1},desc:'Throw a hammer at an enemy, damaging and stunning it and nearby foes on impact.'},
    {key:'warcry',name:'Warcry',icon:'📣',spell:'buff',target:'self',cd:[35,30,20],mana:60,radius:7,duration:8,mods:{armor:[.1,.15,.2],speed:.15},desc:'Nearby allied troops and heroes gain armor and movement speed for eight seconds.'},
    {key:'gods_strength',name:"God's Strength",icon:'💪',spell:'buff',target:'self',cd:[110,100,90],mana:[100,150,200],duration:20,selfOnly:true,mods:{damage:[1,1.5,2]},desc:'For twenty seconds, greatly increase your attack damage.'},
    {key:'great_cleave',name:'Great Cleave',icon:'◀',passive:true,desc:'Attacks splash a portion of their damage through enemies behind the primary target.'},
  ],
};
SVEN_KIT.ability=SVEN_KIT.abilities[0];
