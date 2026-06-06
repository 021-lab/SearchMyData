# SearchMyData — Server integration guide

> **For the server coder.**
> API contract: see `API.md`. Do not change `API.md`; escalate to project owner if needed.
> All TerminusDB logic lives here — none goes to the browser.

---

## What to build

Replace the existing static `server.js` with one that:
1. Serves `GET /document` (and the default-document alias `GET /list-data.js`) from TerminusDB (fallback to static file)
2. Serves `GET /api/document-check` so the frontend can detect drift from the server's tree
3. Handles `POST /api/action` for every action type
4. Maintains a per-session undo log for `type: "Undo"`

No frontend code changes are required.

---

## Environment variables

Create a `.env` file (see `.env.example`):

| Variable | Required | Notes |
|----------|----------|-------|
| `TERMINUS_URL` | yes | e.g. `http://localhost:6363` |
| `TERMINUS_TEAM` | yes | usually `admin` for local installs |
| `TERMINUS_DB` | yes | e.g. `searchmydata` |
| `TERMINUS_USER` | no | default `admin` |
| `TERMINUS_PASS` | yes | never expose to browser |
| `PORT` | no | default `3000` |

Load with:
```javascript
require('dotenv').config();
// or parse manually:
const raw = fs.readFileSync('.env', 'utf8');
raw.split('\n').forEach(line => {
  const [k, ...rest] = line.split('=');
  if (k && !k.startsWith('#')) process.env[k.trim()] = rest.join('=').trim();
});
```

---

## TerminusDB connection

Base path: `${TERMINUS_URL}/api`

All requests use HTTP Basic auth:

```javascript
const auth = 'Basic ' + Buffer.from(`${TERMINUS_USER}:${TERMINUS_PASS}`).toString('base64');
const DB_PATH = `${TERMINUS_TEAM}/${TERMINUS_DB}`;
```

Helper (no npm deps):

```javascript
function terminusReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(TERMINUS_URL + path);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = require('https').request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method,
        headers: {
          'Authorization':  auth,
          'Content-Type':   'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
```

For local HTTP installs substitute `require('http')` or add a protocol check.

---

## TerminusDB schema

Each list item is stored as a document of type `ListItem`:

```json
{
  "@type":    "ListItem",
  "@id":      "ListItem/42",
  "itemId":   42,
  "line1":    "Молоко 3.2%",
  "line2":    "2 пакета",
  "tags":     ["Важное"],
  "collapsed": false,
  "parentId": null,
  "position": 0
}
```

Fields:

| Field | Type | Notes |
|-------|------|-------|
| `itemId` | integer | matches the browser `id` |
| `line1` | string | non-empty |
| `line2` | string \| null | omit when absent |
| `tags` | string[] | empty array when none |
| `collapsed` | boolean | default false |
| `parentId` | integer \| null | null for root items |
| `position` | integer | zero-based within parent |

Create the schema once (idempotent):

```javascript
await terminusReq('POST', `/api/schema/${DB_PATH}`, [
  {
    "@type": "Class",
    "@id":   "ListItem",
    "@key":  { "@type": "ValueHash" },
    "itemId":    "xsd:integer",
    "line1":     "xsd:string",
    "line2":     { "@type": "Optional", "@class": "xsd:string" },
    "tags":      { "@type": "List", "@class": "xsd:string" },
    "collapsed": { "@type": "Optional", "@class": "xsd:boolean" },
    "parentId":  { "@type": "Optional", "@class": "xsd:integer" },
    "position":  "xsd:integer"
  }
]);
```

---

## GET /document and GET /api/document-check

Both load a document's tree the same way `serveListData` does below — query
TerminusDB for the document (defaulting to `list-data.js` when `id` is omitted),
convert flat→tree, and respond with `{ id, nextId, items }`. `document-check`
returns the identical shape; the frontend does the diffing, the server just
needs to hand back its current authoritative tree.

`GET /list-data.js` stays the JS-file-shaped alias of `GET /document` for the
default document, so the existing `<script src="list-data.js">` tag keeps working.

