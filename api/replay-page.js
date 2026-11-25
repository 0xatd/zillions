// HTML for /r/<id>. Crawlers read the Open Graph tags from this response.
// The browser then loads the same game and plays the replay.
import { REPLAY_ID, replayPreview } from '../src/share-replay.js';
import { HEROES } from '../src/config.js';
import { supabaseReplayStore } from './replay.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function originOf(req) {
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || 'zillions.taborlin.co').split(',')[0].trim();
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return 'https://zillions.taborlin.co';
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

function page({ status = 200, title, description, url, replayId }) {
  const safeTitle = esc(title);
  const safeDescription = esc(description);
  const safeUrl = esc(url);
  const boot = REPLAY_ID.test(replayId || '') ? replayId : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Zillions">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeUrl}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧟</text></svg>">
  <link rel="stylesheet" href="/style.css">
  <script type="importmap">
    { "imports": { "three": "/vendor/three.module.js", "three/addons/": "/vendor/jsm/" } }
  </script>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="ui"></div>
  <div id="dragrect"></div>
  <script>window.__ZILLIONS_REPLAY__=${JSON.stringify(boot)};</script>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`;
  return { status, html };
}

export function replayPageModel({ id, row, origin }) {
  const url = `${origin}/r/${REPLAY_ID.test(id || '') ? id : ''}`;
  if (!row) {
    return {
      status: 404,
      title: 'Zillions replay',
      description: 'This replay link does not match a stored run.',
      url,
      replayId: REPLAY_ID.test(id || '') ? id : '',
    };
  }
  const names = HEROES[row.hero]?.name || row.hero || 'a siege';
  const preview = replayPreview({
    leaders: [row.hero],
    won: !!row.won,
    mode: row.mode,
    seed: Number(row.seed) || 0,
  });
  const title = row.hero && HEROES[row.hero] ? `Zillions replay — ${names}` : preview.title;
  return { status: 200, title, description: preview.description, url, replayId: id };
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/api/replay-page', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  const origin = originOf(req);
  let row = null;
  if (REPLAY_ID.test(id)) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      try { row = await supabaseReplayStore({ url: supabaseUrl, serviceKey }).preview(id); }
      catch { row = null; }
    }
  }
  const model = replayPageModel({ id, row, origin });
  const rendered = page(model);
  res.writeHead(rendered.status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60',
  });
  res.end(rendered.html);
}
