import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const out=process.env.QA_OUTPUT||'/tmp/zillions-custom-navigation';mkdirSync(out,{recursive:true});
const server=await startReviewServer();
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844],['landscape',844,390]]) {
  if(process.env.QA_VIEWPORT&&process.env.QA_VIEWPORT!==name)continue;
  const page=await browser.newPage({viewport:{width,height}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);
  await page.locator('#a-play').click();await page.locator('.custom-map-row').first().click();
  await page.locator('#cu-search').fill('no such map xyz');
  assert.equal(await page.locator('.custom-map-row').count(),0);
  assert.equal(await page.locator('#cu-join').isDisabled(),true,'hidden map must not remain playable');
  assert.equal(await page.locator('#cu-create').isDisabled(),true,'hidden map must not remain hostable');
  await page.screenshot({path:`${out}/empty-${name}.png`});
  await page.locator('#cu-search').fill('');await page.locator('.custom-map-row').first().click();
  const selected=await page.locator('.custom-map-row.selected b').textContent();
  await page.screenshot({path:`${out}/maps-${name}.png`});
  if(name==='laptop') await page.evaluate(async()=>{const {makeMmoCharacter,addMmoCharacter}=await import('/src/mmo-characters.js');addMmoCharacter(__app.profile,makeMmoCharacter('Persistent fixture','vanguard'));});
  const rosterBefore=await page.evaluate(()=>JSON.stringify(__app.profile.mmoCharacters));
  await page.locator('#cu-join').click();await page.locator('#s-start').waitFor({state:'visible'});
  assert.ok(await page.locator('#herorow .herocard:visible').count()>1,'custom games must offer hero choice even with a persistent character');
  await page.locator('#herorow .herocard[data-key="alexander"]').click();
  assert.equal(await page.evaluate(()=>__app.ui.selectedHero),'alexander');
  assert.equal(await page.evaluate(()=>JSON.stringify(__app.profile.mmoCharacters)),rosterBefore,'custom hero selection must preserve the world roster');
  await page.screenshot({path:`${out}/setup-${name}.png`});
  await page.locator('#s-back').click();await page.locator('#cu-join').waitFor({state:'visible'});
  assert.equal(await page.locator('.custom-map-row.selected b').textContent(),selected,'Back preserves map');
  await page.locator('#cu-create').click();await page.locator('#cu-cancel').click();
  assert.equal(await page.locator('#cu-create-panel').isVisible(),false);
  await page.locator('#cu-back').click();await page.locator('#a-play').waitFor({state:'visible'});
  await page.locator('#a-play').click();await page.locator('#cu-join').waitFor({state:'visible'});
  assert.equal(await page.locator('#screen-character-create').isVisible(),false);
  // Browser-only room fixtures: this proves refresh/filter selection behavior,
  // not authenticated joining or server authorization.
  if(name==='laptop') {
   await page.evaluate(()=>{const ui=__app.ui;ui._customView='live';ui.showCustomBrowser({games:[{id:'qa-room',name:'Navigation fixture',host_name:'qa',status:'open',level:1,mode:'campaign',protocol_compatible:true}]});});
   await page.locator('.custom-live-row').click();assert.equal(await page.locator('#cu-join').isEnabled(),true);
   await page.evaluate(()=>__app.ui.showCustomBrowser({games:[{id:'qa-room',name:'Updated fixture',host_name:'qa',status:'open',level:1,mode:'campaign',protocol_compatible:false}]}));
   assert.equal(await page.locator('#cu-join').isDisabled(),true,'refresh must apply new room compatibility');
   assert.equal(await page.locator('#cu-detail h2').textContent(),'Updated fixture');
   await page.evaluate(()=>__app.ui.showCustomBrowser({games:[]}));
   assert.equal(await page.locator('#cu-join').isDisabled(),true,'removed room must not stay joinable');
   assert.equal(await page.locator('.custom-live-row').count(),0);
   await page.screenshot({path:`${out}/rooms-empty-${name}.png`});
  }
  assert.deepEqual(errors,[]);console.log(`${name}: search, selection, setup Back, host cancel, title return passed`);
  await page.close();
 }
}finally{await browser.close();await server.close();}
