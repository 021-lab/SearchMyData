'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_DOCUMENT_ID = 'list-data.js';
const SESSION_COOKIE = 'smd_session';
const CHAT_WITH_SECRETS_PATH = '/chat-with-secrets';
const RESERVED_CONTEXT_ID = 'context_all_reserved';
const RESERVED_SETTINGS_ID = 'settings_reserved';
const RESERVED_ANSWERS_ID = 'answers_reserved';
const STATIC_ALLOWLIST = new Set([
  '/',
  CHAT_WITH_SECRETS_PATH,
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

function dbPath() {
  const { team, db } = envConfig();
  if (!team || !db) throw new Error('TERMINUS_TEAM and TERMINUS_DB are required');
  return `${encodeURIComponent(team)}/${encodeURIComponent(db)}`;
}

function withCommitMeta(apiPath, message) {
  const { user } = envConfig();
  const separator = apiPath.includes('?') ? '&' : '?';
  const author = encodeURIComponent(user || 'admin');
  const commitMessage = encodeURIComponent(message || 'update');
  return `${apiPath}${separator}author=${author}&message=${commitMessage}`;
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
  const apiPath = `/api/document/${dbPath()}?type=ListItem&as_list=true`;
  const { status, body } = await terminusReq('GET', apiPath);
  if (status !== 200 || !Array.isArray(body)) {
    throw new Error('failed to load ListItem documents');
  }

  return body;
}

async function getItem(id) {
  requireInteger(id, 'id');
  const docs = await listItemsFromDb();
  const existing = docByItemId(docs).get(id);
  if (!existing) throw new Error(`item ${id} not found`);
  return existing;
}

async function writeDocs(docs) {
  const { status } = await terminusReq(
    'POST',
    withCommitMeta(`/api/document/${dbPath()}`, 'write ListItem docs'),
    docs
  );
  if (status !== 200 && status !== 201) throw new Error('db write failed');
}

async function patchItem(id, patch) {
  const { status } = await terminusReq('POST', withCommitMeta(`/api/patch/${dbPath()}`, `patch ListItem/${id}`), {
    document_id: `ListItem/${id}`,
    patch,
  });
  if (status !== 200) throw new Error('db patch failed');
}

async function deleteItemDoc(id) {
  const documentId = encodeURIComponent(`ListItem/${id}`);
  const { status } = await terminusReq(
    'DELETE',
    withCommitMeta(`/api/document/${dbPath()}?id=${documentId}`, `delete ListItem/${id}`)
  );
  if (status !== 200 && status !== 204) throw new Error('db delete failed');
}

async function replaceAllDocs(nextDocs, currentDocs) {
  const existingDocs = currentDocs || await listItemsFromDb();
  for (const doc of existingDocs) {
    await deleteItemDoc(itemIdFromDoc(doc));
  }
  if (nextDocs.length > 0) await writeDocs(nextDocs);
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

function defaultReservedDocBody(docId) {
  switch (docId) {
    case RESERVED_CONTEXT_ID:
      return {
        id: RESERVED_CONTEXT_ID,
        title: 'Context Root',
        children: [],
      };
    case RESERVED_SETTINGS_ID:
      return {
        model: 'gpt-4.1-mini',
        api_token: '',
      };
    case RESERVED_ANSWERS_ID:
      return {
        entries: [],
      };
    default:
      throw new Error(`unknown reserved document: ${docId}`);
  }
}

function normalizeReservedDoc(docId, body) {
  if (docId === RESERVED_CONTEXT_ID) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`${docId} must be an object`);
    }

    return {
      id: RESERVED_CONTEXT_ID,
      title: typeof body.title === 'string' ? body.title : 'Context Root',
      children: Array.isArray(body.children) ? body.children : [],
    };
  }

  if (docId === RESERVED_SETTINGS_ID) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`${docId} must be an object`);
    }

    return {
      model: typeof body.model === 'string' ? body.model : 'gpt-4.1-mini',
      api_token: typeof body.api_token === 'string' ? body.api_token : '',
    };
  }

  if (docId === RESERVED_ANSWERS_ID) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`${docId} must be an object`);
    }

    return {
      entries: Array.isArray(body.entries) ? body.entries : [],
    };
  }

  throw new Error(`unknown reserved document: ${docId}`);
}

