// Original vector command art and console assembly. Presentation only.
// Existing IDs and input callbacks remain owned by UI; no simulation changes.
const SHAPES = {
 defend:'<path d="M32 8 51 16 48 36 32 54 16 36 13 16Z"/><path d="M32 15v30M21 22h22" class="cut"/>',
 guard:'<path d="M9 23 21 13 31 23 21 34Z M31 34 43 24 55 34 43 46Z"/><path d="m8 44 17 10 9-7M37 10l18 9-2 9" class="edge"/>',
 attack:'<path d="m12 10 9 2 24 31-6 6-26-30Z M50 10l-9 2-24 31 6 6 26-30Z"/><path d="m10 43 13 11M41 54l13-11" class="edge"/>',
 rally:'<path d="M18 9h5v46h-5zM25 10h28l-8 12 8 11H25Z"/><path d="M9 56h25" class="edge"/>',
 develop:'<path d="M10 29 32 10l22 19v24H10Z"/><path d="M25 53V35h14v18M20 26h24" class="cut"/>',
 maintain:'<path d="M42 9a15 15 0 0 0-15 20L9 47l8 8 19-19A15 15 0 0 0 55 17L43 29l-9-9Z"/><circle cx="16" cy="48" r="2" class="cut"/>',
 fortify:'<path d="M9 52V26h12V15h23v11h11v26Z M24 9h33v7H24Z"/><path d="M17 34h30M22 44h5m10 0h5" class="cut"/>',
 expand:'<circle cx="32" cy="32" r="22" class="ring"/><path d="M32 10v22l19 11M8 32h48M32 8v48" class="edge"/><circle cx="22" cy="24" r="4"/><circle cx="43" cy="40" r="4"/>',
 bolt:'<path d="m38 4-24 31h17l-5 25 25-35H34Z"/><path d="M10 15 5 10m46 44 7 4M48 11l7-6" class="edge"/>',
 aim:'<circle cx="32" cy="32" r="17" class="ring"/><circle cx="32" cy="32" r="6"/><path d="M32 4v17m0 22v17M4 32h17m22 0h17" class="edge"/>',
 scope:'<path d="m10 35 30-20 13 19-30 19Z"/><ellipse cx="43" cy="25" rx="8" ry="12" transform="rotate(-34 43 25)" class="ring"/><path d="m14 40 12-8m12-9 8 10M29 47l-3 12" class="cut"/>',
 railshot:'<path d="M28 4h8v38h11L32 60 17 42h11Z"/><path d="M10 14v22m44-22v22M17 8v22m30-22v22" class="edge"/><path d="M31 9h2v36h-2Z" class="shine"/>',
 hammer:'<path d="m12 9 16-5 22 22-7 16-17-6-7-17Z M29 34l8 7-17 20-9-9Z"/><path d="m18 12 23 23M19 48l6 5" class="cut"/>',
 grenade:'<path d="m25 17 17 1 11 23-12 13-20-3-10-17Z"/><path d="m28 18 2-10h14l5 9M18 30l27 14M22 45l19-18" class="edge"/>',
 wave:'<path d="M7 43Q17 12 27 34T57 19v21Q44 59 32 46T7 54Z"/><path d="M8 27Q20 3 31 19t25-9" class="edge"/>',
 weapon:'<path d="m9 38 30-22 10 2 7-6 5 7-8 6-3 9-19 8-6 14-8-4 5-14-7 5Z"/><path d="m16 36 24-16M36 35l9-6" class="cut"/>',
 armor:'<path d="M21 9 9 20l6 13 8-4v24h24V29l7 4 4-13-13-11-5 8H27Z"/><path d="M27 27h14v17H27Z" class="cut"/>',
 heal:'<path d="M24 9h16v15h15v16H40v15H24V40H9V24h15Z"/><path d="M30 14h4v20h15v3H30Z" class="shine"/>',
 crystal:'<path d="m32 5 20 18-7 27-13 10-13-10-7-27Z"/><path d="m32 5-8 21 8 34 8-34Z M12 23l12 3h16l12-3" class="cut"/>',
 empty:'<path d="M17 12h30v40H17Z" class="ring"/><path d="M24 21h16M24 32h16M24 43h10" class="edge"/>',
};
const COLORS={defend:'blue',guard:'teal',attack:'red',rally:'gold',develop:'gold',maintain:'teal',fortify:'blue',expand:'violet',bolt:'gold',aim:'blue',scope:'teal',railshot:'gold',grenade:'red',hammer:'gold',wave:'teal',weapon:'gold',armor:'blue',heal:'teal',crystal:'violet',empty:'dim'};
export function hudGlyph(kind='bolt') {
 const key=SHAPES[kind]?kind:'bolt';
 return `<span class="hud-glyph hue-${COLORS[key]}" aria-hidden="true"><svg viewBox="0 0 64 64"><g class="glyph-shadow" transform="translate(1 3)">${SHAPES[key]}</g><g>${SHAPES[key]}</g></svg></span>`;
}
export function abilityGlyph(ab) {
 const s=`${ab?.key||''} ${ab?.spell||''} ${ab?.cast||''}`;
 if(ab?.key==='glass_sight')return hudGlyph('scope');
 if(ab?.key==='meridian')return hudGlyph('railshot');
 return hudGlyph(/hammer|slam/.test(s)?'hammer':/grenade|axe|cull|aoeDmg/.test(s)?'grenade':/aim|snipe|trueflight|meridian|bolt/.test(s)?'aim':/heal|mend|ward|shield/.test(s)?'heal':/blink|teleport|rift|weave|storm|wave|root/.test(s)?'wave':/armor|fortify/.test(s)?'armor':'bolt');
}
export function itemGlyph(it) {
 const s=`${it?.slot||''} ${it?.name||''} ${it?.key||''}`.toLowerCase();
 return hudGlyph(/weapon|rifle|gun|blade|sword|staff/.test(s)?'weapon':/armor|shield|helm|plate|chest|buckler/.test(s)?'armor':/heal|potion|brew|repair/.test(s)?'heal':'crystal');
}
export function assembleBattleHUD(root) {
 const q=s=>root.querySelector(s),main=q('#actionbar .actionmain');
 q('#command-deck').classList.add('armored-console');
 const inventory=document.createElement('section');inventory.className='hud-inventory';inventory.setAttribute('aria-label','Carried items');inventory.innerHTML='<span class="hud-kicker">EQUIPMENT</span>';
 inventory.append(q('#a-items'));const packLabel=document.createElement('span');packLabel.className='hud-kicker hud-pack-label';packLabel.textContent='FIELD PACK';inventory.append(packLabel,q('#a-pack'));
 const actions=document.createElement('section');actions.className='hud-actions';actions.setAttribute('aria-label','Hero commands');actions.innerHTML='<span class="hud-kicker">ABILITIES</span>';actions.append(q('#bigaction'),q('#ability-slots'));
 q('#heroplate .hpinfo').append(q('#herostats'),q('#fight-kit'));
 const vitals=document.createElement('div');vitals.id='hud-vitals';vitals.innerHTML='<span id="hud-hp-text"></span><span id="hud-resource-text"></span>';q('#a-hp').parentElement.after(vitals);
 const resource=document.createElement('div');resource.className='hud-resource';resource.innerHTML='<i id="hud-resource-fill"></i>';vitals.after(resource);
 main.append(inventory,actions);
 const title=document.createElement('span');title.className='hud-kicker hud-console-title';title.textContent='COMMANDER';q('.commandtop').prepend(title);
 for(const b of root.querySelectorAll('#stancebar button, .worker-orders button')){
  const key=b.dataset.st||b.dataset.worker, label=b.textContent.trim(),hotkey=b.querySelector('b');
  b.textContent='';if(hotkey)b.append(hotkey);b.insertAdjacentHTML('beforeend',hudGlyph(key));const text=document.createElement('span');text.className='hud-command-name';text.textContent=label;b.append(text);b.setAttribute('aria-label',label);
 }
}
