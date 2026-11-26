import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.ZILLIONS_QA_URL || 'http://127.0.0.1:8161'); await page.waitForFunction(()=>window.__app);await page.waitForTimeout(1500);
await page.evaluate(async()=>{await __app._ensureDefaultCommander();});
const out=process.env.ZILLIONS_QA_DIR || '/tmp/zillions-social-navigation-qa';await mkdir(out,{recursive:true});
for(const [width,height,label] of [[1366,768,'laptop'],[390,844,'phone']]) {
 await page.setViewportSize({width,height});await page.evaluate(()=>{__app.ui.lobbyFriends([]);__app.ui._showScreen('account');});
 assert.equal(await page.locator('#nav-squad').innerText(),'CUSTOM BATTLES');
 await page.screenshot({path:`${out}/menu-${label}.png`});
 await page.locator('#social-toggle').click();await page.screenshot({path:`${out}/friends-guest-${label}.png`});
 assert.ok(await page.locator('#social-panel').isVisible());const route=await page.evaluate(()=>__app.ui._lastScreen);await page.keyboard.press('ArrowDown');await page.keyboard.press('w');assert.equal(await page.evaluate(()=>__app.keys.has('w')),false);assert.equal(await page.evaluate(()=>__app.ui._lastScreen),route);await page.keyboard.press('Escape');assert.equal(await page.locator('#social-panel').isVisible(),false);
 await page.locator('#a-play').click();await page.screenshot({path:`${out}/roster-${label}.png`});const enter=await page.locator('#nav-home').boundingBox(),custom=await page.locator('#leader-custom').boundingBox();assert.ok(custom.y>=enter.y+enter.height);assert.ok(custom.y+custom.height<=height);
 await page.locator('#leader-custom').click();await page.locator('[data-view="live"]').click();await page.screenshot({path:`${out}/browser-${label}.png`});
 await page.locator('[data-view="arcade"]').click();await page.locator('.custom-map-row').first().click();await page.screenshot({path:`${out}/maps-${label}.png`});
 await page.locator('#cu-create').click();await page.screenshot({path:`${out}/create-${label}.png`});await page.locator('#cu-cancel').click();await page.locator('.custom-map-row').nth(1).click();await page.locator('#cu-join').click();assert.equal(await page.evaluate(()=>__app.ui.selectedLevel),2);assert.equal(await page.evaluate(()=>__app._isCustomBattle()),true);
 await page.evaluate(()=>{__app.ui._showScreen('main');__app._openOverworld();});await page.locator('#chapter-next').click();
 assert.equal(await page.locator('#levelrow .levelcard').count(),1);await page.mouse.move(0,0);await page.waitForTimeout(250);await page.screenshot({path:`${out}/encounter-${label}.png`});
 await page.locator('#social-toggle').click();await page.evaluate(()=>{__app.ui.lobbyFriends([{id:'f1',userId:'u1',name:'online_friend',status:'accepted',online:true},{id:'f2',userId:'u2',name:'offline_friend',status:'accepted',online:false},{id:'f3',userId:'u3',name:'new_friend',status:'pending',direction:'incoming',online:true}]);__app.ui.socialParty({leaderId:'u1',members:[{id:'u1',name:'online_friend'},{id:'me',name:'commander'}]});__app.ui.socialStatus('QA fixture — layout preview');});
 await page.screenshot({path:`${out}/friends-populated-fixture-${label}.png`});await page.locator('#social-close').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
await page.evaluate(()=>sessionStorage.setItem('zillions-return-custom','1'));await page.reload({waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__app?.ui._lastScreen==='custom',null,{timeout:60000});
assert.deepEqual(errors,[]);console.log('PASS desktop/mobile menu, roster, custom browser, creator, campaign locked encounter, social open/close/focus and fixture layouts');
} finally {await browser.close();}
