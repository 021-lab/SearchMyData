'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_DOCUMENT_ID = 'list-data.js';
const STATIC_ALLOWLIST = new Set([
  '/',
  '/list-manager.html',
  '/list-manager.css',
  '/list-manager-docs.html',
  '/llm-outside.html',
]);

function loadEnv(envPath = path.join(ROOT, '.env')) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function envConfig() {
  return {
    terminusUrl: process.env.TERMINUS_URL,
    team: process.env.TERMINUS_TEAM,
    db: process.env.TERMINUS_DB,
    user: process.env.TERMINUS_USER || 'admin',
    pass: process.env.TERMINUS_PASS || '',
  };
}

function joinUrl(base, apiPath) {
  return `${base.replace(/\/+$/, '')}/${apiPath.replace(/^\/+/, '')}`;
}

function terminusTimeoutMs() {
  const parsed = Number(process.env.TERMINUS_TIMEOUT_MS || 10000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
}

function terminusReq(method, apiPath, body) {
  const config = envConfig();
  if (!config.terminusUrl) {
    return Promise.reject(new Error('TERMINUS_URL is not configured'));
  }

  return new Promise((resolve, reject) => {
    const url = new URL(joinUrl(config.terminusUrl, apiPath));
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const client = url.protocol === 'https:' ? https : http;
    const timeoutMs = terminusTimeoutMs();
    const headers = {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.user}:${config.pass}`).toString('base64')}`,
    };

    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = data;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
          } else {
            parsed = undefined;
          }

          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`TerminusDB request timed out after ${timeoutMs}ms`));
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function listItemsFromDb() {
  const { team, db } = envConfig();
  if (!team || !db) throw new Error('TERMINUS_TEAM and TERMINUS_DB are required');

  const apiPath = `/api/document/${encodeURIComponent(team)}/${encodeURIComponent(db)}?type=ListItem&as_list=true`;
  const { status, body } = await terminusReq('GET', apiPath);
  if (status !== 200 || !Array.isArray(body)) {
    throw new Error('failed to load ListItem documents');
  }

  return body;
}

function itemIdFromDoc(doc) {
  if (Number.isInteger(doc.itemId)) return doc.itemId;

  const match = String(doc['@id'] || '').match(/(?:^|\/)(\d+)$/);
  if (match) return Number(match[1]);

  return undefined;
}

function flatToTree(docs) {
  const map = new Map();

  for (const doc of docs) {
    const id = itemIdFromDoc(doc);
    if (!Number.isInteger(id)) continue;

    map.set(id, {
      id,
      line1: String(doc.line1 || ''),
      ...(doc.line2 ? { line2: doc.line2 } : {}),
      ...(Array.isArray(doc.tags) && doc.tags.length ? { tags: doc.tags } : {}),
      ...(doc.collapsed ? { collapsed: true } : {}),
      children: [],
      _parentId: doc.parentId ?? null,
      _position: Number.isFinite(doc.position) ? doc.position : 0,
    });
  }

  const roots = [];
  for (const item of map.values()) {
    if (item._parentId === null) {
      roots.push(item);
    } else {
      const parent = map.get(item._parentId);
      if (parent) parent.children.push(item);
    }
  }

  function sortAndClean(items) {
    items.sort((a, b) => a._position - b._position || a.id - b.id);
    for (const item of items) {
      sortAndClean(item.children);
      delete item._parentId;
      delete item._position;
    }
  }

  sortAndClean(roots);
  return roots;
}

function computeNextId(docs) {
  const ids = docs.map(itemIdFromDoc).filter(Number.isInteger);
  if (ids.length === 0) return 1;
  return Math.max(...ids) + 1;
}

function buildListDataJs(items, nextId) {
  return `/* auto-generated - do not edit */\nconst nextId = ${nextId};\nconst items = ${JSON.stringify(items, null, 2)};\n`;
}

function documentIdFromReq(req) {
  const url = new URL(req.url, 'http://127.0.0.1');
  return url.searchParams.get('id') || DEFAULT_DOCUMENT_ID;
}

async function documentPayload(documentId = DEFAULT_DOCUMENT_ID) {
  if (documentId !== DEFAULT_DOCUMENT_ID) {
    return { ok: false, error: 'document not found' };
  }

  const docs = await listItemsFromDb();
  return {
    id: DEFAULT_DOCUMENT_ID,
    nextId: computeNextId(docs),
    items: flatToTree(docs),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function serveDocument(req, res) {
  try {
    const payload = await documentPayload(documentIdFromReq(req));
    const status = payload.ok === false && payload.error === 'document not found' ? 404 : 200;
    sendJson(res, status, payload);
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message });
  }
}

async function serveDocumentCheck(req, res) {
  await serveDocument(req, res);
}

async function serveListData(req, res) {
  try {
    const payload = await documentPayload();
    sendText(res, 200, 'application/javascript; charset=utf-8', buildListDataJs(payload.items, payload.nextId));
  } catch {
    const fallback = fs.readFileSync(path.join(ROOT, 'list-data.js'));
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': fallback.length,
    });
    res.end(fallback);
  }
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function staticPathFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  if (!STATIC_ALLOWLIST.has(decoded)) return undefined;
  const pathname = decoded === '/' ? '/list-manager.html' : decoded;
  return path.join(ROOT, pathname);
}

function serveStatic(req, res, url) {
  const filePath = staticPathFor(url.pathname);
  if (!filePath) {
    sendJson(res, 404, { ok: false, error: 'not found' });
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        sendJson(res, 500, { ok: false, error: 'failed to read file' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': data.length,
      });
      res.end(data);
    });
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/document') {
    await serveDocument(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/document-check') {
    await serveDocumentCheck(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/list-data.js') {
    await serveListData(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    sendJson(res, 200, { ok: false, error: 'not implemented' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

function createServer() {
  loadEnv();
  return http.createServer((req, res) => {
    route(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, error: err.message });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  buildListDataJs,
  computeNextId,
  createServer,
  documentPayload,
  flatToTree,
  listItemsFromDb,
  loadEnv,
  route,
  serveDocument,
  serveDocumentCheck,
  serveListData,
  serveStatic,
  terminusReq,
};
