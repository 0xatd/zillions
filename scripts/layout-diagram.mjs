// Top-down layout diagrams for the five Earth cities. Presentation of the
// existing landform plans: walls, gates, towers, and the keep. No sim writes.
//   SHOT_OUT=/opt/cursor/artifacts/terrain-proof/pass6 node scripts/layout-diagram.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LEVELS, TILE } from '../src/config.js';
import { TerrainField } from '../src/terrain.js';
import { generatePlots } from '../src/plots.js';
import { SITE_FORMS } from '../src/site-plan.js';

const outDir = process.env.SHOT_OUT || '/tmp/layout-diagrams';
await mkdir(outDir, { recursive: true });

const FILL = {
  [TILE.WATER]: '#7ec8e3',
  [TILE.MOUNTAIN]: '#8d8478',
  [TILE.FOREST]: '#2f6b45',
  [TILE.SAND]: '#d7c39a',
  [TILE.GRASS]: '#6aaa78',
  [TILE.PATH]: '#c4a574',
};

function svgFor(level) {
  const map = new TerrainField(level.seed, level.theme, { size: level.size, nests: level.nests });
  const site = map.sites[0];
  const plots = generatePlots(map, site, { levelId: level.id, siteIdx: 0 });
  const span = 46;
  const x0 = Math.round(site.x - span);
  const z0 = Math.round(site.z - span);
  const n = span * 2;
  const cell = 8;
  const parts = [];
  parts.push(`<rect width="${n * cell}" height="${n * cell + 36}" fill="#1c2430"/>`);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const tx = x0 + x;
      const tz = z0 + z;
      if (!map.inBounds(tx, tz)) continue;
      const fill = FILL[map.tiles[map.idx(tx, tz)]] || '#6aaa78';
      parts.push(`<rect x="${x * cell}" y="${z * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`);
    }
  }
  const px = (x) => (x - x0) * cell;
  const pz = (z) => (z - z0) * cell;
  for (const plot of plots) {
    if (plot.kind !== 'wall') continue;
    const arch = new Set((plot.arch || []).map(([x, z]) => `${x},${z}`));
    for (const [x, z] of plot.tiles || []) {
      const gate = arch.has(`${x},${z}`);
      parts.push(`<rect x="${px(x)}" y="${pz(z)}" width="${cell}" height="${cell}" fill="${gate ? '#c4473b' : '#efe6d2'}"/>`);
    }
  }
  for (const plot of plots) {
    if (plot.kind === 'tower' || plot.kind === 'outpost') {
      parts.push(`<rect x="${px(plot.x)}" y="${pz(plot.z)}" width="${cell * 2}" height="${cell * 2}" fill="#3e5f86"/>`);
    }
  }
  const hq = plots.find((p) => p.kind === 'hq');
  if (hq) parts.push(`<rect x="${px(hq.x)}" y="${pz(hq.z)}" width="${cell * 4}" height="${cell * 4}" fill="#f2c14e"/>`);
  const form = SITE_FORMS[level.theme.city];
  const title = `${level.name} — ${form?.label || level.theme.city}`;
  parts.push(`<text x="8" y="${n * cell + 24}" fill="#f4efe4" font-family="sans-serif" font-size="18">${title}</text>`);
  parts.push(`<text x="${n * cell - 280}" y="${n * cell + 24}" fill="#f4efe4" font-family="sans-serif" font-size="14">cream wall · red gate · blue tower · gold keep</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n * cell}" height="${n * cell + 36}">${parts.join('')}</svg>`;
}

const slugs = ['greenfall', 'rotmire', 'cinder', 'barrow', 'vale'];
for (const [index, level] of LEVELS.slice(0, 5).entries()) {
  const file = join(outDir, `layout-${slugs[index]}.svg`);
  await writeFile(file, svgFor(level));
  console.log('wrote', file);
}
