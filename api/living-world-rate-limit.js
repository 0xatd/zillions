export async function enforceLivingWorldRateLimit({ config, actor, scope, limit, windowSeconds = 60, fetchImpl = globalThis.fetch, override }) {
  const result = override
    ? await override(actor, scope, limit, windowSeconds)
    : await fetchImpl(`${config.url}/rest/v1/rpc/consume_world_api_rate_limit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_actor: actor, p_scope: scope, p_limit: limit, p_window_seconds: windowSeconds }),
    }).then(async (response) => {
      const value = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error(value?.message || 'rate_limit_unavailable'), { status: 503 });
      return value;
    });
  if (!result?.allowed) throw Object.assign(new Error('rate_limit_exceeded'), { status: 429, retryAfter: Number(result?.retryAfterSeconds) || windowSeconds });
  return result;
}
