// Graphics presets. Presentation only: nothing here is read by the simulation,
// so a quality change cannot affect lockstep, saves, or the state hash.
//
// The persisted value is the player's choice: low, medium, high, or auto.
// Auto resolves to a tier from a GPU probe, then may step down one tier at a
// time when presented frames stay under about 40 FPS. Stepping down does not
// overwrite the saved "auto" choice.

export const QUALITY_KEY = 'zillions_graphics_quality';
export const QUALITY_CHOICES = ['low', 'medium', 'high', 'auto'];

// impostorDistance is world distance from the camera focus. 0 keeps every
// unit on its full mesh. High stays at 0 so a strong GPU keeps the full
// horde. Pixel-ratio caps are ceilings; dynamic resolution can scale lower
// on low and medium only.
export const GRAPHICS_PRESETS = {
  low: {
    tier: 'low',
    pixelRatioCap: 1,
    dynamicResolution: true,
    dynamicMinScale: 0.6,
    shadows: false,
    shadowMapSize: 0,
    post: 'off',
    antialias: false,
    hordeShadows: false,
    coinShadows: false,
    corpseShadows: false,
    particles: 480,
    decals: 8,
    projectiles: 48,
    corpses: 140,
    fxScale: 0.35,
    impostorDistance: 6,
    foliageDistance: 26,
    frustumCull: true,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1,
    dynamicResolution: true,
    dynamicMinScale: 0.75,
    shadows: true,
    shadowMapSize: 1024,
    post: 'off',
    antialias: false,
    hordeShadows: false,
    coinShadows: false,
    corpseShadows: false,
    particles: 1400,
    decals: 16,
    projectiles: 80,
    corpses: 320,
    fxScale: 0.65,
    impostorDistance: 16,
    foliageDistance: 42,
    frustumCull: true,
  },
  high: {
    tier: 'high',
    pixelRatioCap: 1.5,
    dynamicResolution: false,
    dynamicMinScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    post: 'full',
    antialias: true,
    hordeShadows: true,
    coinShadows: true,
    corpseShadows: true,
    particles: 3000,
    decals: 32,
    projectiles: 120,
    corpses: 600,
    fxScale: 1,
    impostorDistance: 0,
    foliageDistance: 0,
    frustumCull: true,
  },
};

export function normalizeQualityChoice(value) {
  return QUALITY_CHOICES.includes(value) ? value : null;
}

export function nextQualityChoice(choice) {
  const current = normalizeQualityChoice(choice) || 'auto';
  const index = QUALITY_CHOICES.indexOf(current);
  return QUALITY_CHOICES[(index + 1) % QUALITY_CHOICES.length];
}

export function stepDownTier(tier) {
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  return 'low';
}

// Software and ancient integrated GPUs land on low. Modern integrated GPUs
// land on medium. Discrete GPUs land on high. Missing info stays conservative.
export function probeGraphicsTier({
  renderer = '',
  vendor = '',
  deviceMemory = 8,
  hardwareConcurrency = 8,
} = {}) {
  const text = `${renderer} ${vendor}`.toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|software raster|microsoft basic|basic render|vmware svga|virtualbox|lavapipe/.test(text);
  if (!text.trim() || software) return 'low';
  const memory = Number(deviceMemory) || 8;
  const cores = Number(hardwareConcurrency) || 8;
  if (memory <= 2 || cores <= 2) return 'low';
  const integrated = /intel/.test(text) && /hd graphics|uhd|iris|hd graphics|hd\b/.test(text);
  if (integrated || memory <= 4) return cores <= 4 && integrated ? 'low' : 'medium';
  if (/nvidia|geforce|quadro|radeon|amd|apple|adreno|mali/.test(text)) {
    return memory <= 4 ? 'medium' : 'high';
  }
  return cores <= 4 ? 'medium' : 'high';
}

export function readGraphicsChoice(storage) {
  try {
    return normalizeQualityChoice(storage.getItem(QUALITY_KEY));
  } catch {
    return null;
  }
}

export function resolveGraphics(choice, probe = {}) {
  const selected = normalizeQualityChoice(choice) || 'auto';
  const tier = selected === 'auto' ? probeGraphicsTier(probe) : selected;
  return { choice: selected, tier, preset: GRAPHICS_PRESETS[tier] };
}

// Presented-frame stats. 1% low is the FPS of the 99th-percentile frame time
// (the slowest 1% of frames), which is the number a hitch shows the player.
export function frameStats(frameMs) {
  if (!frameMs?.length) return { avgFps: 0, low1Fps: 0, frames: 0 };
  let sum = 0;
  for (const ms of frameMs) sum += ms;
  const sorted = frameMs.slice().sort((a, b) => a - b);
  // Same index the combat benchmark uses: ceil(n * 0.99) - 1.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.99) - 1));
  const mean = sum / frameMs.length;
  return {
    avgFps: mean > 0 ? 1000 / mean : 0,
    low1Fps: sorted[index] > 0 ? 1000 / sorted[index] : 0,
    frames: frameMs.length,
  };
}

// One throwaway context, released before the game renderer is created.
// An explicit preset boots without a GPU read. {} is not a probe: Auto must
// still sample the GPU the first time the player selects it.
export function gpuProbeReady(probe) {
  return !!(probe && String(probe.renderer || probe.vendor || '').trim());
}

export function probeGpuSignals() {
  const signals = {
    renderer: '',
    vendor: '',
    deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory || 8 : 8,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8,
  };
  if (typeof document === 'undefined') return signals;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
    || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });
  if (!gl) {
    signals.renderer = 'software';
    return signals;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  signals.renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
  signals.vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '') : String(gl.getParameter(gl.VENDOR) || '');
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return signals;
}
