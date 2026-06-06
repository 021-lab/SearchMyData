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
  assert.match(js, /const nextId = 32;/);
  assert.match(js, /const items = /);

  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(`${js}\nthis.__result = { nextId, items };`, context);
  assert.equal(context.__result.nextId, 32);
  assert.equal(context.__result.items[1].children[0].id, 26);
});

test('GET /api/document-check matches GET /document shape', async () => {
  const doc = await jsonFrom('/document');
  const check = await jsonFrom('/api/document-check');

  assert.deepEqual(check, doc);
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