async function getReservedDoc(docId) {
  const apiPath = `/api/document/${dbPath()}/${encodeURIComponent('ChatDoc')}/${encodeURIComponent(docId)}`;
  const { status, body } = await terminusReq('GET', apiPath);

  if (status === 404) {
    const fallbackBody = defaultReservedDocBody(docId);
    await writeReservedDoc(docId, fallbackBody);
    return {
      '@type': 'ChatDoc',
      '@id': `ChatDoc/${docId}`,
      docId,
      body: fallbackBody,
    };
  }

  if (status !== 200 || !body) {
    throw new Error(`${docId} not found`);
  }

  return {
    '@type': 'ChatDoc',
    '@id': body['@id'] || `ChatDoc/${docId}`,
    docId,
    body: normalizeReservedDoc(docId, body.body),
  };
}

async function writeReservedDoc(docId, body) {
  const payload = [{
    '@type': 'ChatDoc',
    '@id': `ChatDoc/${docId}`,
    docId,
    body: normalizeReservedDoc(docId, body),
  }];

  const { status } = await terminusReq(
    'POST',
    withCommitMeta(`/api/document/${dbPath()}`, `write ${docId}`),
    payload
  );
  if (status !== 200 && status !== 201) {
    throw new Error(`failed to write ${docId}`);
  }

  return payload[0];
}

function chatDummyModeEnabled() {
  return process.env.CHAT_WITH_SECRETS_DUMMY !== '0';
}

function buildDummyResponse(message, contextBody, settingsBody) {
  const contextChildren = Array.isArray(contextBody.children) ? contextBody.children.length : 0;
  return `Dummy response for "${message}" using model "${settingsBody.model}" with ${contextChildren} top-level context nodes.`;
}

