/**
 * SearchMyData local dev server
 *
 * Run:
 *   node server.js                                    ← mock Google sign-in
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node server.js  ← real OAuth
 *
 * Real Google credentials:
 *   console.cloud.google.com → APIs & Services → Credentials → Create → Web app
 *   Authorized redirect URIs: http://localhost:3000/auth/google/callback
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT                 = process.env.PORT                 || 3000;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI         = `http://localhost:${PORT}/auth/google/callback`;
const WEB_ROOT             = __dirname;
const LOG_FILE             = path.join(__dirname, 'registrations.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.md':   'text/plain; charset=utf-8',
};

// ── HTTPS helper (no npm deps) ─────────────────────────────────────────────────
function httpsReq(urlStr, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: method || 'GET', headers: headers || {} },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Popup callback page — sends result to opener then closes ───────────────────
function popupClose(data) {
  const json = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>');
  return `<!DOCTYPE html><html><body><script>
try { window.opener.postMessage(${json}, window.location.origin); } catch(e) {}
window.close();
<\/script></body></html>`;
}

// ── Mock Google sign-in page (used when GOOGLE_CLIENT_ID not configured) ──────
const MOCK_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Войти — Google</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Google Sans', Roboto, Arial, sans-serif;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
  }
  .card {
    border: 1px solid #dadce0; border-radius: 8px;
    padding: 48px 40px 36px; max-width: 400px; width: 100%;
    text-align: center;
  }
  .logo { margin-bottom: 20px; }
  h1 { font-size: 24px; font-weight: 400; color: #202124; margin-bottom: 8px; }
  .sub { font-size: 16px; color: #202124; margin-bottom: 28px; }
  .mode-badge {
    display: inline-block; font-size: 11px; background: #fef08a; color: #713f12;
    border: 1px solid #fde047; border-radius: 4px; padding: 2px 8px; margin-bottom: 24px;
  }
  input {
    width: 100%; border: 1px solid #dadce0; border-radius: 4px;
    padding: 13px 15px; font-size: 16px; margin-bottom: 12px; outline: none;
    color: #202124;
  }
  input:focus { border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.15); }
  .hint { font-size: 12px; color: #5f6368; text-align: left; margin-bottom: 24px; }
  .btn {
    background: #1a73e8; color: #fff; border: none; border-radius: 4px;
    padding: 10px 24px; font-size: 14px; font-weight: 500; cursor: pointer;
    float: right; letter-spacing: 0.25px;
  }
  .btn:hover { background: #1765cc; }
  .btn:active { background: #1558b0; }
  .clearfix::after { content: ''; display: table; clear: both; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg width="75" height="24" viewBox="0 0 75 24">
      <path d="M29.36 11.3c0-.7-.06-1.37-.17-2.02H18.5v3.82h6.1a5.22 5.22 0 01-2.26 3.42v2.84h3.66c2.14-1.97 3.37-4.88 3.37-8.06z" fill="#4285F4"/>
      <path d="M18.5 22c3.06 0 5.63-1.01 7.5-2.74l-3.66-2.84c-1.01.68-2.31 1.08-3.84 1.08-2.95 0-5.45-1.99-6.34-4.67H8.38v2.93A11.3 11.3 0 0018.5 22z" fill="#34A853"/>
      <path d="M12.16 12.83a6.76 6.76 0 010-4.3V5.6H8.38a11.3 11.3 0 000 11.16l3.78-2.93z" fill="#FBBC05"/>
      <path d="M18.5 5.86c1.66 0 3.15.57 4.32 1.69l3.24-3.24A11.3 11.3 0 0018.5 1 11.3 11.3 0 008.38 5.6l3.78 2.93c.9-2.68 3.39-4.67 6.34-4.67z" fill="#EA4335"/>
      <text x="36" y="18" font-family="Product Sans,Arial" font-size="22" fill="#5f6368">oogle</text>
    </svg>
  </div>
  <h1>Войти</h1>
  <p class="sub">в аккаунт Google</p>
  <div class="mode-badge">⚙ Тестовый режим — node server.js</div>
  <input type="email" id="email" placeholder="Адрес электронной почты" autofocus>
  <input type="text"  id="name"  placeholder="Имя (необязательно)">
  <p class="hint">Для реального Google OAuth передайте<br><code>GOOGLE_CLIENT_ID</code> и <code>GOOGLE_CLIENT_SECRET</code>.</p>
  <div class="clearfix">
    <button class="btn" onclick="submit()">Далее</button>
  </div>
</div>
<script>
  document.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  function submit() {
    const email = document.getElementById('email').value.trim();
    if (!email) { document.getElementById('email').focus(); return; }
    const name = document.getElementById('name').value.trim() || email.split('@')[0];
    const id   = 'mock-' + email.replace(/[^a-z0-9]/gi, '-');
    window.opener.postMessage({ google: { sub: id, name, email, picture: '' } }, window.location.origin);
    window.close();
  }
<\/script>
</body>
</html>`;

// ── Request handler ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url);
  const pathname = parsed.pathname;

  // POST /api/log-registration
  if (req.method === 'POST' && pathname === '/api/log-registration') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { provider = '', id = '', name = '', email = '', ts } = JSON.parse(body);
        const date = new Date(ts || Date.now()).toISOString();
        const line = `${date} | provider=${provider} | id=${id} | name=${name} | email=${email}\n`;
        fs.appendFile(LOG_FILE, line, err => {
          if (err) {
            console.error('[log]', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          } else {
            console.log('[log]', line.trimEnd());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /auth/google/start — real OAuth redirect OR mock form
  if (req.method === 'GET' && pathname === '/auth/google/start') {
    if (GOOGLE_CLIENT_ID) {
      const params = new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        response_type: 'code',
        scope:         'openid profile email',
        access_type:   'online',
        prompt:        'select_account'
      });
      res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params });
      res.end();
    } else {
      // No credentials → serve local mock sign-in page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(MOCK_PAGE);
    }
    return;
  }

  // GET /auth/google/callback — exchange code for tokens (real OAuth only)
  if (req.method === 'GET' && pathname === '/auth/google/callback') {
    const qs    = new URLSearchParams(parsed.query);
    const code  = qs.get('code');
    const error = qs.get('error');

    if (error || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(popupClose({ error: error || 'no_code' }));
      return;
    }

    const tokenBody = new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code'
    }).toString();

    httpsReq(
      'https://oauth2.googleapis.com/token',
      'POST',
      { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
      tokenBody
    ).then(tokens => {
      if (tokens.error) throw new Error(tokens.error_description || tokens.error);
      return httpsReq(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        'GET',
        { Authorization: 'Bearer ' + tokens.access_token }
      );
    }).then(user => {
      console.log('[google] signed in:', user.email);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(popupClose({ google: { sub: user.sub, name: user.name || '', email: user.email || '', picture: user.picture || '' } }));
    }).catch(e => {
      console.error('[google]', e.message);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(popupClose({ error: e.message }));
    });
    return;
  }

  // Static files
  let filePath = path.join(WEB_ROOT, pathname === '/' ? 'list-manager.html' : pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(WEB_ROOT + path.sep) && filePath !== WEB_ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + pathname);
    } else {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\nSearchMyData  →  http://localhost:${PORT}`);
  console.log(`Log file      →  ${LOG_FILE}`);
  console.log(`Google        →  ${GOOGLE_CLIENT_ID ? 'real OAuth ✓' : 'mock mode (no GOOGLE_CLIENT_ID)'}`);
  console.log();
});
