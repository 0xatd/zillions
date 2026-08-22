// Regression: world labels were drawn onto a fixed 256px texture with no
// fitting, so `textAlign:'center'` clipped long names at BOTH ends and
// "OLD CROSSROADS" reached the player as ".D CROSSROA".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fitFontSize, LABEL_TEXTURE_WIDTH, LABEL_PADDING, LABEL_FONT_SIZE, LABEL_FONT_MIN,
} from '../src/utils.js';
import { LEVELS } from '../src/config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const room = LABEL_TEXTURE_WIDTH - LABEL_PADDING * 2;

// Canvas is unavailable headless, so model the metric the renderer measures.
// Bold system-ui averages ~0.62em per character across these caps-only names;
// the ratio is deliberately pessimistic so the check fails before the texture does.
const widthAt = (text, px) => text.length * px * 0.62;

assert.ok(LABEL_TEXTURE_WIDTH >= 512, 'label texture must stay sharp at gameplay distance');
assert.ok(LABEL_FONT_MIN >= 28, 'a fitted name must not shrink below readable size');
assert.ok(LABEL_FONT_MIN < LABEL_FONT_SIZE, 'the fitter needs room to step down');

// Short names keep the full display size — fitting must not shrink everything.
assert.equal(
  fitFontSize((px) => widthAt('RIVER FORD', px), room, LABEL_FONT_SIZE, LABEL_FONT_MIN),
  LABEL_FONT_SIZE,
  'a short name must render at the full label size',
);

// Every shipped place name must fit the texture once fitted.
const names = [
  ...LEVELS.map((lv) => String(lv.name || '').toUpperCase()),
  'THE LABYRINTH', 'OLD CROSSROADS', 'ORBITAL LIFT',
].filter(Boolean);
assert.ok(names.length >= 5, 'level names must be readable from config');
for (const name of names) {
  const size = fitFontSize((px) => widthAt(name, px), room, LABEL_FONT_SIZE, LABEL_FONT_MIN);
  assert.ok(
    widthAt(name, size) <= room,
    `"${name}" still overflows the label texture at ${size}px (${Math.round(widthAt(name, size))} > ${room})`,
  );
}

// The renderer must actually use the fitter, and must pass maxWidth as the
// final backstop for a name too long even at the minimum size.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const defAt = main.indexOf("_makeLabelSprite(text, sub = '')");
assert.ok(defAt > 0, '_makeLabelSprite definition must be findable');
const sprite = main.slice(defAt);
const body = sprite.slice(0, sprite.indexOf('\n  }'));
assert.ok(body.includes('fitFontSize('), '_makeLabelSprite must fit the font to the texture');
assert.match(body, /strokeText\(sub, \d+, \d+, room\)/, 'strokeText needs the maxWidth backstop');
assert.match(body, /fillText\(sub, \d+, \d+, room\)/, 'fillText needs the maxWidth backstop');
assert.ok(!/cnv\.width = 256/.test(body), 'the clipped 256px label texture must not come back');
void root;
console.log('label sprite check passed');
