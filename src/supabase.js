const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.45.4';
export const SUPABASE_WRITE_TIMEOUT_MS = 8000;

let configPromise = null;
let clientPromise = null;

async function fetchWithWriteTimeout(input, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || init.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_WRITE_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Server update timed out. Try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSupabaseConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/auth-config', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error('account backend unavailable');
      const config = await response.json();
      if (!config?.enabled || !config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('account backend not configured');
      }
      return config;
    }).catch((error) => {
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
}

// Auth, profiles, lobby, rooms, and signaling must share one GoTrue client.
// Two clients using the same storage lock can wedge getSession() indefinitely.
export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = Promise.all([loadSupabaseConfig(), import(SUPABASE_JS)])
      .then(([config, { createClient }]) => createClient(config.supabaseUrl, config.supabaseAnonKey, {
        global: { fetch: fetchWithWriteTimeout },
        auth: {
          storageKey: 'zillions.supabase.auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      }))
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}
