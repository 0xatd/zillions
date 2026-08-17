// Headless screenshot harness: serve the repo root (python3 -m http.server 8123)
// and run with playwright-core installed: node tools/preview-shot.mjs city out.png 1 8
// Chromium executable path assumes the Claude Code remote container.
// Boot the real game headless and screenshot it.
import { chromium } from 'playwright-core';
const view = process.argv[2] || 'game';   // 'menu' | 'game'
const out = process.argv[3] || `shot_${view}.png`;
const level = Number(process.argv[4] || 1);
const waitS = Number(process.argv[5] || 8);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__app, { timeout: 20000 });
await page.waitForTimeout(3500); // menu backdrop assembles
if (view === 'game' || view === 'city') {
  await page.evaluate(async (lvl) => {
    const app = window.__app;
    app.ui.selectedLevel = lvl;
    app.ui.selectedMode = 'campaign';
    await app.startGame('normal', 'scott');
  }, level);
}
if (view === 'city') {
  await page.waitForTimeout(1500);
  await page.evaluate((zoom) => {
    const app = window.__app;
    const g = app.game;
    g.foundCity(0, 0);
    for (const p of g.plots) { g._construct(p, true); }
    const hq = g.plots.find((p) => p.kind === 'hq');
    app.focus.set(hq.cx, 0, hq.cz);
    app.camDist = zoom;
  }, Number(process.env.ZOOM || 26));
}
await page.waitForTimeout(waitS * 1000);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
