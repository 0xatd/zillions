// Shared menu chrome: one icon set, one toast queue renderer, one confirm sheet.
// Icons are inline SVG so the menus do not depend on an emoji font.

const svg = (paths) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = Object.freeze({
  play: svg('<path d="M8 6l10 6-10 6z"/>'),
  squad: svg('<circle cx="8" cy="9" r="2.2"/><circle cx="16" cy="9" r="2.2"/><path d="M4.5 18c.6-2.4 2.2-3.6 3.5-3.6S11 15.6 11.5 18M12.5 18c.6-2.4 2.2-3.6 3.5-3.6s2.9 1.2 3.5 3.6"/>'),
  armory: svg('<path d="M12 3l7 3v6c0 4.2-2.8 7.2-7 9-4.2-1.8-7-4.8-7-9V6z"/><path d="M12 8v5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>'),
  account: svg('<circle cx="12" cy="9" r="3"/><path d="M5 19c1.2-3 3.4-4.5 7-4.5S17.8 16 19 19"/>'),
  credits: svg('<path d="M7 4h10v16H7z"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  assault: svg('<path d="M12 3l2 6h6l-5 4 2 6-5-3.5L7 19l2-6-5-4h6z"/>'),
  defend: svg('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>'),
  recruit: svg('<circle cx="12" cy="8" r="3"/><path d="M6 19c1-3 3-4.5 6-4.5s5 1.5 6 4.5"/>'),
  trade: svg('<path d="M4 8h12l-3-3M20 16H8l3 3"/>'),
  build: svg('<path d="M4 20h16M7 20V9l5-4 5 4v11"/>'),
  travel: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.4 2.5 13.6 0 16M12 4c-2.5 2.4-2.5 13.6 0 16"/>'),
  audio: svg('<path d="M4 10h3l4-3v10l-4-3H4zM15 9a4 4 0 010 6"/>'),
  video: svg('<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 15h18"/>'),
  controls: svg('<rect x="3" y="8" width="18" height="10" rx="3"/><path d="M8 13h3M9.5 11.5v3M16 12.5h.01M18 14.5h.01"/>'),
  campaign: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  coop: svg('<circle cx="8" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M4 18c.8-2.2 2.4-3.2 4-3.2s3.2 1 4 3.2M12 18c.8-2.2 2.4-3.2 4-3.2s3.2 1 4 3.2"/>'),
  versus: svg('<path d="M6 16l4-8 2 4 2-4 4 8"/>'),
  custom: svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  invite: svg('<path d="M12 5v8M8 9h8"/><rect x="4" y="13" width="16" height="6" rx="1"/>'),
  mark: svg('<circle cx="12" cy="12" r="3"/>'),
});

export const icon = (name) => `<span class="ico" aria-hidden="true">${ICONS[name] || ICONS.mark}</span>`;

const SEVERITY = new Set(['info', 'good', 'bad', 'danger']);

export function renderToasts(host, toasts, onDismiss) {
  if (!host) return;
  host.replaceChildren();
  for (const item of toasts) {
    const row = document.createElement('div');
    row.className = `toast toast-${SEVERITY.has(item.severity) ? item.severity : 'info'}`;
    row.setAttribute('role', item.severity === 'bad' || item.severity === 'danger' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = item.text;
    row.appendChild(text);
    if (item.actions) {
      for (const action of item.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = action.label;
        button.onclick = () => {
          onDismiss(item.id);
          action.run?.();
        };
        row.appendChild(button);
      }
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = ICONS.close;
    close.onclick = () => onDismiss(item.id);
    row.appendChild(close);
    host.appendChild(row);
  }
}

// One confirm sheet. Resolves true when the danger action is chosen.
export function openConfirm(host, { title, copy, confirm, cancel, danger = false } = {}) {
  return new Promise((resolve) => {
    if (!host) { resolve(false); return; }
    host.classList.remove('hidden');
    host.querySelector('[data-confirm-title]').textContent = title || 'Confirm';
    host.querySelector('[data-confirm-copy]').textContent = copy || '';
    const yes = host.querySelector('[data-confirm-yes]');
    const no = host.querySelector('[data-confirm-no]');
    yes.textContent = confirm || 'Confirm';
    no.textContent = cancel || 'Cancel';
    yes.classList.toggle('danger', !!danger);
    const finish = (value) => {
      host.classList.add('hidden');
      yes.onclick = null;
      no.onclick = null;
      resolve(value);
    };
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
    no.focus();
  });
}

export function menuFocus(list, direction) {
  if (!list) return;
  const items = [...list.querySelectorAll('button:not(:disabled):not(.soon)')];
  if (!items.length) return;
  const current = items.findIndex((button) => button.classList.contains('is-focus'));
  const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
  for (const button of items) button.classList.toggle('is-focus', button === items[next]);
  items[next].focus();
}
