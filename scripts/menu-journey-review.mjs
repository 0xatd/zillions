import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const server=await startReviewServer();
const out=process.env.QA_OUTPUT || '/tmp/zillions-menu-journey';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],bounds=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);
 const shoot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:`${out}/${name}.png`});};
 await shoot('title-laptop');await page.locator('#a-settings').click();await shoot('settings-laptop');
 await page.evaluate(()=>__app.ui._showScreen('account'));await page.locator('#a-play').click();
 if(await page.locator('#a-offline').isVisible())await page.locator('#a-offline').click();
 await page.locator('#creator-next').waitFor({state:'visible'});
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){
  await page.setViewportSize({width,height});
  for(let i=0;i<6;i++){
   await page.locator('#creator-steps button').nth(i).click();await shoot(`creator-${i}-${name}`);
   if(i===0)bounds.push(await page.locator('#creator-races').evaluate(el=>({viewport:innerWidth,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
  }
 }
 await page.locator('#creator-name').fill('Menu Pilot');await page.locator('#creator-submit').click();
 await page.locator('#nav-home').waitFor({state:'visible'});
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>__app.ui._showScreen('main'));await shoot(`roster-${name}`);
  await page.evaluate(()=>__app.ui.showCharacterSheet('shop'));
  assert.ok((await page.locator('#market-vendors').boundingBox()).height>=40,'Vendor navigation remains visible');
  assert.equal(await page.locator('#sheet-panel-crafting').isVisible(),false,'Quartermaster does not leak Forge');
  assert.equal(await page.locator('.sheet-tab.sel').count(),1,'Only current service selected');await shoot(`shop-${name}`);
  await page.locator('#sheet-tab-crafting').click();assert.equal(await page.locator('#sheet-panel-shop').isVisible(),false,'Forge does not leak Quartermaster');await shoot(`forge-${name}`);
  await page.evaluate(()=>__app.ui._showScreen('main'));await page.locator('#leader-custom').click();await shoot(`custom-${name}`);
  await page.evaluate(()=>__app.ui.showSetup({mode:'campaign',level:1}));await shoot(`setup-${name}`);assert.equal(await page.locator('#setup-leaders').isVisible(),false,'Campaign keeps selected expedition leader');
  await page.evaluate(()=>__app.ui.setDeploymentLoading(true,null,'Loading expedition assets'));await shoot(`loading-${name}`);await page.evaluate(()=>__app.ui.setDeploymentLoading(false));
 }
 await page.evaluate(async()=>{await __app.startGame('normal','scott');__app.missionIntro=null;__app.ui.hideMissionIntro();__app.game.foundCity(0,0);__app.game._gameOver(false);});
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){
  await page.setViewportSize({width,height});
  for(const state of ['pending','error','confirmed']){
   await page.evaluate(state=>{const a=__app;const extra=state==='pending'?{pending:true}:state==='error'?{error:'Rewards have not been saved. Your previous progress is unchanged.',retry:()=>{}}:{saved:true,local:true,grants:[],quests:[]};a.ui.showEnd(false,a.game.stats,2,1,'campaign',0,extra,a.game);},state);
   await shoot(`results-${state}-${name}`);
  }
 }
 assert.deepEqual(errors,[]);assert.ok(bounds.find(b=>b.viewport===390).bottom<700,'Origin choices fit before mobile actions');writeFileSync(`${out}/review.json`,JSON.stringify({errors,bounds},null,2));console.log({errors,bounds,out});
}finally{await browser.close();await server.close();}
