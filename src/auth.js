import { backendEnabled } from './backend.js';
import { THREAT_PERIOD } from './config.js';
import { getSupabaseClient, loadSupabaseConfig } from './supabase.js';

const USERNAME_MIN = 3;
const USERNAME_MAX = 18;
const USERNAME_RE = /^[a-z0-9_]+$/;

function safeName(value, fallback = 'Commander') {
  const text = String(value || '').trim().slice(0, 24);
  return text || fallback;
}

function fallbackHandleFor(user) {
  const id = String(user?.id || '000000000000').replace(/-/g, '').slice(0, 12) || '000000000000';
  return `player_${id}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN) return { ok: false, username, message: `Use at least ${USERNAME_MIN} characters.` };
  if (username.length > USERNAME_MAX) return { ok: false, username, message: `Use ${USERNAME_MAX} characters or fewer.` };
  if (!USERNAME_RE.test(username)) return { ok: false, username, message: 'Use letters, numbers, and underscores only.' };
  if (username.startsWith('_') || username.endsWith('_')) return { ok: false, username, message: 'Do not start or end with underscore.' };
  if (['admin', 'support', 'zillions', 'system', 'moderator'].includes(username)) {
    return { ok: false, username, message: 'That username is reserved.' };
  }
  return { ok: true, username };
}

function publicName(profile) {
  if (!profile?.username_set) return '';
  return safeName(profile.handle || profile.display_name || '', '');
}

function needsUsername(profile) {
  return !profile?.username_set || !publicName(profile);
}

function isoNow() {
  return new Date().toISOString();
}

export class AuthClient {
  constructor() {
    this.client = null;
    this.session = null;
    this.profile = null;
    this.stats = null;
    this.enabled = false;
    this.ready = false;
    this.error = null;
    this.reason = null;
  }

  get user() {
    return this.session?.user || null;
  }

  isSignedIn() {
    return !!this.user;
  }

  status(extra = {}) {
    const user = this.user;
    const username = publicName(this.profile);
    return {
      ready: this.ready,
      enabled: this.enabled,
      signedIn: !!user,
      email: '',
      name: username || 'Commander',
      username,
      needsUsername: !!user && needsUsername(this.profile),
      error: this.error,
      reason: this.reason,
      ...extra,
    };
  }

  async init() {
    this.ready = false;
    this.error = null;
    this.reason = null;
    if (!backendEnabled()) {
      this.ready = true;
      this.reason = 'static';
      return this.status({ enabled: false, reason: 'static' });
    }

    let config;
    try {
      config = await loadSupabaseConfig();
    } catch {
      this.ready = true;
      this.error = 'Cloud profile config is unavailable.';
      this.enabled = false;
      this.reason = 'config_error';
      return this.status({ enabled: false });
    }
    this.client = await getSupabaseClient();
    this.enabled = true;
    this.reason = null;

    const { data, error } = await this.client.auth.getSession();
    if (error) this.error = error.message || 'Could not load cloud profile.';
    this.session = data?.session || null;
    this.ready = true;
    return this.status();
  }

  onAuthChange(callback) {
    if (!this.client) return null;
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      this.session = session || null;
      callback(this.status());
    });
    return data?.subscription || null;
  }

  async signInWithGoogle() {
    if (!this.client) await this.init();
    if (!this.client || !this.enabled) throw new Error('Cloud profile is not configured.');
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
  }

  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.session = null;
  }

  profileFromBundle(bundle) {
    if (!bundle?.profile) return null;
    const profile = bundle.profile;
    const stats = bundle.stats || {};
    const username = publicName(profile);
    return {
      name: username,
      username,
      usernameSet: !!profile.username_set,
      needsUsername: needsUsername(profile),
      games: stats.games_played || 0,
      wins: stats.wins || 0,
      kills: stats.total_kills || 0,
      bestDay: stats.best_day || 0,
      lastHero: profile.selected_hero || stats.favorite_hero || null,
      updatedAt: Date.parse(profile.updated_at || stats.updated_at || '') || 0,
    };
  }

  async ensureProfile(localProfile = {}) {
    if (!this.client || !this.user) return null;
    const user = this.user;
    let selectedHero = localProfile.lastHero || this.profile?.selected_hero || 'alexander';
    const { data: existing, error: readError } = await this.client.from('profiles')
      .select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
      .eq('id', user.id)
      .maybeSingle();
    if (readError) throw readError;

    if (existing) {
      selectedHero = localProfile.lastHero || existing.selected_hero || selectedHero;
      const { data, error } = await this.client.from('profiles').update({
        selected_hero: selectedHero,
        last_seen_at: isoNow(),
      }).eq('id', user.id)
        .select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
        .single();
      if (error) throw error;
      this.profile = data || existing;
    } else {
      const handle = fallbackHandleFor(user);
      const { data, error } = await this.client.from('profiles').insert({
        id: user.id,
        handle,
        display_name: handle,
        username_set: false,
        selected_hero: selectedHero,
        last_seen_at: isoNow(),
      }).select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
        .single();
      if (error) throw error;
      this.profile = data;
    }

    const { error: statsError } = await this.client.from('player_stats').upsert({
      user_id: user.id,
      favorite_hero: selectedHero,
    }, { onConflict: 'user_id' });
    if (statsError) throw statsError;
  }

  async loadProfileBundle() {
    if (!this.client || !this.user) return null;
    await this.ensureProfile();
    const userId = this.user.id;
    const [{ data: profile, error: profileError }, { data: stats, error: statsError }] = await Promise.all([
      this.client.from('profiles')
        .select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
        .eq('id', userId)
        .maybeSingle(),
      this.client.from('player_stats')
        .select('games_played,wins,losses,total_kills,best_day,best_wave,buildings_built,favorite_hero,updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (statsError) throw statsError;
    this.profile = profile || this.profile;
    this.stats = stats || this.stats;
    return { profile, stats };
  }

  async setUsername(value) {
    if (!this.client || !this.user) throw new Error('Sign in before choosing a username.');
    const checked = validateUsername(value);
    if (!checked.ok) throw new Error(checked.message);
    await this.ensureProfile();
    const { data, error } = await this.client.from('profiles').update({
      handle: checked.username,
      display_name: checked.username,
      username_set: true,
      last_seen_at: isoNow(),
    }).eq('id', this.user.id)
      .select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('That username is taken.');
      throw error;
    }
    this.profile = data;
    return data;
  }

  async syncLocalProfile(localProfile = {}) {
    if (!this.client || !this.user) return;
    const games = Number(localProfile.games || 0);
    const wins = Number(localProfile.wins || 0);
    const hero = localProfile.lastHero || 'alexander';
    await this.ensureProfile(localProfile);
    const [{ error: profileError }, { error: statsError }] = await Promise.all([
      this.client.from('profiles').update({
        selected_hero: hero,
        last_seen_at: isoNow(),
      }).eq('id', this.user.id),
      this.client.from('player_stats').upsert({
        user_id: this.user.id,
        games_played: games,
        wins,
        losses: Math.max(0, games - wins),
        total_kills: Number(localProfile.kills || 0),
        best_day: Number(localProfile.bestDay || 0),
        favorite_hero: hero,
        updated_at: isoNow(),
      }, { onConflict: 'user_id' }),
    ]);
    if (profileError) throw profileError;
    if (statsError) throw statsError;
  }

  async loadLatestSave() {
    if (!this.client || !this.user) return null;
    const { data, error } = await this.client.from('save_slots')
      .select('slot_key,summary,snapshot,updated_at')
      .eq('user_id', this.user.id)
      .eq('slot_key', 'latest')
      .maybeSingle();
    if (error) throw error;
    if (!data?.snapshot) return null;
    return {
      when: Number(data.summary?.when || 0) || Date.parse(data.updated_at || '') || Date.now(),
      snap: data.snapshot,
    };
  }

  async syncLatestSave(save) {
    if (!this.client || !this.user || !save?.snap) return;
    const snap = save.snap;
    // `day` is the schema's progress column; under continuous siege it carries
    // the Threat level the run reached.
    const day = Math.max(1, snap.threatLevel || Math.floor(Number(snap.time || 0) / THREAT_PERIOD) + 1);
    const { error } = await this.client.from('save_slots').upsert({
      user_id: this.user.id,
      slot_key: 'latest',
      hero: snap.heroKeys?.[0] || null,
      day,
      summary: {
        when: save.when || Date.now(),
        difficulty: snap.diff,
        level: snap.level || 1,
        players: snap.heroKeys?.length || 1,
      },
      snapshot: snap,
    }, { onConflict: 'user_id,slot_key' });
    if (error) throw error;
  }

  async clearLatestSave() {
    if (!this.client || !this.user) return;
    const { error } = await this.client.from('save_slots')
      .delete()
      .eq('user_id', this.user.id)
      .eq('slot_key', 'latest');
    if (error) throw error;
  }

  async recordMatch(summary) {
    if (!this.client || !this.user || !summary) return;
    const { error } = await this.client.from('match_history').insert({
      user_id: this.user.id,
      mode: summary.mode || 'survival',
      rules: summary.rules || 'survival-plots',
      hero: summary.heroKeys?.[0] || summary.hero || null,
      result: summary.won ? 'win' : 'loss',
      day_reached: Number(summary.day || 0),
      kills: Number(summary.kills || 0),
      buildings_built: Number(summary.built || 0),
      duration_seconds: Number(summary.durationSeconds || 0),
      visibility: 'private',
      summary,
    });
    if (error) throw error;
  }
}
