import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const output=process.env.QA_OUTPUT || '/tmp/zillions-custom-only-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try {
 for(const [name,width,height] of [['laptop',1366,768],['phone',390,844]]) {
  const page=await browser.newPage({viewport:{width,height}});
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:8175/');
  await page.locator('#a-play').waitFor({state:'visible'});
  assert.equal((await page.locator('#a-play').textContent()).trim(),'Custom Games');
  assert.equal(await page.locator('#a-world').isDisabled(),true);
  assert.equal(await page.locator('#m-enter-world').isDisabled(),true);
  await page.screenshot({path:`${output}/${name}.png`});
  await page.locator('#a-play').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#screen-overworld').isVisible(),false);
  assert.equal(await page.locator('#screen-custom').isVisible(),true);
  await page.close();
 }
 console.log('Custom-only menu: laptop + phone passed');
} finally {await browser.close();}