## GET /list-data.js

Query all items, convert flat→tree, emit JS file.

```javascript
async function serveListData(res) {
  try {
    const { status, body } = await terminusReq(
      'GET',
      `/api/document/${DB_PATH}?type=ListItem&as_list=true`
    );
    if (status !== 200 || !Array.isArray(body)) throw new Error('db error');

    const items  = flatToTree(body);
    const nextId = computeNextId(body);
    const js     = buildListDataJs(items, nextId);

    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(js);
  } catch {
    // Static fallback
    const data = fs.readFileSync(path.join(__dirname, 'list-data.js'));
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(data);
  }
}
```

### flat→tree conversion

```javascript
function flatToTree(docs) {
  const map = {};
  docs.forEach(d => {
    map[d.itemId] = {
      id:        d.itemId,
      line1:     d.line1,
      ...(d.line2     ? { line2:     d.line2     } : {}),
      ...(d.tags?.length ? { tags:   d.tags       } : {}),
      ...(d.collapsed ? { collapsed: d.collapsed } : {}),
      children:  [],
      _position: d.position,
      _parentId: d.parentId ?? null
    };
  });

  const roots = [];
  Object.values(map).forEach(item => {
    if (item._parentId === null) {
      roots.push(item);
    } else if (map[item._parentId]) {
      map[item._parentId].children.push(item);
    }
  });

  function sort(arr) {
    arr.sort((a, b) => a._position - b._position);
    arr.forEach(item => { sort(item.children); delete item._position; delete item._parentId; });
  }
  sort(roots);
  return roots;
}

function computeNextId(docs) {
  if (!docs.length) return 1;
  return Math.max(...docs.map(d => d.itemId)) + 1;
}

function buildListDataJs(items, nextId) {
  return `/* auto-generated — do not edit */\nconst nextId = ${nextId};\nconst items = ${JSON.stringify(items, null, 2)};\n`;
}
```

---

## POST /api/action

Parse JSON body, dispatch by `type`, return `{ ok: true }` or `{ ok: false, error: "..." }`.

```javascript
async function handleAction(body, res) {
  const { type, data } = body;
  try {
    let result = { ok: true };
    switch (type) {
      case 'add_item':      await actionAdd(data);           break;
      case 'edit_item':     await actionEdit(data);          break;
      case 'delete_item':   await actionDelete(data);        break;
      case 'toggle_tag':    await actionToggleTag(data);     break;
      case 'toggle_collapse': await actionToggleCollapse(data); break;
      case 'reorder':       await actionReorder(data);       break;
      case 'Undo':          result = await actionUndo();     break;
      default: throw new Error('unknown action type: ' + type);
    }
    jsonReply(res, result);
  } catch (e) {
    jsonReply(res, { ok: false, error: e.message });
  }
}

function jsonReply(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
```

---

## Action handlers

### `add_item`

```javascript
async function actionAdd({ id, line1, line2, parentId }) {
  const doc = {
    "@type":   "ListItem",
    itemId:    id,
    line1,
    ...(line2 !== undefined ? { line2 } : {}),
    tags:      [],
    parentId:  parentId ?? null,
    position:  await nextPositionFor(parentId ?? null)
  };
  const r = await terminusReq('POST', `/api/document/${DB_PATH}`, [doc]);
  if (r.status !== 200 && r.status !== 201) throw new Error('db insert failed');
  pushUndo({ type: 'delete_item', data: { id } });
}

async function nextPositionFor(parentId) {
  const { body } = await terminusReq('GET', `/api/document/${DB_PATH}?type=ListItem&as_list=true`);
  if (!Array.isArray(body)) return 0;
  const siblings = body.filter(d => (d.parentId ?? null) === parentId);
  return siblings.length; // append at end
}
```

### `edit_item`

