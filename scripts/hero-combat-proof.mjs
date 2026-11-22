// Run in a paused developer battlefield with a nearby spitter winding up.
// Does not issue movement orders; callers may restore their fixture afterward.
export function proveHeroCombatPresentation() {
 const a=window.__app,g=a?.game,h=a?.myHero();
 const e=g?.zombies.find(z=>!z.dead&&z.windup&&g.canFocusEnemy(h,z));
 if(!e)throw Error('Need a visible in-range enemy with a pending ground strike');
 a.ui.inspectUnit(g,e,true);a.frame();
 const panel=document.querySelector('#battle-details'),focus=panel.querySelector('[data-focus-enemy]');
 if(!focus||focus.disabled)throw Error('Focus action unavailable');
 const button=focus.getBoundingClientRect(),box=panel.getBoundingClientRect();
 if(button.top<box.top||button.bottom>box.bottom)throw Error('Primary focus action below inspector fold');
 focus.click();a.frame();
 if(h.focusId!==e.id)throw Error('Explicit focus did not reach local hero');
 if(!panel.textContent.includes('Clear attack focus'))throw Error('No way to clear focus');
 if(a._combatCues.filter(m=>m.visible).length<3)throw Error('Missing attack/impact timing cues');
 panel.querySelector('[data-focus-enemy]').click();a.frame();
 if(h.focusId!==null)throw Error('Clear focus failed');
 const oldX=e.x;e.x=h.x+40;a.ui.inspectUnit(g,e,true);a.frame();
 if(!panel.classList.contains('hidden'))throw Error('Unscouted enemy details leaked');
 e.x=oldX;a.ui.inspectUnit(g,e,true);a.frame();
 return {focusVisible:true,clearWorks:true,hiddenEnemyProtected:true};
}
