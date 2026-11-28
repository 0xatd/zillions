import {startReviewServer} from './playability-static-server.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const server=await startReviewServer();
const out=process.env.QA_OUTPUT || '/tmp/zillions-hud-camera-review';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);
 await page.evaluate(async()=>{const a=__app;document.querySelector('#a-offline').click();await a.startGame('normal','scott');a.missionIntro=null;a.ui.hideMissionIntro();a._coach=null;a.ui.hideCoach();a.game.foundCity(0,0);a.controlMode='fight';a.paused=false;a.__commands=[];const issue=a.issue.bind(a);a.issue=c=>{a.__commands.push(c);issue(c);};document.activeElement?.blur();});
 const state=()=>page.evaluate(()=>({x:__app.focus.x,z:__app.focus.z,pinned:__app._cameraPinned,hero:{x:__app.myHero().x,z:__app.myHero().z},commands:__app.__commands.length}));
 await page.mouse.move(700,250);await page.keyboard.press('Space');await page.waitForTimeout(200);
 let before=await state();await page.mouse.move(1364,250);await page.waitForTimeout(500);let after=await state();
 assert.ok(after.x>before.x+2,`right edge pans camera: ${JSON.stringify({before,after})}`);assert.equal(after.pinned,false);
 await page.mouse.move(700,250);before=await state();await page.waitForTimeout(300);after=await state();assert.ok(Math.abs(after.x-before.x)<.2,'panned camera stays where placed');
 await page.keyboard.press('Space');await page.waitForFunction(()=>Math.hypot(__app.focus.x-__app.myHero().x,__app.focus.z-__app.myHero().z)<1,{},{timeout:5000});after=await state();assert.ok(Math.hypot(after.x-after.hero.x,after.z-after.hero.z)<1,'Space centers hero');
 const mini=await page.locator('#minimap-top').boundingBox();const mapSize=await page.evaluate(()=>__app.map.size);
 await page.mouse.click(mini.x+mini.width*.7,mini.y+mini.height*.3);await page.waitForFunction(n=>Math.abs(__app.focus.x-n*.7)<2&&Math.abs(__app.focus.z-n*.3)<2,mapSize,{timeout:5000});after=await state();
 assert.ok(Math.abs(after.x-mapSize*.7)<2 && Math.abs(after.z-mapSize*.3)<2,`minimap click navigates: ${JSON.stringify(after)}`);
 assert.equal(after.commands,0,'camera-only inputs never issue hero orders');
 await page.mouse.move(mini.x+mini.width*.5,mini.y+mini.height*.5);await page.mouse.down();await page.mouse.move(mini.x+mini.width*.25,mini.y+mini.height*.75,{steps:4});await page.mouse.up();await page.waitForTimeout(150);after=await state();
 assert.ok(Math.abs(after.x-mapSize*.25)<2 && Math.abs(after.z-mapSize*.75)<2,'minimap drag navigates continuously');
 await page.keyboard.press('Space');await page.mouse.move(700,250);await page.waitForTimeout(100);
 await page.locator('#b-menu').click();before=await state();await page.mouse.click(700,350,{button:'right'});await page.mouse.move(1364,250);await page.waitForTimeout(300);after=await state();
 assert.equal(after.commands,before.commands,'pause overlay blocks right-click order');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)<.2,'pause overlay blocks edge pan');
 await page.keyboard.press('Escape');await page.mouse.move(700,250);await page.waitForTimeout(100);
 await page.locator('#actionbar').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#actionbar')).visibility),'visible','resuming restores HUD visibility');
 await page.locator('#builder-toggle').click();await page.locator('#builder-reserve').waitFor({state:'visible'});
 const crew=await page.evaluate(async()=>{const {proveBuilderUI}=await import('/scripts/builder-ui-proof.mjs');return proveBuilderUI();});
 assert.ok(crew.completed>=1 && crew.gold>=30,'visible workers complete paid work and respect reserve');
 console.log('Visible worker proof',JSON.stringify(crew));
 await page.screenshot({path:`${out}/hud-camera.png`});
 // Layout fixture only: all four battle buttons visible on a narrow phone.
 await page.setViewportSize({width:390,height:844});
 const alerts=await page.evaluate(()=>{const e=document.querySelector('#combat-locations');e.classList.remove('hidden');e.innerHTML=[1,2,3,4].map(n=>`<button>Battle ${n}</button>`).join('');const t=document.querySelector('#topbar').getBoundingClientRect(),a=document.querySelector('#combat-locations').getBoundingClientRect();return {topbarBottom:t.bottom,alertTop:a.top,alertRight:a.right};});
 assert.ok(alerts.alertTop>=alerts.topbarBottom && alerts.alertRight<=390,'combat locations clear phone resources');assert.deepEqual(errors,[]);writeFileSync(`${out}/result.json`,JSON.stringify({ok:true,checks:['edge pan','camera stays after pan','Space center','minimap click','minimap drag','camera-only commands','pause order and pan gate','visible worker construction and reserve','worker form input isolation'],crew,errors},null,2));console.log('HUD camera and overlay input checks passed');
}finally{await browser.close();await server.close();}