```javascript
async function actionEdit({ id, line1, line2 }) {
  const existing = await getItem(id);
  const patch = {
    line1: { "@op": "SwapValue", "@before": existing.line1, "@after": line1 }
  };
  if (line2 !== undefined) {
    patch.line2 = { "@op": "SwapValue", "@before": existing.line2 ?? null, "@after": line2 };
  } else if (existing.line2 !== undefined) {
    patch.line2 = { "@op": "SwapValue", "@before": existing.line2, "@after": null };
  }
  const r = await terminusReq('POST', `/api/patch/${DB_PATH}`,
    { document_id: `ListItem/${id}`, patch });
  if (r.status !== 200) throw new Error('db patch failed');
  pushUndo({ type: 'edit_item', data: { id, line1: existing.line1, line2: existing.line2 } });
}
```

### `delete_item`

Delete the item and all its descendants recursively.

```javascript
async function actionDelete({ id }) {
  const { body } = await terminusReq('GET', `/api/document/${DB_PATH}?type=ListItem&as_list=true`);
  if (!Array.isArray(body)) throw new Error('db read failed');

  const toDelete = collectSubtree(id, body);
  const snapshot = body.filter(d => toDelete.has(d.itemId));

  for (const itemId of toDelete) {
    await terminusReq('DELETE', `/api/document/${DB_PATH}?id=ListItem%2F${itemId}`);
  }
  pushUndo({ type: 'restore_items', data: { docs: snapshot } });
}

function collectSubtree(rootId, docs) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    docs.forEach(d => {
      if (!ids.has(d.itemId) && ids.has(d.parentId)) {
        ids.add(d.itemId); changed = true;
      }
    });
  }
  return ids;
}
```

### `toggle_tag`

```javascript
async function actionToggleTag({ id, tag }) {
  const existing = await getItem(id);
  const before = existing.tags ?? [];
  const after  = before.includes(tag) ? before.filter(t => t !== tag) : [...before, tag];
  const r = await terminusReq('POST', `/api/patch/${DB_PATH}`, {
    document_id: `ListItem/${id}`,
    patch: { tags: { "@op": "SwapValue", "@before": before, "@after": after } }
  });
  if (r.status !== 200) throw new Error('db patch failed');
  pushUndo({ type: 'toggle_tag', data: { id, tag } }); // toggling again = undo
}
```

### `toggle_collapse`

```javascript
async function actionToggleCollapse({ id }) {
  const existing = await getItem(id);
  const before = existing.collapsed ?? false;
  const after  = !before;
  const r = await terminusReq('POST', `/api/patch/${DB_PATH}`, {
    document_id: `ListItem/${id}`,
    patch: { collapsed: { "@op": "SwapValue", "@before": before, "@after": after } }
  });
  if (r.status !== 200) throw new Error('db patch failed');
  pushUndo({ type: 'toggle_collapse', data: { id } });
}
```

### `reorder`

Only update items whose `parentId` or `position` actually changed.

```javascript
async function actionReorder({ flat }) {
  const { body } = await terminusReq('GET', `/api/document/${DB_PATH}?type=ListItem&as_list=true`);
  if (!Array.isArray(body)) throw new Error('db read failed');

  const byId = {};
  body.forEach(d => { byId[d.itemId] = d; });

  const prevFlat = body.map(d => ({ id: d.itemId, parentId: d.parentId ?? null, position: d.position }));

  for (const { id, parentId, position } of flat) {
    const existing = byId[id];
    if (!existing) continue;
    const oldParent = existing.parentId ?? null;
    if (oldParent === parentId && existing.position === position) continue;

    const patch = {};
    if (oldParent !== parentId)
      patch.parentId = { "@op": "SwapValue", "@before": oldParent, "@after": parentId };
    if (existing.position !== position)
      patch.position = { "@op": "SwapValue", "@before": existing.position, "@after": position };

    await terminusReq('POST', `/api/patch/${DB_PATH}`, {
      document_id: `ListItem/${id}`,
      patch
    });
  }
  pushUndo({ type: 'reorder', data: { flat: prevFlat } });
}
```

### `Undo`

The undo log is a simple in-memory stack. Each action pushes its inverse before
committing. Undo pops the top entry and re-applies it as a raw action (bypassing
the undo log). The frontend has already reverted its local state from its own
saved snapshot, so — same as every other action — the response is just `{ ok: true }`;
no fresh tree needs to be queried or returned.

