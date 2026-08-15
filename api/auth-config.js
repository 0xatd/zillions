const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function send(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    send(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  send(res, 200, {
    ok: true,
    enabled: !!(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
  });
}
