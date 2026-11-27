import {startReviewServer} from './playability-static-server.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {levelById} from '../src/config.js';
const server=await startReviewServer(),out=process.env.QA_OUTPUT||'/tmp/zillions-core-journey';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);await page.waitForFunction(()=>window.__app?.ui);
 await page.locator('#a-play').click();await page.locator('.custom-map-row').first().waitFor();
 assert.equal(await page.locator('#screen-character-create').isVisible(),false,'play does not require character creation');
 const mapRow=process.env.QA_LEVEL ? page.locator('.custom-map-row').filter({hasText:levelById(Number(process.env.QA_LEVEL)).name}) : page.locator('.custom-map-row').first();
 await mapRow.click();
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844],['landscape',844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await page.screenshot({path:`${out}/maps-${name}.png`});
  if(await page.locator('.custom-map-preview').isVisible()){const rect=await page.locator('.custom-map-preview').boundingBox(),canvas=await page.locator('.custom-map-preview canvas').boundingBox();assert.ok(canvas&&canvas.y>=rect.y&&canvas.y+canvas.height<=rect.y+rect.height,'map preview stays inside its frame');}
  const b=await page.locator('#cu-join').boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=height&&b.x+b.width<=width,`map play button visible ${name}: ${JSON.stringify(b)}`);
 }
 await page.setViewportSize({width:1366,height:768});
 await page.locator('#cu-join').click();await page.locator('#s-start').waitFor({state:'visible'});for(const [name,width,height] of [['laptop',1366,768],['phone',390,844],['landscape',844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await page.screenshot({path:`${out}/prepare-${name}.png`});
  const b=await page.locator('#s-start').boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=height&&b.x+b.width<=width,`start visible ${name}: ${JSON.stringify(b)}`);
  await page.locator('#diffseg button').first().scrollIntoViewIfNeeded();
  await page.locator('#diffseg button').first().click();
  assert.equal(await page.evaluate(()=>__app.ui.selectedDiff),'casual',`difficulty is operable ${name}`);
  await page.locator('#diffseg button').nth(1).click();
 }
 await page.setViewportSize({width:1366,height:768});
 await page.locator('#s-start').click();await page.waitForFunction(()=>window.__app?.game?.phase==='found',null,{timeout:30000}).catch(async e=>{console.log(JSON.stringify({errors,state:await page.evaluate(()=>({phase:__app.game?.phase,over:__app.game?.over,loading:__app._preparingBattlefield,mode:__app.ui.selectedMode,hero:__app.ui.selectedHero,screen:__app.ui._lastScreen,toasts:document.querySelector('#toasts')?.textContent}))}));throw e;});
 await page.evaluate(()=>{const a=__app;a.missionIntro=null;a.ui.hideMissionIntro();a._coach=null;a.ui.hideCoach();a.game.foundCity(0,0);a.controlMode='fight';});
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>__app.game.units.filter(u=>!u.hero).length),5);
 if(process.env.QA_LEVEL && Number(process.env.QA_LEVEL)>1)assert.ok(await page.evaluate(()=>__app.game.ironRain?.prep>0),'later Iron Rain map starts with preparation');
 const bounds=[];
 for(const [name,width,height]of [['laptop',1366,768],['phone',390,844],['landscape',844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);await page.screenshot({path:`${out}/battle-${name}.png`});
  bounds.push(await page.evaluate(()=>{const r=document.querySelector('#actionbar').getBoundingClientRect();return{width:innerWidth,height:innerHeight,hud:{x:r.x,y:r.y,width:r.width,height:r.height}};}));
 }
 if(process.env.QA_IRON_RAIN_STATES){
  // Presentation fixtures only: these captures do not claim a played victory/loss.
  for(const won of [true,false]){
   await page.evaluate(won=>{const a=__app,g=a.game;g.over=true;g.won=won;if(!won)g.defeatCause='keep_destroyed';a.ui.showEnd(won,g.stats,g.threatLevel,g.levelId,g.mode,0,{customBattle:true,local:true,grants:[],quests:[]},g);},won);
   for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(150);await page.screenshot({path:`${out}/${won?'victory':'defeat'}-${name}.png`});
    assert.equal(await page.locator('#b-restart').isVisible(),true);
   }
  }
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>__app.profile.mmoCharacters?.length||0),0,'custom battle does not create a campaign character');assert.equal(await page.evaluate(()=>__app._customBattle),true);assert.equal(await page.evaluate(()=>__app._match?.world||null),null);
 writeFileSync(`${out}/result.json`,JSON.stringify({errors,bounds,checks:['fresh title to map picker','no mandatory character','real start button','starter squad','no world encounter','three viewport captures']},null,2));console.log(JSON.stringify({out,errors,bounds}));
}finally{await browser.close();await server.close();}
