import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHICS_PRESETS,
  frameStats,
  nextQualityChoice,
  normalizeQualityChoice,
  gpuProbeReady,
  probeGraphicsTier,
  resolveGraphics,
  stepDownTier,
} from '../src/graphics-quality.js';

test('quality choices normalize and cycle without inventing a tier', () => {
  assert.equal(normalizeQualityChoice('medium'), 'medium');
  assert.equal(normalizeQualityChoice('ultra'), null);
  assert.equal(nextQualityChoice('low'), 'medium');
  assert.equal(nextQualityChoice('auto'), 'low');
  assert.equal(nextQualityChoice('nope'), 'low');
});

test('GPU probe sends software renderers to low and discrete GPUs to high', () => {
  assert.equal(probeGraphicsTier({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }), 'low');
  assert.equal(probeGraphicsTier({ renderer: 'llvmpipe (LLVM 15)', vendor: 'Mesa' }), 'low');
  assert.equal(probeGraphicsTier({ renderer: '', vendor: '' }), 'low');
  assert.equal(probeGraphicsTier({
    renderer: 'Intel(R) UHD Graphics 620', vendor: 'Intel', deviceMemory: 8, hardwareConcurrency: 8,
  }), 'medium');
  assert.equal(probeGraphicsTier({
    renderer: 'NVIDIA GeForce RTX 4070', vendor: 'NVIDIA', deviceMemory: 16, hardwareConcurrency: 16,
  }), 'high');
  assert.equal(probeGraphicsTier({
    renderer: 'NVIDIA GeForce GTX 1050', vendor: 'NVIDIA', deviceMemory: 4, hardwareConcurrency: 4,
  }), 'medium');
});

test('an empty probe is not a GPU reading', () => {
  assert.equal(gpuProbeReady(null), false);
  assert.equal(gpuProbeReady({}), false);
  assert.equal(gpuProbeReady({ renderer: '   ' }), false);
  assert.equal(gpuProbeReady({ renderer: 'NVIDIA GeForce RTX 4070' }), true);
});

test('auto resolves from the probe and an explicit choice stays put', () => {
  const auto = resolveGraphics('auto', { renderer: 'SwiftShader' });
  assert.equal(auto.choice, 'auto');
  assert.equal(auto.tier, 'low');
  assert.equal(auto.preset, GRAPHICS_PRESETS.low);
  const high = resolveGraphics('high', { renderer: 'SwiftShader' });
  assert.equal(high.tier, 'high');
  assert.equal(high.preset.shadowMapSize, 2048);
  assert.equal(high.preset.post, 'full');
  assert.equal(high.preset.impostorDistance, 0);
});

test('presets only reduce cost as the tier drops, and high keeps the full look', () => {
  assert.equal(GRAPHICS_PRESETS.low.shadows, false);
  assert.equal(GRAPHICS_PRESETS.low.antialias, false);
  assert.ok(GRAPHICS_PRESETS.low.particles < GRAPHICS_PRESETS.medium.particles);
  assert.ok(GRAPHICS_PRESETS.medium.particles < GRAPHICS_PRESETS.high.particles);
  assert.ok(GRAPHICS_PRESETS.low.projectiles < GRAPHICS_PRESETS.high.projectiles);
  assert.equal(GRAPHICS_PRESETS.medium.shadowMapSize, 1024);
  assert.equal(GRAPHICS_PRESETS.high.hordeShadows, true);
  assert.equal(GRAPHICS_PRESETS.high.foliageDistance, 0);
  assert.ok(GRAPHICS_PRESETS.low.foliageDistance < GRAPHICS_PRESETS.medium.foliageDistance);
  assert.equal(GRAPHICS_PRESETS.medium.hordeShadows, false);
  assert.equal(GRAPHICS_PRESETS.high.dynamicResolution, false);
  assert.equal(stepDownTier('high'), 'medium');
  assert.equal(stepDownTier('medium'), 'low');
  assert.equal(stepDownTier('low'), 'low');
});

test('1% low FPS is the 99th-percentile frame time', () => {
  const frames = Array.from({ length: 100 }, (_, i) => (i >= 97 ? 50 : 16));
  const stats = frameStats(frames);
  assert.equal(stats.frames, 100);
  assert.ok(Math.abs(stats.low1Fps - 20) < 0.01);
  assert.ok(stats.avgFps > stats.low1Fps);
  assert.deepEqual(frameStats([]), { avgFps: 0, low1Fps: 0, frames: 0 });
});
