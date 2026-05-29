/**
 * SearchMyData local dev server
 *
 * Serves the app on http://localhost:3000 and appends registration events
 * to registrations.log.
 *
 * Run:  node server.js
 *
 * Configure OAuth credentials:
 *   Google → replace YOUR_GOOGLE_CLIENT_ID in list-manager.html
 *            and add http://localhost:3000 as an authorized JavaScript origin
 *            in Google Cloud Console → APIs & Services → Credentials.
 *   Apple  → replace YOUR_APPLE_SERVICE_ID in list-manager.html
 *            (requires HTTPS; test with a tunnel such as ngrok for localhost).
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT     = 3000;
const WEB_ROOT = __dirname;
const LOG_FILE = path.join(__dirname, 'registrations.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.sh':   'text/plain',
  '.md':   'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);

  // POST /api/log-registration — append one line to registrations.log
  if (req.method === 'POST' && pathname === '/api/log-registration') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { provider = '', id = '', name = '', email = '', ts } = JSON.parse(body);
        const date = new Date(ts || Date.now()).toISOString();
        const line = `${date} | provider=${provider} | id=${id} | name=${name} | email=${email}\n`;
        fs.appendFile(LOG_FILE, line, err => {
          if (err) {
            console.error('[log] write error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          } else {
            console.log('[log]', line.trimEnd());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = path.join(WEB_ROOT, pathname === '/' ? 'list-manager.html' : pathname);
  filePath = path.normalize(filePath);

  // Prevent path traversal outside WEB_ROOT
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
  console.log(`Log file      →  ${LOG_FILE}\n`);
});
