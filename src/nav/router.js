// One navigation state machine for every menu.
// Routes are a stack. Back pops. Replace lands. One modal sits above the
// stack. Toasts queue beside it. A match only allows the routes marked match.

export const ROUTES = Object.freeze({
  title: { screen: 'account', match: false },
  characters: { screen: 'main', match: false },
  home: { screen: 'home', match: false },
  overworld: { screen: 'overworld', match: false },
  squad: { screen: 'squad', match: false },
  armory: { screen: 'character-sheet', match: false },
  create: { screen: 'character-create', match: false },
  custom: { screen: 'custom', match: false },
  setup: { screen: 'setup', match: false },
  quick: { screen: 'quick', match: false },
  daily: { screen: 'daily', match: false },
  share: { screen: 'share', match: false },
  credits: { screen: 'credits', match: false },
  settings: { screen: 'settings', match: true },
  help: { screen: 'help', match: true },
  pause: { screen: 'pause', match: true },
  results: { screen: 'results', match: true },
  loading: { screen: null, match: true },
  match: { screen: null, match: true },
});

// Older call sites still say "main" or "lobby". They land on one route.
export const SCREEN_TO_ROUTE = Object.freeze({
  account: 'title',
  main: 'characters',
  home: 'home',
  overworld: 'overworld',
  squad: 'squad',
  'character-sheet': 'armory',
  'character-create': 'create',
  custom: 'custom',
  lobby: 'custom',
  setup: 'setup',
  quick: 'quick',
  daily: 'daily',
  share: 'share',
  credits: 'credits',
  settings: 'settings',
  help: 'help',
  pause: 'pause',
  results: 'results',
  heroes: 'armory',
  cinematics: 'title',
  solo: 'home',
});

const routeName = (name) => SCREEN_TO_ROUTE[name] || name;

export class NavRouter {
  constructor() {
    this.stack = [{ name: 'title', params: {} }];
    this.modal = null;
    this.toasts = [];
    this.inMatch = false;
    this._seq = 1;
  }

  current() {
    return this.stack[this.stack.length - 1];
  }

  screen() {
    return ROUTES[this.current().name]?.screen || null;
  }

  allowed(name) {
    const route = ROUTES[name];
    if (!route) return false;
    if (!this.inMatch) return name !== 'match';
    return route.match === true;
  }

  push(name, params = {}) {
    const next = routeName(name);
    if (!ROUTES[next]) throw new Error(`invalid_route:${name}`);
    if (!this.allowed(next)) throw new Error(`route_blocked_in_match:${next}`);
    const idx = this.stack.findIndex((entry) => entry.name === next);
    if (idx >= 0) {
      this.stack = this.stack.slice(0, idx + 1);
      this.stack[idx] = { name: next, params: { ...this.stack[idx].params, ...params } };
    } else {
      this.stack.push({ name: next, params: { ...params } });
    }
    return this.snapshot();
  }

  replace(name, params = {}) {
    const next = routeName(name);
    if (!ROUTES[next]) throw new Error(`invalid_route:${name}`);
    if (this.inMatch && !ROUTES[next].match) throw new Error(`route_blocked_in_match:${next}`);
    this.stack = [{ name: next, params: { ...params } }];
    this.modal = null;
    return this.snapshot();
  }

  back() {
    if (this.modal) {
      this.modal = null;
      return this.snapshot();
    }
    if (this.stack.length > 1) this.stack.pop();
    return this.snapshot();
  }

  openModal(name, params = {}) {
    if (!name) throw new Error('invalid_modal');
    this.modal = { name, params: { ...params } };
    return this.snapshot();
  }

  closeModal() {
    this.modal = null;
    return this.snapshot();
  }

  enterMatch() {
    this.inMatch = true;
    this.modal = null;
    this.stack = [{ name: 'match', params: {} }];
    return this.snapshot();
  }

  leaveMatch(destination = 'home') {
    this.inMatch = false;
    return this.replace(destination);
  }

  toast(text, options = {}) {
    const item = {
      id: this._seq++,
      text: String(text ?? ''),
      severity: options.severity || 'info',
      ttl: Number.isFinite(options.ttl) ? options.ttl : 3200,
      actions: options.actions || null,
    };
    this.toasts = [...this.toasts, item].slice(-4);
    return item;
  }

  dismissToast(id) {
    this.toasts = this.toasts.filter((item) => item.id !== id);
    return this.snapshot();
  }

  snapshot() {
    return {
      stack: this.stack.map((entry) => ({ name: entry.name, params: { ...entry.params } })),
      current: this.current().name,
      screen: this.screen(),
      modal: this.modal ? { name: this.modal.name, params: { ...this.modal.params } } : null,
      inMatch: this.inMatch,
      toasts: this.toasts.map((item) => ({ ...item })),
    };
  }
}
