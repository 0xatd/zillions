import { backendEnabled, setBackendSession } from './backend.js';
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

function campaignProgress(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.floor(progress)) : fallback;
}

// Server-owned account progress (player_stats, written by apply_match_result).
export function serverProgress(stats = {}) {
  if (!Number.isInteger(stats?.campaign_cleared)) return {};
  return {
    bestSurvival: Number(stats.best_survival) || 0,
    relics: Array.isArray(stats.relics) ? stats.relics.filter((key) => typeof key === 'string') : [],
    questsDone: stats.quests_done && typeof stats.quests_done === 'object' ? { ...stats.quests_done } : {},
    labyrinthClears: stats.labyrinth_clears && typeof stats.labyrinth_clears === 'object' ? { ...stats.labyrinth_clears } : {},
  };
}

// Level and XP live in game_characters. Metadata copies are client-written,
// so the server row always wins when it carries the progress columns.
export function overlayServerProgress(characters = [], rows = []) {
  const byId = new Map((Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.progress_revision != null)
    .map((row) => [row.client_character_id, row]));
  return characters.map((character) => {
    const row = byId.get(character?.id);
    if (!row) return character;
    return {
      ...character,
      level: Math.max(1, Math.min(100, Number(row.level) || 1)),
      xp: Math.max(0, Number(row.xp) || 0),
      stats: { instances: 0, victories: 0, kills: 0, ...(row.stats || {}) },
      progressRevision: Number(row.progress_revision) || 1,
    };
  });
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
    setBackendSession(this.session);
    this.ready = true;
    return this.status();
  }

  onAuthChange(callback) {
    if (!this.client) return null;
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      this.session = session || null;
      setBackendSession(this.session);
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

  async signInWithEmail(email) {
    if (!this.client) await this.init();
    if (!this.client || !this.enabled) throw new Error('Cloud profile is not configured.');
    const address = String(email || '').trim().toLowerCase();
    if (!address || !address.includes('@')) throw new Error('Enter a valid email address.');
    const { error } = await this.client.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: `${location.origin}/`,
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
    return address;
  }

  async signOut() {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.session = null;
    setBackendSession(null);
  }

  profileFromBundle(bundle) {
    if (!bundle?.profile) return null;
    const profile = bundle.profile;
    const stats = bundle.stats || {};
    const username = publicName(profile);
    const mmoCharacters = Array.isArray(this.user?.user_metadata?.mmo_characters)
      ? this.user.user_metadata.mmo_characters : null;
    // Server progress (player_stats.campaign_cleared) wins once the
    // server-progress migration is applied; the metadata copy is a legacy
    // fallback for databases that have not run it yet.
    const campaign = Number.isInteger(stats.campaign_cleared)
      ? stats.campaign_cleared
      : campaignProgress(this.user?.user_metadata?.campaign);
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
      ...(campaign !== null ? { campaign } : {}),
      ...serverProgress(stats),
      ...(mmoCharacters ? {
        mmoCharacters: overlayServerProgress(mmoCharacters, bundle.characters),
        mmoCharacterId: this.user?.user_metadata?.mmo_character_id || mmoCharacters[0]?.id || null,
      } : {}),
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

    // player_stats is server-owned (api/match-result.js); the signup trigger
    // creates the row and only apply_match_result() changes it.
  }

  async loadProfileBundle() {
    if (!this.client || !this.user) return null;
    await this.ensureProfile();
    const userId = this.user.id;
    // `*` keeps this working both before and after the server-progress
    // migration adds its columns.
    const [{ data: profile, error: profileError }, { data: stats, error: statsError }, characterResult] = await Promise.all([
      this.client.from('profiles')
        .select('id,handle,display_name,selected_hero,username_set,updated_at,last_seen_at')
        .eq('id', userId)
        .maybeSingle(),
      this.client.from('player_stats')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      this.client.from('game_characters')
        .select('*')
        .eq('user_id', userId),
    ]);
    if (profileError) throw profileError;
    if (statsError) throw statsError;
    this.profile = profile || this.profile;
    this.stats = stats || this.stats;
    const characters = !characterResult?.error && Array.isArray(characterResult?.data) ? characterResult.data : [];
    return { profile, stats, characters };
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
    const hero = localProfile.lastHero || 'alexander';
    const campaign = Math.max(
      campaignProgress(localProfile.campaign, 0),
      campaignProgress(this.user?.user_metadata?.campaign, 0),
    );
    await this.ensureProfile(localProfile);
    // Stats and progression are NOT synced from here: the server grants them
    // (api/match-result.js). Metadata keeps cosmetic character state (name,
    // look, Lattice choices); level/XP in it are overwritten from
    // game_characters on every load.
    const [{ error: profileError }, userResult] = await Promise.all([
      this.client.from('profiles').update({
        selected_hero: hero,
        last_seen_at: isoNow(),
      }).eq('id', this.user.id),
      this.client.auth.updateUser({ data: {
        campaign,
        mmo_character_id: localProfile.mmoCharacterId || null,
        mmo_characters: Array.isArray(localProfile.mmoCharacters) ? localProfile.mmoCharacters.slice(0, 8) : [],
      } }),
    ]);
    if (profileError) throw profileError;
    const { data: userData, error: userError } = userResult;
    if (userError) throw userError;
    if (userData?.user && this.session) {
      this.session = { ...this.session, user: userData.user };
      setBackendSession(this.session);
    }
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

}
