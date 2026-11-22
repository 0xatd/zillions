// Run inside a loaded developer browser page. Exercises actual app lifecycle.
export async function proveArrivalAndHUD() {
  const a=window.__app;
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  a.renderer.setAnimationLoop(null);
  a.ui.selectedMode='campaign';a.ui.selectedLevel=5;
  await a.startGame('normal','scott');
  check(!!a.missionIntro,'Fresh campaign must show arrival');
  const before=JSON.stringify(a.game.snapshot());
  a.issue({t:'hdir',p:0,x:1,z:0,s:false});
  a.frame();
  check(JSON.stringify(a.game.snapshot())===before,'Arrival advanced simulation or accepted input');
  const distance=a.missionIntro.distance;
  document.querySelector('#mission-intro-skip').click();
  check(!a.missionIntro&&a.camDist===distance,'Skip did not restore gameplay camera');
  check(!a.ui.root.classList.contains('mission-arrival'),'Skip left HUD hidden');
  const snap=a.game.snapshot();
  await a.startGame('normal','scott',null,snap);
  check(!a.missionIntro,'Restored game incorrectly replays arrival');
  a.paused=true;
  const hero=a.myHero();hero.skillPoints=1;
  a.ui.update(a.game,0,{controlMode:'fight'});
  const panel=document.querySelector('#upgradepanel');
  check(getComputedStyle(panel).display!=='none','Upgrade choice is inaccessible');
  const button=panel.querySelector('button');
  check(button&&!button.disabled,'Upgrade choice has no usable button');
  button.click();
  check(hero.skillPoints===0,'Upgrade did not spend the point');
  const bar=document.querySelector('#actionbar').getBoundingClientRect();
  check(bar.left>=0&&bar.right<=innerWidth,'Command bar leaves viewport');
  if(innerHeight<=650)check(bar.height<=90,'Landscape HUD still obscures the battlefield');
  return {arrival:'frozen, skippable, restore-safe',upgrades:'usable',hud:{x:bar.x,y:bar.y,width:bar.width,height:bar.height}};
}
