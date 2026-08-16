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

  // Optional extra ICE servers (TURN relay for strict NATs). Set
  // WEBRTC_ICE_SERVERS to a JSON array of RTCIceServer objects, e.g.
  // [{"urls":"turn:turn.example.com:3478","username":"u","credential":"c"}]
  let iceServers = null;
  try {
    const parsed = JSON.parse(process.env.WEBRTC_ICE_SERVERS || 'null');
    if (Array.isArray(parsed) && parsed.length) iceServers = parsed;
  } catch { iceServers = null; }

  send(res, 200, {
    ok: true,
    enabled: !!(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
    ...(iceServers ? { iceServers } : {}),
  });
}
