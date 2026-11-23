// Dump runtime marine recipes (src/marine-recipe.js) as JSON so Blender can
// render exactly the same picks:
//   node scripts/marine-demo-recipes.mjs [count] [baseSeed] > /tmp/marines.json
//   blender -b -P tools/art/build_hero_marines.py -- --demo /tmp/marines.json
import { pickMarine, hashSeed, CHAPTERS } from '../src/marine-recipe.js';

const count = Number(process.argv[2] || 16);
const base = process.argv[3] || 'zillions-demo';
const chapters = Object.keys(CHAPTERS);
const roles = ['soldier', 'ranger', 'sniper', 'heavy', 'melee', 'soldier', 'soldier', 'default'];
const recipes = [];
for (let i = 0; i < count; i++) {
  const chapter = chapters[Math.floor(i / 2) % chapters.length];
  recipes.push({ ...pickMarine(hashSeed(base, i), { chapter, role: roles[i % roles.length] }), chapter, role: roles[i % roles.length] });
}
process.stdout.write(JSON.stringify({ base, recipes }, null, 1));
