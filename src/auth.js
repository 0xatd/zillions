import { backendEnabled } from './backend.js';
import { DAY_LENGTH } from './config.js';

const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.45.4';

function safeName(value, fallback = 'Commander') {
  const text = String(value || '').trim().slice(0, 24);
  return text || fallback;
}

function handleFor(user) {
  const emailName = String(user?.email || '').split('@')[0] || 'player';
  const base = emailName.toLowerCase().replace(/[^a-z0-9_]+/g, '').slice(0, 18) || 'player';
  return `${base}_${String(user?.id || '0000').replace(/-/g, '').slice(0, 6)}`;
}

function userDisplayName(user) {
  return safeName(
    user?.user_metadata?.name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
  );
}

function isoNow() {
  return new Date().toISOString();
}

export class AuthClient {
  constructor() {
    this.client = null;
    this.session = null;
    this.enabled = false;
    this.ready = false;
    this.error = null;
  }

  get user() {
    return this.session?.user || null;
  }

  isSignedIn() {
    return !!this.user;
  }

  status(extra = {}) {
    const user = this.user;
    return {
      ready: this.ready,
      enabled: this.enabled,
      signedIn: !!user,
      email: user?.email || '',
      name: userDisplayName(user),
      error: this.error,
      ...extra,
    };
  }

  async init() {
    this.ready = false;
    this.error = null;
    if (!backendEnabled()) {
      this.ready = true;
      return this.status({ enabled: false, reason: 'static' });
    }

    const response = await fetch('/api/auth-config', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      this.ready = true;
      this.error = 'Cloud profile config is unavailable.';
      return this.status({ enabled: false });
    }

    const config = await response.json();
    if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) {
      this.ready = true;
      this.enabled = false;
      return this.status({ enabled: false, reason: 'not_configured' });
    }

    const { createClient } = await import(SUPABASE_JS);
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storageKey: 'zillions.supabase.auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
    this.enabled = true;

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
    return {
      name: profile.display_name || '',
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
    const displayName = safeName(localProfile.name, userDisplayName(user));
    const selectedHero = localProfile.lastHero || 'alexander';
    const { error: profileError } = await this.client.from('profiles').upsert({
      id: user.id,
      handle: handleFor(user),
      display_name: displayName,
      selected_hero: selectedHero,
      last_seen_at: isoNow(),
    }, { onConflict: 'id' });
    if (profileError) throw profileError;

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
        .select('id,handle,display_name,selected_hero,updated_at,last_seen_at')
        .eq('id', userId)
        .maybeSingle(),
      this.client.from('player_stats')
        .select('games_played,wins,losses,total_kills,best_day,best_wave,buildings_built,favorite_hero,updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (statsError) throw statsError;
    return { profile, stats };
  }

  async syncLocalProfile(localProfile = {}) {
    if (!this.client || !this.user) return;
    const games = Number(localProfile.games || 0);
    const wins = Number(localProfile.wins || 0);
    const hero = localProfile.lastHero || 'alexander';
    await this.ensureProfile(localProfile);
    const [{ error: profileError }, { error: statsError }] = await Promise.all([
      this.client.from('profiles').update({
        display_name: safeName(localProfile.name, userDisplayName(this.user)),
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
    const day = Math.max(1, Math.floor(Number(snap.time || 0) / DAY_LENGTH) + 1);
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
