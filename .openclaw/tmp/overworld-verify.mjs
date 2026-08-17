// Headless browser verification of the overworld boot. Run from the repo:
//   node .openclaw/tmp/overworld-verify.mjs   (with the repo served on :8901)
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8901/index.html';
const OUT = '.openclaw/tmp';
const results = [];
const ok = (name, cond) => { results.push([name, !!cond]); console.log(`${cond ? '✓' : '✗'} ${name}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  // /api/auth-config 404s are the expected offline dev environment.
  if (m.type() === 'error' && !(m.text().includes('auth-config') || (m.location()?.url||'').includes('auth-config')) && !m.text().includes('Failed to load resource')) errors.push(m.text());
});

await page.goto(URL);
await page.waitForTimeout(2500);

const heroPos = () => page.evaluate(() => {
  const ow = window.__app?.ow;
  return ow ? { x: ow.hero.x, z: ow.hero.z } : null;
});

ok('no page errors on boot', errors.length === 0);
ok('overworld state exists', await page.evaluate(() => !!window.__app?.ow));
ok('hero mesh exists on load', await page.evaluate(() => !!window.__app?.owHero && window.__app.owHero.isObject3D));
ok('overlay hidden on boot', await page.evaluate(() => window.__app.ui.overlayHidden()));
await page.screenshot({ path: `${OUT}/overworld-spawn.png` });

const before = await heroPos();
// East walks into the planet's interior; north from the spawn is shore.
await page.keyboard.down('d');
await page.waitForTimeout(3000);
await page.keyboard.up('d');
const after = await heroPos();
console.log('WASD before', before, 'after', after);
ok('WASD moves the hero', after && before && Math.hypot(after.x - before.x, after.z - before.z) > 2);
await page.screenshot({ path: `${OUT}/overworld-midwalk.png` });

const opened = await page.evaluate(async () => {
  const app = window.__app;
  const g = app.ow.map.overworldLayout.gates[0];
  app.ow.hero.x = g.x + 0.5; app.ow.hero.z = g.z + 0.5;
  app.ow._cool.clear();
  await new Promise((r) => setTimeout(r, 400));
  return !document.querySelector('#gate-confirm')?.classList.contains('hidden');
});
ok('gate walk-in opens confirm panel', opened);
await page.screenshot({ path: `${OUT}/overworld-gate.png` });
await page.evaluate(() => document.querySelector('#gate-confirm')?.classList.add('hidden'));

await page.evaluate(() => window.__app.ui.hideOverlay?.());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('ESC opens hub overlay', await page.evaluate(() => !window.__app.ui.overlayHidden()));
await page.screenshot({ path: `${OUT}/overworld-esc.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('ESC closes hub overlay', await page.evaluate(() => window.__app.ui.overlayHidden()));

const locked = await page.evaluate(async () => {
  document.querySelector('#gate-confirm')?.classList.add('hidden');
  const app = window.__app;
  const g = app.ow.map.overworldLayout.gates[1];
  app.ow.hero.x = g.x + 0.5; app.ow.hero.z = g.z + 0.5;
  app.ow._cool.clear();
  await new Promise((r) => setTimeout(r, 400));
  return document.querySelector('#gate-confirm')?.classList.contains('hidden') !== false;
});
ok('locked gate refuses entry', locked);

ok('no page errors at end', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
await browser.close();
const failed = results.filter(([, c]) => !c);
console.log(failed.length ? `FAILED: ${failed.map(([n]) => n).join(', ')}` : 'overworld-verify: all browser assertions passed');
process.exit(failed.length ? 1 : 0);