async function callOpenAiCompatibleModel(message, contextBody, settingsBody) {
  if (chatDummyModeEnabled()) {
    return buildDummyResponse(message, contextBody, settingsBody);
  }

  if (!settingsBody.api_token) {
    throw new Error('settings_reserved.api_token is required');
  }

  const payload = {
    model: settingsBody.model || 'gpt-4.1-mini',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          context_all_reserved: contextBody,
          user_request: message,
        }),
      },
    ],
  };

  const endpoint = process.env.CHAT_WITH_SECRETS_OPENAI_URL || 'https://api.openai.com/v1/chat/completions';
  const url = new URL(endpoint);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(payload);
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settingsBody.api_token}`,
          'Content-Length': Buffer.byteLength(raw),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            reject(new Error('model response was not valid JSON'));
            return;
          }

          const text = body?.choices?.[0]?.message?.content;
          if (res.statusCode !== 200 || !isNonEmptyString(text)) {
            reject(new Error(`model call failed with status ${res.statusCode}`));
            return;
          }

          resolve(text);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(terminusTimeoutMs(), () => {
      req.destroy(new Error(`Model request timed out after ${terminusTimeoutMs()}ms`));
    });
    req.write(raw);
    req.end();
  });
}

function computeNextId(docs) {
  const ids = docs.map(itemIdFromDoc).filter(Number.isInteger);
  if (ids.length === 0) return 1;
  return Math.max(...ids) + 1;
}

function buildListDataJs(items, nextId) {
  return `/* auto-generated - do not edit */\nlet nextId = ${nextId};\nlet items = ${JSON.stringify(items, null, 2)};\n`;
}

const undoSessions = new Map();

function resetUndoLog() {
  undoSessions.clear();
}

function parseCookies(header) {
  const cookies = new Map();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, value);
  }

  return cookies;
}

function resolveSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.get(SESSION_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{16,}$/.test(existing)) return existing;

  const sessionId = crypto.randomBytes(18).toString('base64url');
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return sessionId;
}

function undoStackFor(sessionId = 'default') {
  if (!undoSessions.has(sessionId)) undoSessions.set(sessionId, []);
  return undoSessions.get(sessionId);
}

function shouldRecordUndo(options) {
  return options?.recordUndo !== false;
}

function pushUndo(entry, sessionId) {
  const undoLog = undoStackFor(sessionId);
  undoLog.push(entry);
  if (undoLog.length > 50) undoLog.shift();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireInteger(value, name) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

function requireNonEmptyString(value, name) {
  if (!isNonEmptyString(value)) throw new Error(`${name} must be a non-empty string`);
}

function docByItemId(docs) {
  return new Map(docs.map((doc) => [itemIdFromDoc(doc), doc]));
}

function requireExistingItem(id, docs) {
  requireInteger(id, 'id');
  const item = docByItemId(docs).get(id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

function validateParent(parentId, docs) {
  if (parentId === null) return;
  if (!Number.isInteger(parentId)) throw new Error('parentId must be null or an integer');
  if (!docByItemId(docs).has(parentId)) throw new Error(`parent ${parentId} not found`);
}

function collectSubtree(rootId, docs) {
  const ids = new Set([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const doc of docs) {
      const itemId = itemIdFromDoc(doc);
      if (Number.isInteger(itemId) && !ids.has(itemId) && ids.has(doc.parentId)) {
        ids.add(itemId);
        changed = true;
      }
    }
  }

  return ids;
}

async function nextPositionFor(parentId) {
  const docs = await listItemsFromDb();
  return docs.filter((doc) => (doc.parentId ?? null) === (parentId ?? null)).length;
}

async function actionAdd(data, options) {
  const id = data?.id;
  const docs = await listItemsFromDb();
  const parentId = data?.parentId ?? null;

  requireInteger(id, 'id');
  requireNonEmptyString(data?.line1, 'line1');
  if (!Object.prototype.hasOwnProperty.call(data || {}, 'parentId')) throw new Error('parentId is required');
  validateParent(parentId, docs);
  if (docByItemId(docs).has(id)) throw new Error(`item ${id} already exists`);

  const doc = {
    '@type': 'ListItem',
    '@id': `ListItem/${id}`,
    itemId: id,
    line1: data?.line1,
    ...(data?.line2 ? { line2: data.line2 } : {}),
    tags: [],
    parentId,
    position: docs.filter((candidate) => (candidate.parentId ?? null) === parentId).length,
  };

  await writeDocs([doc]);
  if (shouldRecordUndo(options)) pushUndo({ type: 'delete_item', data: { id } }, options?.sessionId);
}

async function actionEdit(data, options) {
  const id = data?.id;
  requireInteger(id, 'id');
  requireNonEmptyString(data?.line1, 'line1');

  const docs = await listItemsFromDb();
  const existing = requireExistingItem(id, docs);
  const nextDocs = docs.map((doc) => {
    if (itemIdFromDoc(doc) !== id) return doc;
    const updated = { ...doc, line1: data.line1 };
    if (data?.line2 === undefined) delete updated.line2;
    else updated.line2 = data.line2;
    return updated;
  });

  await replaceAllDocs(nextDocs, docs);
  if (shouldRecordUndo(options)) {
    pushUndo({
      type: 'edit_item',
      data: { id, line1: existing.line1, line2: existing.line2 },
    }, options?.sessionId);
  }
}

async function actionDelete(data, options) {
  requireInteger(data?.id, 'id');

  const docs = await listItemsFromDb();
  const ids = collectSubtree(data?.id, docs);
  const snapshot = docs.filter((doc) => ids.has(itemIdFromDoc(doc)));
  if (snapshot.length === 0) throw new Error(`item ${data?.id} not found`);

  const nextDocs = docs.filter((doc) => !ids.has(itemIdFromDoc(doc)));
  await replaceAllDocs(nextDocs, docs);

  if (shouldRecordUndo(options)) pushUndo({ type: 'restore_items', data: { docs: snapshot } }, options?.sessionId);
}

async function actionToggleTag(data, options) {
  const id = data?.id;
  const tag = data?.tag;
  requireInteger(id, 'id');
  requireNonEmptyString(tag, 'tag');

  const docs = await listItemsFromDb();
  const existing = requireExistingItem(id, docs);
  const before = Array.isArray(existing.tags) ? existing.tags : [];
  const after = before.includes(tag) ? before.filter((candidate) => candidate !== tag) : [...before, tag];

  const nextDocs = docs.map((doc) => {
    if (itemIdFromDoc(doc) !== id) return doc;
    return { ...doc, tags: after };
  });

  await replaceAllDocs(nextDocs, docs);
  if (shouldRecordUndo(options)) pushUndo({ type: 'toggle_tag', data: { id, tag } }, options?.sessionId);
}

async function actionToggleCollapse(data, options) {
  const id = data?.id;
  requireInteger(id, 'id');

  const docs = await listItemsFromDb();
  const existing = requireExistingItem(id, docs);
  const nextDocs = docs.map((doc) => {
    if (itemIdFromDoc(doc) !== id) return doc;
    const updated = { ...doc };
    if (doc.collapsed) delete updated.collapsed;
    else updated.collapsed = true;
    return updated;
  });

  await replaceAllDocs(nextDocs, docs);
  if (shouldRecordUndo(options)) pushUndo({ type: 'toggle_collapse', data: { id } }, options?.sessionId);
}

function validateReorderFlat(flat, docs) {
  if (!Array.isArray(flat)) throw new Error('flat must be an array');

  const currentIds = new Set(docs.map(itemIdFromDoc));
  const seen = new Set();
  const parentById = new Map();
  const siblings = new Map();

  for (const entry of flat) {
    requireInteger(entry?.id, 'id');
    if (seen.has(entry.id)) throw new Error(`duplicate item ${entry.id}`);
    if (!currentIds.has(entry.id)) throw new Error(`unknown item ${entry.id}`);
    seen.add(entry.id);
  }

  for (const id of currentIds) {
    if (!seen.has(id)) throw new Error(`missing item ${id}`);
  }

  for (const entry of flat) {
    const parentId = entry.parentId ?? null;
    if (parentId !== null && !Number.isInteger(parentId)) throw new Error('parentId must be null or an integer');
    if (parentId === entry.id) throw new Error(`item ${entry.id} cannot be its own parent`);
    if (parentId !== null && !currentIds.has(parentId)) throw new Error(`parent ${parentId} not found`);
    requireInteger(entry.position, 'position');

    parentById.set(entry.id, parentId);
    const key = parentId === null ? 'root' : String(parentId);
    if (!siblings.has(key)) siblings.set(key, []);
    siblings.get(key).push(entry.position);
  }

  for (const id of currentIds) {
    const visited = new Set();
    let parentId = parentById.get(id);
    while (parentId !== null) {
      if (parentId === id || visited.has(parentId)) throw new Error(`parent links create a cycle at item ${id}`);
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }

  for (const [parentKey, positions] of siblings) {
    positions.sort((a, b) => a - b);
    for (let index = 0; index < positions.length; index += 1) {
      if (positions[index] !== index) {
        throw new Error(`positions for parent ${parentKey} must be contiguous`);
      }
    }
  }
}

async function actionReorder(data, options) {
  const flat = data?.flat;
  const docs = await listItemsFromDb();
  validateReorderFlat(flat, docs);

  const byId = new Map(docs.map((doc) => [itemIdFromDoc(doc), doc]));
  const previousFlat = docs.map((doc) => ({
    id: itemIdFromDoc(doc),
    parentId: doc.parentId ?? null,
    position: doc.position,
  }));

  for (const entry of flat) {
    const existing = byId.get(entry.id);
    if (!existing) continue;
    existing.parentId = entry.parentId ?? null;
    existing.position = entry.position;
  }

  await replaceAllDocs([...byId.values()], docs);

  if (shouldRecordUndo(options)) pushUndo({ type: 'reorder', data: { flat: previousFlat } }, options?.sessionId);
}

async function restoreItems(docs, options) {
  await writeDocs(docs);
  if (shouldRecordUndo(options)) {
    for (const doc of docs) {
      pushUndo({ type: 'delete_item', data: { id: itemIdFromDoc(doc) } }, options?.sessionId);
    }
  }
}

async function applyUndoEntry(entry) {
  const options = { recordUndo: false };
  switch (entry.type) {
    case 'delete_item':
      await actionDelete(entry.data, options);
      return;
    case 'edit_item':
      await actionEdit(entry.data, options);
      return;
    case 'restore_items':
      await restoreItems(entry.data.docs, options);
      return;
    case 'toggle_tag':
      await actionToggleTag(entry.data, options);
      return;
    case 'toggle_collapse':
      await actionToggleCollapse(entry.data, options);
      return;
    case 'reorder':
      await actionReorder(entry.data, options);
      return;
    default:
      throw new Error(`unknown undo type: ${entry.type}`);
  }
}

async function actionUndo(sessionId) {
  const undoLog = undoStackFor(sessionId);
  if (undoLog.length === 0) return { ok: false, error: 'nothing to undo' };

  const entry = undoLog[undoLog.length - 1];
  await applyUndoEntry(entry);
  undoLog.pop();
  return { ok: true };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleAction(req, res) {
  try {
    const sessionId = resolveSessionId(req, res);
    const body = await readJsonBody(req);
    const type = body?.type;
    const data = body?.data || {};
    const options = { sessionId };
    let result = { ok: true };

    switch (type) {
      case 'add_item':
        await actionAdd(data, options);
        break;
      case 'edit_item':
        await actionEdit(data, options);
        break;
      case 'delete_item':
        await actionDelete(data, options);
        break;
      case 'toggle_tag':
        await actionToggleTag(data, options);
        break;
      case 'toggle_collapse':
        await actionToggleCollapse(data, options);
        break;
      case 'reorder':
        await actionReorder(data, options);
        break;
      case 'Undo':
        result = await actionUndo(sessionId);
        break;
      default:
        result = { ok: false, error: `unknown action type: ${type}` };
        break;
    }

    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err.message });
  }
}

async function serveChatContext(res) {
  const doc = await getReservedDoc(RESERVED_CONTEXT_ID);
  sendJson(res, 200, doc.body, { 'Cache-Control': 'no-store' });
}

async function serveChatHistory(res) {
  const doc = await getReservedDoc(RESERVED_ANSWERS_ID);
  sendJson(res, 200, doc.body, { 'Cache-Control': 'no-store' });
}

async function handleChatSend(req, res) {
  try {
    const body = await readJsonBody(req);
    requireNonEmptyString(body?.message, 'message');

    const contextDoc = await getReservedDoc(RESERVED_CONTEXT_ID);
    const settingsDoc = await getReservedDoc(RESERVED_SETTINGS_ID);
    const answersDoc = await getReservedDoc(RESERVED_ANSWERS_ID);
    const responseText = await callOpenAiCompatibleModel(body.message, contextDoc.body, settingsDoc.body);
    const saved = {
      created_at: new Date().toISOString(),
      user_request: body.message,
      model_response: responseText,
    };
    const entries = Array.isArray(answersDoc.body.entries) ? answersDoc.body.entries : [];

    await writeReservedDoc(RESERVED_ANSWERS_ID, {
      entries: [...entries, saved],
    });

    sendJson(res, 200, { ok: true, response: responseText, saved }, { 'Cache-Control': 'no-store' });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err.message }, { 'Cache-Control': 'no-store' });
  }
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

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendText(res, status, contentType, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

async function serveDocument(req, res) {
  try {
    const payload = await documentPayload(documentIdFromReq(req));
    const status = payload.ok === false && payload.error === 'document not found' ? 404 : 200;
    sendJson(res, status, payload, { 'Cache-Control': 'no-store' });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message }, { 'Cache-Control': 'no-store' });
  }
}

async function serveDocumentCheck(req, res) {
  await serveDocument(req, res);
}

async function serveListData(req, res) {
  try {
    const payload = await documentPayload();
    sendText(
      res,
      200,
      'application/javascript; charset=utf-8',
      buildListDataJs(payload.items, payload.nextId),
      { 'Cache-Control': 'no-store' }
    );
  } catch {
    const fallback = fs.readFileSync(path.join(ROOT, 'list-data.js'));
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': fallback.length,
      'Cache-Control': 'no-store',
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
  let pathname = decoded;
  if (decoded === '/') pathname = '/list-manager.html';
  if (decoded === CHAT_WITH_SECRETS_PATH) pathname = '/chat-with-secrets.html';
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

  if (req.method === 'GET' && url.pathname === '/api/chat/context') {
    await serveChatContext(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    await serveChatHistory(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/send') {
    await handleChatSend(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    await handleAction(req, res);
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
  resetUndoLog();
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
  actionAdd,
  actionDelete,
  actionEdit,
  actionReorder,
  actionToggleCollapse,
  actionToggleTag,
  actionUndo,
  buildListDataJs,
  collectSubtree,
  computeNextId,
  createServer,
  dbPath,
  documentPayload,
  flatToTree,
  getItem,
  handleAction,
  listItemsFromDb,
  loadEnv,
  nextPositionFor,
  parseCookies,
  pushUndo,
  resolveSessionId,
  route,
  serveDocument,
  serveDocumentCheck,
  serveListData,
  serveStatic,
  terminusReq,
  restoreItems,
  validateReorderFlat,
};
