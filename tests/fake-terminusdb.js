'use strict';

const http = require('node:http');

const SEED_DOCS = [
  { itemId: 1, line1: 'Молоко 3.2%', line2: '2 пакета, магазин у дома', parentId: null, position: 0 },
  { itemId: 2, line1: 'Хлеб ржаной', parentId: null, position: 1 },
  { itemId: 3, line1: 'Яблоки', line2: 'Голден, ~1.5 кг', parentId: null, position: 2 },
  { itemId: 4, line1: 'Кофе', line2: 'Арабика, зерно, 250 г', parentId: null, position: 3 },
  { itemId: 5, line1: 'Зубная паста', parentId: null, position: 4 },
  { itemId: 6, line1: 'Шампунь', line2: 'Для нормальных волос', parentId: null, position: 5 },
  { itemId: 7, line1: 'Стиральный порошок', line2: 'Автомат, 3 кг', parentId: null, position: 6 },
  { itemId: 8, line1: 'Батарейки AA', line2: '4 штуки', parentId: null, position: 7 },
  { itemId: 9, line1: 'Сыр Гауда', line2: '200 г, нарезка', parentId: null, position: 8 },
  { itemId: 10, line1: 'Яйца', line2: '10 штук, C1', parentId: null, position: 9 },
  { itemId: 11, line1: 'Масло сливочное', line2: '82.5%, 200 г', parentId: null, position: 10 },
  { itemId: 12, line1: 'Греческий йогурт', line2: '0%, 500 г', parentId: null, position: 11 },
  { itemId: 13, line1: 'Помидоры', line2: '1 кг, черри', parentId: null, position: 12 },
  { itemId: 14, line1: 'Огурцы', line2: '500 г', parentId: null, position: 13 },
  { itemId: 15, line1: 'Куриное филе', line2: '1 кг, охлаждённое', parentId: null, position: 14 },
  { itemId: 16, line1: 'Макароны', line2: 'Спагетти, 400 г', parentId: null, position: 15 },
  { itemId: 17, line1: 'Томатная паста', line2: '2 банки по 140 г', parentId: null, position: 16 },
  { itemId: 18, line1: 'Оливковое масло', line2: 'Extra Virgin, 500 мл', parentId: null, position: 17 },
  { itemId: 19, line1: 'Чай зелёный', line2: '25 пакетиков', parentId: null, position: 18 },
  { itemId: 20, line1: 'Бананы', line2: '1 кг', parentId: null, position: 19 },
  { itemId: 21, line1: 'Апельсины', line2: '1.5 кг', parentId: null, position: 20 },
  { itemId: 22, line1: 'Туалетная бумага', line2: '12 рулонов', parentId: null, position: 21 },
  { itemId: 23, line1: 'Мыло жидкое', line2: 'Антибактериальное, 500 мл', parentId: null, position: 22 },
  { itemId: 24, line1: 'Сахар', line2: '1 кг, белый', parentId: null, position: 23 },
  { itemId: 25, line1: 'Соль', line2: 'Морская, мелкая, 500 г', parentId: null, position: 24 },
  { itemId: 26, line1: 'Бородинский', line2: '400 г', parentId: 2, position: 0 },
  { itemId: 27, line1: 'Столичный', line2: '500 г', parentId: 2, position: 1 },
  { itemId: 28, line1: 'Голден', line2: '500 г', parentId: 3, position: 0 },
  { itemId: 29, line1: 'Гренни Смит', line2: '400 г', parentId: 3, position: 1 },
  { itemId: 30, line1: 'Фуджи', line2: '300 г', parentId: 3, position: 2 },
  { itemId: 31, line1: 'Симиренко', line2: '300 г', parentId: 3, position: 3 },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toTerminusDoc(doc) {
  return {
    '@type': 'ListItem',
    '@id': `ListItem/${doc.itemId}`,
    itemId: doc.itemId,
    line1: doc.line1,
    ...(doc.line2 ? { line2: doc.line2 } : {}),
    tags: doc.tags || [],
    ...(doc.collapsed ? { collapsed: doc.collapsed } : {}),
    parentId: doc.parentId,
    position: doc.position,
  };
}

function normalizeTerminusDoc(doc) {
  return {
    '@type': 'ListItem',
    '@id': doc['@id'] || `ListItem/${doc.itemId}`,
    itemId: doc.itemId,
    line1: doc.line1,
    ...(doc.line2 ? { line2: doc.line2 } : {}),
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    ...(doc.collapsed ? { collapsed: doc.collapsed } : {}),
    parentId: doc.parentId ?? null,
    position: doc.position,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateTerminusDoc(doc) {
  if (doc?.['@type'] !== 'ListItem') return 'document @type must be ListItem';
  if (!Number.isInteger(doc.itemId)) return 'document itemId must be an integer';
  if (!isNonEmptyString(doc.line1)) return 'document line1 must be a non-empty string';
  if (!Number.isInteger(doc.position)) return 'document position must be an integer';
  if (
    Object.prototype.hasOwnProperty.call(doc, 'parentId') &&
    doc.parentId !== null &&
    !Number.isInteger(doc.parentId)
  ) {
    return 'document parentId must be null or an integer';
  }
  if (Object.prototype.hasOwnProperty.call(doc, 'tags') && !Array.isArray(doc.tags)) {
    return 'document tags must be an array';
  }

  return undefined;
}

function storedValue(doc, key) {
  return Object.prototype.hasOwnProperty.call(doc, key) ? doc[key] : null;
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function createSeedDocs() {
  return SEED_DOCS.map(toTerminusDoc);
}

function createReservedDocs() {
  return {
    context_all_reserved: {
      '@type': 'ChatDoc',
      '@id': 'ChatDoc/context_all_reserved',
      docId: 'context_all_reserved',
      body: {
        id: 'context_all_reserved',
        title: 'Context Root',
        children: [
          { id: 'context_child_a', title: 'Alpha', value: 'alpha', children: [] },
          {
            id: 'context_child_b',
            title: 'Beta',
            value: 'beta',
            children: [
              { id: 'context_grandchild_b1', title: 'Nested', value: 'nested-value', children: [] },
            ],
          },
        ],
      },
    },
    settings_reserved: {
      '@type': 'ChatDoc',
      '@id': 'ChatDoc/settings_reserved',
      docId: 'settings_reserved',
      body: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        api_token: 'test-token',
      },
    },
    answers_reserved: {
      '@type': 'ChatDoc',
      '@id': 'ChatDoc/answers_reserved',
      docId: 'answers_reserved',
      body: {
        entries: [],
      },
    },
  };
}

function validateChatDoc(doc) {
  if (doc?.['@type'] !== 'ChatDoc') return 'document @type must be ChatDoc';
  if (!isNonEmptyString(doc.docId)) return 'document docId must be a non-empty string';
  if (!Object.prototype.hasOwnProperty.call(doc, 'body')) return 'document body is required';
  return undefined;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function invalidResourcePath(path) {
  return {
    '@type': 'api:GetDocumentErrorResponse',
    'api:error': {
      '@type': 'api:InvalidResourcePath',
      'api:resource_path': path,
    },
    'api:message': `Resource path invalid: '${path}'`,
    'api:status': 'api:failure',
  };
}

function schemaCheckFailure() {
  return {
    '@type': 'api:InsertDocumentErrorResponse',
    'api:error': {
      '@type': 'api:SchemaCheckFailure',
    },
    'api:message': 'Schema check failure',
    'api:status': 'api:failure',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve(undefined);
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

function createFakeTerminusDb() {
  let docs = createSeedDocs();
  let reservedDocs = createReservedDocs();

  function resetSeedDocs() {
    docs = createSeedDocs();
    reservedDocs = createReservedDocs();
    return { docs: clone(docs), reservedDocs: clone(reservedDocs) };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

      if (req.method === 'POST' && url.pathname === '/__test/reset') {
        await readBody(req);
        sendJson(res, 200, { ok: true, docs: resetSeedDocs() });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/__test/docs') {
        sendJson(res, 200, clone(docs));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/__test/reserved-docs') {
        sendJson(res, 200, clone(reservedDocs));
        return;
      }

      if (
        req.method === 'GET' &&
        parts[0] === 'api' &&
        parts[1] === 'document' &&
        parts.length === 4 &&
        url.searchParams.get('type') === 'ListItem' &&
        url.searchParams.get('as_list') === 'true'
      ) {
        sendJson(res, 200, clone(docs));
        return;
      }

      if (
        req.method === 'POST' &&
        parts[0] === 'api' &&
        parts[1] === 'document' &&
        parts.length === 4
      ) {
        const body = await readBody(req);
        if (!Array.isArray(body)) {
          sendJson(res, 400, { ok: false, error: 'expected document array' });
          return;
        }

        if (process.env.FAKE_TERMINUS_CHATDOC_UNSUPPORTED === '1' && body.some((doc) => doc?.['@type'] === 'ChatDoc')) {
          sendJson(res, 400, schemaCheckFailure());
          return;
        }

        const validationError = body.map((doc) => {
          if (doc?.['@type'] === 'ListItem') return validateTerminusDoc(doc);
          if (doc?.['@type'] === 'ChatDoc') return validateChatDoc(doc);
          return 'unsupported document type';
        }).find(Boolean);
        if (validationError) {
          sendJson(res, 400, { ok: false, error: validationError });
          return;
        }

        for (const incoming of body) {
          if (incoming['@type'] === 'ListItem') {
            const doc = normalizeTerminusDoc(incoming);
            const index = docs.findIndex((candidate) => candidate.itemId === doc.itemId);
            if (index === -1) docs.push(doc);
            else docs[index] = doc;
            continue;
          }

          reservedDocs[incoming.docId] = {
            '@type': 'ChatDoc',
            '@id': incoming['@id'] || `ChatDoc/${incoming.docId}`,
            docId: incoming.docId,
            body: clone(incoming.body),
          };
        }

        sendJson(res, 200, { ok: true });
        return;
      }

      if (
        req.method === 'POST' &&
        parts[0] === 'api' &&
        parts[1] === 'patch' &&
        parts.length === 4
      ) {
        const body = await readBody(req);
        const itemId = Number(String(body?.document_id || '').split('/').pop());
        const doc = docs.find((candidate) => candidate.itemId === itemId);
        if (!doc) {
          sendJson(res, 404, { ok: false, error: 'document not found' });
          return;
        }

        const operations = Object.entries(body.patch || {});
        for (const [key, operation] of operations) {
          if (operation?.['@op'] !== 'SwapValue') {
            sendJson(res, 400, { ok: false, error: 'unsupported patch operation' });
            return;
          }

          const before = Object.prototype.hasOwnProperty.call(operation, '@before') ? operation['@before'] : null;
          if (!valuesEqual(storedValue(doc, key), before)) {
            sendJson(res, 409, { ok: false, error: `patch before mismatch for ${key}` });
            return;
          }
        }

        for (const [key, operation] of operations) {
          if (operation['@after'] === undefined || operation['@after'] === null) {
            delete doc[key];
          } else {
            doc[key] = operation['@after'];
          }
        }

        if (!Array.isArray(doc.tags)) doc.tags = [];
        sendJson(res, 200, { ok: true });
        return;
      }

      if (
        req.method === 'DELETE' &&
        parts[0] === 'api' &&
        parts[1] === 'document' &&
        parts.length === 4
      ) {
        const documentId = url.searchParams.get('id');
        const itemId = Number(String(documentId || '').split('/').pop());
        const before = docs.length;
        docs = docs.filter((candidate) => candidate.itemId !== itemId);

        sendJson(res, before === docs.length ? 404 : 200, before === docs.length
          ? { ok: false, error: 'document not found' }
          : { ok: true });
        return;
      }

      if (
        req.method === 'GET' &&
        parts[0] === 'api' &&
        parts[1] === 'document' &&
        parts.length === 6 &&
        parts[4] === 'ListItem'
      ) {
        const itemId = Number(parts[5]);
        const doc = docs.find((candidate) => candidate.itemId === itemId);
        sendJson(res, doc ? 200 : 404, doc ? clone(doc) : { ok: false, error: 'document not found' });
        return;
      }

      if (
        req.method === 'GET' &&
        parts[0] === 'api' &&
        parts[1] === 'document' &&
        parts.length === 6 &&
        parts[4] === 'ChatDoc'
      ) {
        if (process.env.FAKE_TERMINUS_CHATDOC_UNSUPPORTED === '1') {
          sendJson(res, 400, invalidResourcePath(url.pathname));
          return;
        }
        const doc = reservedDocs[parts[5]];
        sendJson(res, doc ? 200 : 404, doc ? clone(doc) : { ok: false, error: 'document not found' });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  return {
    server,
    resetSeedDocs,
    getDocs: () => clone(docs),
    getReservedDocs: () => clone(reservedDocs),
  };
}

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

function stop(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function startFakeTerminusDb() {
  const fake = createFakeTerminusDb();
  const url = await listen(fake.server);

  return {
    url,
    resetSeedDocs: fake.resetSeedDocs,
    getDocs: fake.getDocs,
    getReservedDocs: fake.getReservedDocs,
    stop: () => stop(fake.server),
  };
}

module.exports = {
  createFakeTerminusDb,
  createSeedDocs,
  startFakeTerminusDb,
};
