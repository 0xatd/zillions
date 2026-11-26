import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Run against a local server for this candidate; screenshots are written outside the repo.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const out=process.env.ZILLIONS_NAV_QA_DIR || '/tmp/zillions-leader-navigation-qa';
await (await import('node:fs/promises')).mkdir(out,{recursive:true});
await page.goto(process.env.ZILLIONS_NAV_QA_URL || 'http://127.0.0.1:8161');await page.waitForFunction(()=>!!window.__app);await page.waitForTimeout(1500);
await page.locator('#a-play').click();await page.locator('#creator-next').click();await page.locator('#creator-back').click();
assert.equal(await page.locator('#creator-step-title').innerText(),'Origin');
await page.locator('#creator-steps [data-step="2"]').click();assert.equal(await page.locator('#leader-archetypes button:disabled').count(),20);
await page.locator('#creator-steps [data-step="4"]').click();await page.locator('#creator-faction-name').fill('Navigation Legion');
await page.locator('#creator-next').click();await page.locator('#creator-name').fill('First Leader');await page.locator('#creator-submit').click();await page.waitForFunction(()=>__app.profile.mmoCharacters.length===1);
const first=await page.evaluate(()=>__app.profile.mmoCharacterId);
await page.locator('#m-create-character').click();await page.locator('#creator-cancel').click();assert.equal(await page.evaluate(()=>__app.profile.mmoCharacters.length),1);
await page.locator('#m-create-character').click();assert.ok(await page.locator('#creator-faction-name').isDisabled());await page.locator('#creator-steps [data-step="5"]').click();await page.locator('#creator-name').fill('Second Leader');await page.locator('#creator-submit').click();await page.waitForFunction(()=>__app.profile.mmoCharacters.length===2);
assert.equal(await page.evaluate(()=>__app.profile.chapter.founderId),first);
await page.locator(`[data-id="${first}"]`).click();await page.reload();await page.waitForFunction(()=>!!window.__app);await page.waitForTimeout(1200);await page.locator('#a-play').click();assert.equal(await page.evaluate(()=>__app.profile.mmoCharacterId),first);assert.ok(await page.locator('#screen-main').isVisible());
for(const [width,height,label] of [[1366,768,'laptop'],[390,844,'phone']]){
 await page.setViewportSize({width,height});await page.screenshot({path:`${out}/roster-${label}.png`});await page.locator('#nav-home').click();await page.waitForTimeout(600);await page.screenshot({path:`${out}/world-${label}.png`});
 assert.equal(await page.locator('#system-labels button:disabled').count(),3);
 await page.locator('#world-back').click();await page.locator('#m-create-character').click();
 for(let step=0;step<6;step++){await page.locator(`#creator-steps [data-step="${step}"]`).click();await page.screenshot({path:`${out}/creator-${step}-${label}.png`});}
 await page.locator('#creator-cancel').click();
}
assert.equal(await page.evaluate(()=>{const u=__app.ui;u.hideStart();u._showScreen('characters');const hidden=u.overlayHidden();u.nav.leaveMatch('characters');u._showScreen('main');return hidden;}),true,'blocked navigation does not expose a menu over the active match');
assert.deepEqual(await page.evaluate(async()=>{
 const {openConfirm}=await import('/src/ui-kit.js');const host=document.createElement('div');host.innerHTML='<h2 data-confirm-title></h2><p data-confirm-copy></p><button data-confirm-yes></button><button data-confirm-no></button>';document.body.appendChild(host);
 const first=openConfirm(host,{title:'First'});const second=openConfirm(host,{title:'Second'});host.querySelector('[data-confirm-yes]').click();const result=await Promise.all([first,second]);host.remove();return result;
}),[false,true]);
assert.deepEqual(await page.evaluate(()=>{
 const u=__app.ui;let deleted=false,left=false;const prior=u.cb.onMatchLeave;
 u._askConfirm({title:'Delete?',run:()=>deleted=true});document.querySelector('#room-confirm-cancel').click();u.setMatchExit('guest');u.cb.onMatchLeave=()=>left=true;u._confirmMatchExit();document.querySelector('#room-confirm-leave').click();u.cb.onMatchLeave=prior;return {deleted,left};
}),{deleted:false,left:true});
await page.locator('#leader-back').click();await page.locator('#a-settings').focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#screen-settings').isVisible());await page.locator('#set-back').click();
await page.locator('#nav-account').click();await page.locator('#account-close').click();assert.ok(await page.locator('#account-card').isHidden());
const fresh=await browser.newPage();await fresh.goto(process.env.ZILLIONS_NAV_QA_URL || 'http://127.0.0.1:8161');await fresh.waitForFunction(()=>!!window.__app);await fresh.waitForTimeout(1000);await fresh.locator('#a-play').click();await fresh.locator('#creator-steps [data-step="5"]').click();await fresh.locator('#creator-name').fill('Independent');await fresh.locator('#creator-submit').click();await fresh.waitForFunction(()=>__app.profile.mmoCharacters.length===1);assert.ok(await fresh.locator('#screen-main').isVisible());await fresh.close();
assert.deepEqual(errors,[]);console.log('PASS: creation, cancel, multiple leaders, founder preservation, selection persistence, disabled archetypes/worlds, desktop/mobile screenshots');} finally { await browser.close(); }
