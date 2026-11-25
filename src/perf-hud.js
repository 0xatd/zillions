// Dev-only overlay. Off unless the page is opened with ?perf=1, ?bench=,
// or localStorage zillions_perf_hud=1. It never feeds the simulation.

const HUD_KEY = 'zillions_perf_hud';

export function perfHudWanted() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('perf') === '0') return false;
    if (params.has('perf') || params.has('bench')) return true;
    return localStorage.getItem(HUD_KEY) === '1';
  } catch {
    return false;
  }
}

export function mountPerfHud() {
  const el = document.createElement('div');
  el.id = 'perf-hud';
  el.setAttribute('aria-live', 'off');
  el.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:40',
    'font:12px/1.35 ui-monospace,monospace', 'color:#e8e6df',
    'background:rgba(8,10,14,0.82)', 'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:8px', 'padding:6px 8px', 'pointer-events:none',
    'white-space:pre',
  ].join(';');
  document.body.appendChild(el);
  let last = 0;
  return {
    update(sample, now = performance.now()) {
      if (now - last < 250) return;
      last = now;
      const fps = sample.fps || 0;
      const draws = sample.drawCalls || 0;
      const tris = sample.triangles || 0;
      const sim = sample.simMs || 0;
      el.textContent = [
        `${fps.toFixed(0).padStart(3, ' ')} fps`,
        `${String(draws).padStart(4, ' ')} draws`,
        `${(tris / 1000).toFixed(0).padStart(4, ' ')}k tris`,
        `sim ${sim.toFixed(2)} ms`,
        sample.label || '',
      ].join('   ');
    },
    dispose() { el.remove(); },
  };
}