```javascript
const undoLog = []; // [{ type, data }, ...]

function pushUndo(entry) {
  undoLog.push(entry);
  if (undoLog.length > 50) undoLog.shift(); // cap at 50
}

async function actionUndo() {
  if (!undoLog.length) return { ok: false, error: 'nothing to undo' };
  const entry = undoLog.pop();

  // Apply the inverse action directly (no nested undo push)
  switch (entry.type) {
    case 'delete_item':      await actionDelete(entry.data);         break;
    case 'edit_item':        await actionEdit(entry.data);           break;
    case 'add_item':         await actionAdd(entry.data);            break;
    case 'toggle_tag':       await actionToggleTag(entry.data);      break;
    case 'toggle_collapse':  await actionToggleCollapse(entry.data); break;
    case 'reorder':          await actionReorder(entry.data);        break;
    case 'restore_items':    await restoreItems(entry.data.docs);    break;
  }
  // Undo of undo should not re-push; pop the entry we just pushed (if any)
  undoLog.pop();

  return { ok: true };
}

async function restoreItems(docs) {
  for (const doc of docs) {
    await terminusReq('POST', `/api/document/${DB_PATH}`, [doc]);
  }
}
```

### `getItem` helper

```javascript
async function getItem(id) {
  const r = await terminusReq('GET', `/api/document/${DB_PATH}/ListItem/${id}`);
  if (r.status !== 200) throw new Error(`item ${id} not found`);
  return r.body;
}
```

---

## Full server skeleton

```
server.js
├── env loading
├── terminusReq()
├── flatToTree() / computeNextId() / buildListDataJs()
├── getItem()
├── undoLog + pushUndo()
├── actionAdd / actionEdit / actionDelete
├── actionToggleTag / actionToggleCollapse
├── actionReorder / actionUndo / restoreItems
├── serveListData() / serveDocument() / serveDocumentCheck()
├── handleAction()
└── http.createServer → router
    ├── GET  /document            → serveDocument()
    ├── GET  /api/document-check  → serveDocumentCheck()
    ├── GET  /list-data.js        → serveListData()
    ├── POST /api/action          → handleAction()
    └── static files              (existing logic)
```

---

## Testing checklist

- [ ] `GET /list-data.js` returns valid JS when TerminusDB is up
- [ ] `GET /list-data.js` falls back to static file when TerminusDB is down
- [ ] `GET /document` returns the default document when `id` is omitted
- [ ] `GET /document?id=<id>` returns the requested document and its subtree
- [ ] `GET /document?id=<unknown>` returns `{ ok: false, error: "document not found" }`
- [ ] `GET /api/document-check` returns the server's current tree in the same shape as `GET /document`
- [ ] `add_item` inserts a root item; reload shows it
- [ ] `add_item` inserts a child item under correct parent; reload shows it
- [ ] `edit_item` updates line1/line2; reload shows change
- [ ] `delete_item` removes item; reload confirms gone
- [ ] `delete_item` cascades — children also removed
- [ ] `toggle_tag` adds tag on first call; reload shows tag
- [ ] `toggle_tag` removes tag on second call; reload confirms removal
- [ ] `toggle_collapse` flips collapsed; reload persists state
- [ ] `reorder` moves item; reload shows new order
- [ ] `Undo` after add removes the item from TerminusDB (reload confirms)
- [ ] `Undo` after delete restores the item in TerminusDB (reload confirms)
- [ ] `Undo` when nothing to undo returns `{ ok: false, error: "nothing to undo" }`
- [ ] Unknown action type returns `{ ok: false, error: "..." }` (HTTP 200)
- [ ] TerminusDB auth failure returns `{ ok: false, error: "..." }` (no crash)

---

## Constraints

- Do **not** add any TerminusDB calls to browser JS
- Do **not** change `API.md`; escalate to project owner if the API needs to change
- Do **not** expose `TERMINUS_PASS` or any credentials in HTTP responses
