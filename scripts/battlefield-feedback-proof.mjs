// Run in a loaded local developer battlefield. Returns measured UI evidence;
// callers capture the same frame at laptop, phone and landscape sizes.
export async function proveBattlefieldFeedback() {
 const a=window.__app;if(!a?.game)throw Error('Start a developer battle first');
 const g=a.game,h=a.myHero();a.paused=true;a.controlMode='fight';a.ui.setControlMode('fight');
 const {ITEMS,itemInfo}=await import('../src/config.js');
 const {stateHash}=await import('../src/lockstep-hash.js');
 const T=await import('../vendor/three.module.js');
 const key=Object.keys(ITEMS)[0];h.pack=[key];
 const seat=g._reseat(h.x+6,h.z-1,8);if(!seat)throw Error('No inspection test position');
 const unit=g._spawnUnit('soldier',...seat);unit.hp=unit.maxHp*.4;
 a.frame();a.frame();a.renderer.getContext().finish();
 const before=stateHash(g);
 const world=new T.Vector3(unit.x,a.map.groundY(unit.x,unit.z)+.9,unit.z).project(a.camera);
 const cv=a.renderer.domElement,r=cv.getBoundingClientRect();
 cv.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+(world.x+1)*r.width/2,clientY:r.top+(1-world.y)*r.height/2,bubbles:true}));
 a.frame();
 const panel=document.querySelector('#battle-details');
 if(panel.classList.contains('hidden')||!panel.textContent.includes(unit.def.name))throw Error('Click did not inspect actual troop');
 if(!panel.textContent.includes(`${Math.ceil(unit.hp)} / ${unit.maxHp} HP`))throw Error('Inspection health is stale');
 if(stateHash(g)!==before)throw Error('Inspecting a unit changed simulation state');
 const bounds=panel.getBoundingClientRect();if(bounds.left<0||bounds.right>innerWidth||bounds.top<0||bounds.bottom>innerHeight)throw Error('Unit inspector exceeds viewport');
 unit.hp-=10;a.frame();if(!panel.textContent.includes(`${Math.ceil(unit.hp)} / ${unit.maxHp} HP`))throw Error('Inspection does not update health');
 unit.dead=true;a.frame();if(!panel.classList.contains('hidden'))throw Error('Dead selection remains active');
 const unseen=g.zombies.find(z=>!z.dead&&z.hp>0&&g.units.filter(u=>!u.dead).every(u=>Math.hypot(u.x-z.x,u.z-z.z)>25));
 if(!unseen)throw Error('Fixture needs an unscouted enemy');
 a.ui.inspectUnit(g,unseen,true);a.frame();if(!panel.classList.contains('hidden'))throw Error('Inspector reveals an unscouted enemy');
 document.querySelector('#a-pack button').click();a.frame();
 if(panel.classList.contains('hidden')||!panel.textContent.includes(itemInfo(key).name))throw Error('Pack item name unavailable on click');
 if(!panel.textContent.includes('1/4'))throw Error('Pack capacity missing');
 const packBounds=panel.getBoundingClientRect();if(packBounds.bottom>innerHeight||packBounds.right>innerWidth)throw Error('Pack exceeds viewport');
 document.querySelector('#battle-details-close').click();a.frame();if(!panel.classList.contains('hidden'))throw Error('Inspector close failed');
 return {unit:unit.def.name,item:itemInfo(key).name,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};
}
