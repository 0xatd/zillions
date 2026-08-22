// Small helpers: seeded RNG, value noise, math.

export function makeRNG(seed) {
  let s = seed >>> 0;
  const rng = function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // State is exposed so saved games restore mid-stream deterministically.
  rng.getState = () => s;
  rng.setState = (v) => { s = v >>> 0; };
  return rng;
}

// 2D value noise with a few octaves.
export function makeNoise(rng) {
  const SIZE = 256;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const at = (x, y) => grid[((y & (SIZE - 1)) * SIZE + (x & (SIZE - 1)))];
  const smooth = (t) => t * t * (3 - 2 * t);

  function single(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  return function (x, y, octaves = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += single(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// World-label typography, shared with scripts/label-sprite-check.mjs so the
// check asserts against the values the renderer actually draws with.
export const LABEL_TEXTURE_WIDTH = 512;
export const LABEL_PADDING = 16;
export const LABEL_FONT_SIZE = 68;
export const LABEL_FONT_MIN = 34;

// Canvas text is not fitted: `fillText` centered on a fixed-width texture
// clips a too-wide string at BOTH ends, so "GREENFALL MARCHES" reaches the
// player as ".D CROSSROA". Step the font down until the measured width fits.
// `measure(px)` reports the string's width at that font size, so this stays a
// pure function and the label check can run headless.
export function fitFontSize(measure, maxWidth, baseSize, minSize = 1) {
  let size = Math.max(Math.round(baseSize), minSize);
  while (size > minSize && measure(size) > maxWidth) size -= 1;
  return size;
}
