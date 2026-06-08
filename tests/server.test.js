'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, beforeEach, test } = require('node:test');
const { startFakeTerminusDb } = require('./fake-terminusdb');

let fakeDb;
let app;
let appUrl;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function jsonFrom(path) {
  const res = await fetch(`${appUrl}${path}`);
  assert.equal(res.status, 200);
  return res.json();
}

async function requestJson(path, options) {
  const res = await fetch(`${appUrl}${path}`, options);
  const body = await res.json();
  return { res, body };
}

async function postAction(type, data = {}) {
  const res = await fetch(`${appUrl}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  return body;
}

function createClient() {
  let cookie = '';

  return {
    async postAction(type, data = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = cookie;

      const res = await fetch(`${appUrl}/api/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, data }),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];

      const body = await res.json();
      assert.equal(res.status, 200);
      return body;
    },
  };
}

function findItem(items, id) {
  for (const item of items) {
    if (item.id === id) return item;

    const found = findItem(item.children, id);
    if (found) return found;
  }

  return undefined;
}

function flattenItems(items, parentId = null) {
  return items.flatMap((item, position) => [
    { id: item.id, parentId, position },
    ...flattenItems(item.children, item.id),
  ]);
}

async function assertActionDoesNotMutate(type, data, expectedErrorPattern) {
  const before = fakeDb.getDocs();
  const result = await postAction(type, data);
  const after = fakeDb.getDocs();

  assert.equal(result.ok, false);
  assert.match(result.error, expectedErrorPattern);
  assert.deepEqual(after, before);
}

async function assertReorderDoesNotMutate(flat, expectedErrorPattern) {
  await assertActionDoesNotMutate('reorder', { flat }, expectedErrorPattern);
}

async function postFakeDoc(doc) {
  const res = await fetch(`${fakeDb.url}/api/document/admin/searchmydata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([doc]),
  });

  assert.equal(res.status, 200);
}

async function deleteFakeDoc(id) {
  const res = await fetch(`${fakeDb.url}/api/document/admin/searchmydata?id=${encodeURIComponent(`ListItem/${id}`)}`, {
    method: 'DELETE',
  });

  assert.equal(res.status, 200);
}

beforeEach(async () => {
  fakeDb = await startFakeTerminusDb();

  process.env.TERMINUS_URL = fakeDb.url;
  process.env.TERMINUS_TEAM = 'admin';
  process.env.TERMINUS_DB = 'searchmydata';
  process.env.TERMINUS_USER = 'admin';
  process.env.TERMINUS_PASS = 'root';

  const { createServer } = require('../server');
  app = createServer();
  appUrl = await listen(app);
});

afterEach(async () => {
  await close(app);
  app = undefined;
  appUrl = undefined;

  if (fakeDb) {
    await fakeDb.stop();
    fakeDb = undefined;
  }

  delete process.env.TERMINUS_URL;
  delete process.env.TERMINUS_TEAM;
  delete process.env.TERMINUS_DB;
  delete process.env.TERMINUS_USER;
  delete process.env.TERMINUS_PASS;
});

test('GET /document returns nested tree from TerminusDB', async () => {
  const body = await jsonFrom('/document');

  assert.equal(body.id, 'list-data.js');
  assert.equal(body.nextId, 32);
  assert.equal(body.items[1].id, 2);
  assert.deepEqual(body.items[1].children.map((item) => item.id), [26, 27]);
});

test('GET /list-data.js emits executable data from TerminusDB', async () => {
  const res = await fetch(`${appUrl}/list-data.js`);
  const js = await res.text();

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/javascript/);
  assert.match(js, /let nextId = 32;/);
  assert.match(js, /let items = /);

  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(
    `${js}
    items = [];
    nextId += 1;
    this.__result = { nextId, items };
    `,
    context
  );
  assert.equal(context.__result.nextId, 33);
  assert.equal(context.__result.items.length, 0);
});

test('GET /api/document-check matches GET /document shape', async () => {
  const doc = await jsonFrom('/document');
  const check = await jsonFrom('/api/document-check');

  assert.deepEqual(check, doc);
});

test('GET /api/chat/context returns nested reserved context JSON', async () => {
  const { res, body } = await requestJson('/api/chat/context');

  assert.equal(res.status, 200);
  assert.equal(body.id, 'context_all_reserved');
  assert.equal(body.children[0].id, 'context_child_a');
  assert.equal(body.children[1].children[0].id, 'context_grandchild_b1');
});

test('GET /api/chat/history returns reserved answers history entries', async () => {
  const { res, body } = await requestJson('/api/chat/history');

  assert.equal(res.status, 200);
  assert.deepEqual(body, { entries: [] });
});

test('POST /api/chat/send stores request and dummy response in reserved history', async () => {
  const send = await requestJson('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello secrets' }),
  });
  const history = await requestJson('/api/chat/history');
  const reserved = fakeDb.getReservedDocs();

  assert.equal(send.res.status, 200);
  assert.equal(send.body.ok, true);
  assert.equal(send.body.saved.user_request, 'Hello secrets');
  assert.match(send.body.response, /dummy/i);
  assert.equal(history.body.entries.length, 1);
  assert.equal(history.body.entries[0].user_request, 'Hello secrets');
  assert.equal(history.body.entries[0].model_response, send.body.response);
  assert.equal(reserved.answers_reserved.body.entries.length, 1);
});

test('POST /api/chat/send rejects empty message without mutating reserved history', async () => {
  const before = fakeDb.getReservedDocs();
  const send = await requestJson('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '   ' }),
  });
  const after = fakeDb.getReservedDocs();

  assert.equal(send.res.status, 200);
  assert.deepEqual(send.body, { ok: false, error: 'message must be a non-empty string' });
  assert.deepEqual(after, before);
});

test('GET /document returns document not found for unknown document id', async () => {
  const res = await fetch(`${appUrl}/document?id=missing.js`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { ok: false, error: 'document not found' });
});

test('static file serving blocks server implementation files', async () => {
  const res = await fetch(`${appUrl}/server.js`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { ok: false, error: 'not found' });
});

test('static file serving blocks env example files', async () => {
  const res = await fetch(`${appUrl}/.env.example`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { ok: false, error: 'not found' });
});

test('static file serving blocks voice API contract files', async () => {
  const res = await fetch(`${appUrl}/voice-api-contract.md`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { ok: false, error: 'not found' });
});

test('static file serving blocks test shell scripts', async () => {
  const res = await fetch(`${appUrl}/test-voice-api.sh`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.deepEqual(body, { ok: false, error: 'not found' });
});

test('terminusReq times out hung TerminusDB requests', async () => {
  await close(app);
  app = undefined;

  const hangingServer = http.createServer(() => {});
  const hangingUrl = await listen(hangingServer);
  const previousUrl = process.env.TERMINUS_URL;
  const previousTimeout = process.env.TERMINUS_TIMEOUT_MS;
  process.env.TERMINUS_URL = hangingUrl;
  process.env.TERMINUS_TIMEOUT_MS = '30';

  try {
    const { terminusReq } = require('../server');
    await assert.rejects(
      terminusReq('GET', '/api/document/admin/searchmydata?type=ListItem&as_list=true'),
      /timed out/
    );
  } finally {
    process.env.TERMINUS_URL = previousUrl;
    if (previousTimeout === undefined) {
      delete process.env.TERMINUS_TIMEOUT_MS;
    } else {
      process.env.TERMINUS_TIMEOUT_MS = previousTimeout;
    }
    await close(hangingServer);
  }
});

test('POST /api/action add_item persists a root item and reload shows it', async () => {
  const result = await postAction('add_item', {
    id: 32,
    line1: 'Салфетки',
    line2: '2 пачки',
    parentId: null,
  });
  const body = await jsonFrom('/document');
  const item = findItem(body.items, 32);

  assert.deepEqual(result, { ok: true });
  assert.equal(item.line1, 'Салфетки');
  assert.equal(item.line2, '2 пачки');
  assert.deepEqual(body.items.at(-1), item);
});

test('POST /api/action add_item persists a child under parent and reload shows it', async () => {
  const result = await postAction('add_item', {
    id: 32,
    line1: 'Чиабатта',
    parentId: 2,
  });
  const body = await jsonFrom('/document');
  const parent = findItem(body.items, 2);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(parent.children.map((item) => item.id), [26, 27, 32]);
  assert.equal(parent.children[2].line1, 'Чиабатта');
  assert.equal(parent.children[2].line2, undefined);
});

test('POST /api/action edit_item persists line1 and line2 changes', async () => {
  const result = await postAction('edit_item', {
    id: 26,
    line1: 'Бородинский новый',
    line2: '600 г',
  });
  const body = await jsonFrom('/document');
  const item = findItem(body.items, 26);

  assert.deepEqual(result, { ok: true });
  assert.equal(item.line1, 'Бородинский новый');
  assert.equal(item.line2, '600 г');
});

test('POST /api/action delete_item removes an item and descendants', async () => {
  const result = await postAction('delete_item', { id: 2 });
  const body = await jsonFrom('/document');

  assert.deepEqual(result, { ok: true });
  assert.equal(findItem(body.items, 2), undefined);
  assert.equal(findItem(body.items, 26), undefined);
  assert.equal(findItem(body.items, 27), undefined);
});

test('POST /api/action toggle_tag adds and removes a tag', async () => {
  const addResult = await postAction('toggle_tag', { id: 1, tag: 'Срочно' });
  const withTag = await jsonFrom('/document');

  assert.deepEqual(addResult, { ok: true });
  assert.deepEqual(findItem(withTag.items, 1).tags, ['Срочно']);

  const removeResult = await postAction('toggle_tag', { id: 1, tag: 'Срочно' });
  const withoutTag = await jsonFrom('/document');

  assert.deepEqual(removeResult, { ok: true });
  assert.equal(findItem(withoutTag.items, 1).tags, undefined);
});

test('POST /api/action toggle_collapse persists collapsed true', async () => {
  const result = await postAction('toggle_collapse', { id: 2 });
  const body = await jsonFrom('/document');

  assert.deepEqual(result, { ok: true });
  assert.equal(findItem(body.items, 2).collapsed, true);
});

test('POST /api/action reorder persists parentId and position from full flat list', async () => {
  const before = await jsonFrom('/document');
  const flat = flattenItems(before.items).map((entry) => {
    if (entry.id === 26) return { id: 26, parentId: null, position: 0 };
    if (entry.parentId === null && entry.id !== 26) return { ...entry, position: entry.position + 1 };
    if (entry.id === 27) return { id: 27, parentId: 2, position: 0 };
    return entry;
  });

  const result = await postAction('reorder', { flat });
  const after = await jsonFrom('/document');

  assert.deepEqual(result, { ok: true });
  assert.equal(flat.length, flattenItems(before.items).length);
  assert.equal(after.items[0].id, 26);
  assert.equal(findItem(after.items, 2).children.length, 1);
  assert.equal(findItem(after.items, 2).children[0].id, 27);
});

test('POST /api/action Undo after add removes the item', async () => {
  const client = createClient();

  assert.deepEqual(
    await client.postAction('add_item', { id: 32, line1: 'Какао', parentId: null }),
    { ok: true }
  );

  const result = await client.postAction('Undo');
  const body = await jsonFrom('/document');

  assert.deepEqual(result, { ok: true });
  assert.equal(findItem(body.items, 32), undefined);
});

test('POST /api/action Undo with empty undo stack returns known error', async () => {
  const result = await postAction('Undo');

  assert.deepEqual(result, { ok: false, error: 'nothing to undo' });
});

test('POST /api/action unknown action type returns known error', async () => {
  const result = await postAction('explode_item', { id: 1 });

  assert.deepEqual(result, { ok: false, error: 'unknown action type: explode_item' });
});

test('POST /api/action Undo is isolated per HTTP session cookie', async () => {
  const clientA = createClient();
  const clientB = createClient();

  assert.deepEqual(
    await clientA.postAction('add_item', { id: 32, line1: 'Какао', parentId: null }),
    { ok: true }
  );

  assert.deepEqual(await clientB.postAction('Undo'), { ok: false, error: 'nothing to undo' });
  assert.equal(findItem((await jsonFrom('/document')).items, 32).line1, 'Какао');

  assert.deepEqual(await clientA.postAction('Undo'), { ok: true });
  assert.equal(findItem((await jsonFrom('/document')).items, 32), undefined);
});

test('POST /api/action reorder rejects missing item without mutating DB', async () => {
  const flat = flattenItems((await jsonFrom('/document')).items).filter((entry) => entry.id !== 31);

  await assertReorderDoesNotMutate(flat, /missing item 31/);
});

test('POST /api/action reorder rejects unknown id without mutating DB', async () => {
  const flat = [...flattenItems((await jsonFrom('/document')).items), { id: 999, parentId: null, position: 25 }];

  await assertReorderDoesNotMutate(flat, /unknown item 999/);
});

test('POST /api/action reorder rejects duplicate id without mutating DB', async () => {
  const current = flattenItems((await jsonFrom('/document')).items);
  const flat = current.map((entry) => (entry.id === 31 ? { ...entry, id: 30 } : entry));

  await assertReorderDoesNotMutate(flat, /duplicate item 30/);
});

test('POST /api/action reorder rejects self-parent without mutating DB', async () => {
  const flat = flattenItems((await jsonFrom('/document')).items)
    .map((entry) => (entry.id === 26 ? { ...entry, parentId: 26 } : entry));

  await assertReorderDoesNotMutate(flat, /item 26 cannot be its own parent/);
});

test('POST /api/action reorder rejects missing parent without mutating DB', async () => {
  const flat = flattenItems((await jsonFrom('/document')).items)
    .map((entry) => (entry.id === 26 ? { ...entry, parentId: 999 } : entry));

  await assertReorderDoesNotMutate(flat, /parent 999 not found/);
});

test('POST /api/action reorder rejects parent cycles without mutating DB', async () => {
  const flat = flattenItems((await jsonFrom('/document')).items)
    .map((entry) => {
      if (entry.id === 2) return { ...entry, parentId: 26, position: 0 };
      if (entry.id === 26) return { ...entry, parentId: 2, position: 0 };
      if (entry.id === 27) return { ...entry, parentId: 2, position: 1 };
      return entry;
    });

  await assertReorderDoesNotMutate(flat, /parent links create a cycle/);
});

test('POST /api/action reorder rejects non-contiguous sibling positions without mutating DB', async () => {
  const flat = flattenItems((await jsonFrom('/document')).items)
    .map((entry) => (entry.id === 1 ? { ...entry, position: 10 } : entry));

  await assertReorderDoesNotMutate(flat, /positions for parent root must be contiguous/);
});

test('POST /api/action add_item rejects missing parent without mutating DB', async () => {
  await assertActionDoesNotMutate(
    'add_item',
    { id: 32, line1: 'Какао', parentId: 999 },
    /parent 999 not found/
  );
});

test('POST /api/action edit_item rejects missing line1 without mutating DB', async () => {
  await assertActionDoesNotMutate('edit_item', { id: 1, line2: 'новое' }, /line1 must be a non-empty string/);
});

test('POST /api/action toggle_tag rejects missing tag without mutating DB', async () => {
  await assertActionDoesNotMutate('toggle_tag', { id: 1 }, /tag must be a non-empty string/);
});

test('POST /api/action Undo keeps entry available if inverse operation fails', async () => {
  const client = createClient();

  assert.deepEqual(await client.postAction('add_item', { id: 32, line1: 'Какао', parentId: null }), { ok: true });
  await deleteFakeDoc(32);

  const failed = await client.postAction('Undo');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /item 32 not found/);

  await postFakeDoc({
    '@type': 'ListItem',
    '@id': 'ListItem/32',
    itemId: 32,
    line1: 'Какао',
    tags: [],
    parentId: null,
    position: 25,
  });

  assert.deepEqual(await client.postAction('Undo'), { ok: true });
  assert.equal(findItem((await jsonFrom('/document')).items, 32), undefined);
});
