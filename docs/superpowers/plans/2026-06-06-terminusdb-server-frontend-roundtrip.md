# TerminusDB Server And Frontend Roundtrip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a server-backed SearchMyData list where the browser renders all `ListItem` documents from TerminusDB as a nested list, every documented user action persists through the API, and the final browser state matches a fresh reload from the server.

**Architecture:** Keep TerminusDB access entirely in `server.js`; the browser talks only to same-origin endpoints from `API.md`. Keep the existing `<script src="list-data.js">` bootstrap path, but serve that file dynamically from TerminusDB when the database is reachable. Use a deterministic local fake TerminusDB for automated tests and a separate remote-TerminusDB UAT path for the real API server.

**Tech Stack:** Vanilla HTML/CSS/JS frontend, Node.js HTTP server with built-in modules, TerminusDB HTTP API, `node:test` for server tests, Playwright for browser roundtrip tests.

---

## Acceptance Criteria

- Browser first load renders every `ListItem` document returned by TerminusDB as one nested list, preserving `parentId` and `position`.
- Page reload loads current list state from the database through `GET /list-data.js`.
- Browser actions covered by documentation are executed from the UI: add root item, add nested item, view item, edit item, delete item with descendants, add/remove tag, collapse/expand, reorder, nest by drag/right shift, and Undo.
- After the full browser action scenario, the test captures the browser tree and compares it to a newly loaded tree from `GET /document`.
- The test passes only if normalized browser state equals normalized server state before and after page reload.
- Browser code never calls TerminusDB directly and never exposes TerminusDB credentials.

## Assumptions

- "All documents from the database" means all TerminusDB documents of type `ListItem` for the default document currently represented by `list-data.js`.
- If the product later needs multiple independent named documents, `API.md` needs a new endpoint such as `GET /documents`.
- Existing `API.md` is the contract; `FRONTEND.md` and `SERVER.md` can be updated after implementation if they lag behind tested behavior.
- Port `3000` is the documented app port. If another process already owns it during local work, stop and ask before changing ports.

## File Map

- Create: `package.json` - scripts and dev dependencies for server, server tests, and browser UAT.
- Create: `.gitignore` - ignore `node_modules/`, `.env`, Playwright artifacts, and temporary test files.
- Create: `server.js` - static file server, TerminusDB adapter, API router, mutation handlers, undo log.
- Create: `tests/fake-terminusdb.js` - local in-memory TerminusDB-compatible API used by automated tests.
- Create: `tests/server.test.js` - `node:test` coverage for API behavior and persistence rules.
- Create: `tests/e2e-roundtrip.spec.js` - Playwright UI test that performs documented actions and verifies browser/server equivalence.
- Create: `playwright.config.js` - browser test configuration against `http://127.0.0.1:3000`.
- Modify: `list-manager.html` - add action sync, robust undo snapshots, document-check helper, and test-visible state extraction.
- Modify: `FRONTEND.md` - update integration notes after implementation if behavior differs from the current guide.
- Modify: `SERVER.md` - update server notes after implementation if exact TerminusDB calls differ from the current skeleton.

---

### Task 1: Project Runtime And Scripts

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Create package scripts**

Add `package.json`:

```json
{
  "name": "searchmydata",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "test:server": "node --test tests/server.test.js",
    "test:e2e": "playwright test tests/e2e-roundtrip.spec.js",
    "test": "npm run test:server && npm run test:e2e"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0"
  }
}
```

- [ ] **Step 2: Ignore local runtime artifacts**

Add `.gitignore`:

```gitignore
node_modules/
.env
test-results/
playwright-report/
.playwright/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `npm test` becomes available.

- [ ] **Step 4: Commit runtime scaffolding**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add node test runtime"
```

---

### Task 2: TerminusDB Server Read Path

**Files:**
- Create: `server.js`
- Create: `tests/fake-terminusdb.js`
- Create: `tests/server.test.js`

- [ ] **Step 1: Write failing read endpoint tests**

Create `tests/server.test.js` with tests that start `tests/fake-terminusdb.js`, start `server.js` with `TERMINUS_URL` pointing at the fake DB, and verify:

```javascript
test('GET /document returns nested tree from TerminusDB', async () => {
  const res = await fetch(`${appUrl}/document`);
  const body = await res.json();
  assert.equal(body.id, 'list-data.js');
  assert.equal(body.nextId, 32);
  assert.deepEqual(body.items[1].children.map(i => i.id), [26, 27]);
});

test('GET /list-data.js emits executable data from TerminusDB', async () => {
  const res = await fetch(`${appUrl}/list-data.js`);
  const js = await res.text();
  assert.match(res.headers.get('content-type'), /application\/javascript/);
  assert.match(js, /const nextId = 32;/);
  assert.match(js, /const items = /);
});

test('GET /api/document-check matches GET /document shape', async () => {
  const doc = await (await fetch(`${appUrl}/document`)).json();
  const check = await (await fetch(`${appUrl}/api/document-check`)).json();
  assert.deepEqual(check, doc);
});
```

Run: `npm run test:server`

Expected: FAIL because `server.js` and the fake TerminusDB helper are not implemented yet.

- [ ] **Step 2: Implement fake TerminusDB read endpoints**

Create `tests/fake-terminusdb.js` with these test endpoints:

```text
GET  /api/document/:team/:db?type=ListItem&as_list=true
GET  /api/document/:team/:db/ListItem/:id
POST /__test/reset
GET  /__test/docs
```

Seed docs must include root and nested items from `list-data.js`, including ids `1`, `2`, `26`, `27`, and at least one later root item so ordering is testable.

- [ ] **Step 3: Implement `server.js` read units**

Implement:

```javascript
loadEnv();
terminusReq(method, apiPath, body);
listItemsFromDb();
flatToTree(docs);
computeNextId(docs);
buildListDataJs(items, nextId);
serveDocument(req, res);
serveListData(req, res);
serveDocumentCheck(req, res);
serveStatic(req, res);
route(req, res);
```

Required routes:

```text
GET /document           -> JSON { id: "list-data.js", nextId, items }
GET /api/document-check -> same JSON shape as /document
GET /list-data.js       -> JavaScript const nextId + const items
GET /* static files     -> existing HTML/CSS/JS files
```

- [ ] **Step 4: Verify read endpoint tests**

Run: `npm run test:server`

Expected: read endpoint tests PASS.

- [ ] **Step 5: Commit server read path**

```bash
git add server.js tests/fake-terminusdb.js tests/server.test.js
git commit -m "feat: serve list data from terminusdb"
```

---

### Task 3: Server Mutations And Undo

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`
- Modify: `tests/fake-terminusdb.js`

- [ ] **Step 1: Add failing mutation tests**

Add server tests for every `POST /api/action` type:

```javascript
test('add_item persists a root item and reload shows it', async () => {
  await postAction('add_item', { id: 32, line1: 'Server root', line2: 'created', parentId: null });
  const doc = await getDocument();
  assert.equal(flatten(doc.items).some(i => i.id === 32 && i.line1 === 'Server root'), true);
});

test('add_item persists a nested item under parent', async () => {
  await postAction('add_item', { id: 33, line1: 'Nested child', parentId: 2 });
  const parent = findInTree((await getDocument()).items, 2);
  assert.equal(parent.children.some(i => i.id === 33), true);
});

test('edit_item persists line changes', async () => {
  await postAction('edit_item', { id: 1, line1: 'Edited milk', line2: '3 packs' });
  assert.equal(findInTree((await getDocument()).items, 1).line1, 'Edited milk');
});

test('delete_item removes item and descendants', async () => {
  await postAction('delete_item', { id: 2 });
  const ids = flatten((await getDocument()).items).map(i => i.id);
  assert.equal(ids.includes(2), false);
  assert.equal(ids.includes(26), false);
  assert.equal(ids.includes(27), false);
});

test('toggle_tag adds and removes a tag', async () => {
  await postAction('toggle_tag', { id: 1, tag: 'Срочно' });
  assert.deepEqual(findInTree((await getDocument()).items, 1).tags, ['Срочно']);
  await postAction('toggle_tag', { id: 1, tag: 'Срочно' });
  assert.equal(findInTree((await getDocument()).items, 1).tags, undefined);
});

test('toggle_collapse persists collapsed state', async () => {
  await postAction('toggle_collapse', { id: 2 });
  assert.equal(findInTree((await getDocument()).items, 2).collapsed, true);
});

test('reorder persists parentId and position', async () => {
  await postAction('reorder', {
    flat: [
      { id: 1, parentId: null, position: 0 },
      { id: 3, parentId: null, position: 1 },
      { id: 2, parentId: 3, position: 0 },
      { id: 26, parentId: 2, position: 0 },
      { id: 27, parentId: 2, position: 1 }
    ]
  });
  assert.equal(findInTree((await getDocument()).items, 3).children[0].id, 2);
});

test('Undo reverses the last server mutation', async () => {
  await postAction('add_item', { id: 40, line1: 'Undo me', parentId: null });
  await postAction('Undo', {});
  assert.equal(flatten((await getDocument()).items).some(i => i.id === 40), false);
});
```

Run: `npm run test:server`

Expected: FAIL with unknown action or missing handler errors.

- [ ] **Step 2: Implement mutation endpoints in fake TerminusDB**

Add:

```text
POST   /api/document/:team/:db
POST   /api/patch/:team/:db
DELETE /api/document/:team/:db?id=ListItem%2F:id
```

The fake DB must mutate an in-memory array so server tests prove persistence and reload behavior.

- [ ] **Step 3: Implement server mutation dispatch**

Implement:

```javascript
handleAction(req, res);
actionAdd(data, options);
actionEdit(data, options);
actionDelete(data, options);
actionToggleTag(data, options);
actionToggleCollapse(data, options);
actionReorder(data, options);
actionUndo();
restoreItems(docs, options);
pushUndo(entry);
getItem(id);
collectSubtree(rootId, docs);
nextPositionFor(parentId);
```

Use `options.recordUndo === false` when applying an undo entry so undo does not push a new undo entry.

All actions must return:

```text
success -> HTTP 200 { "ok": true }
known validation error -> HTTP 200 { "ok": false, "error": "..." }
unknown action -> HTTP 200 { "ok": false, "error": "unknown action type: <type>" }
```

- [ ] **Step 4: Verify mutation tests**

Run: `npm run test:server`

Expected: all server tests PASS.

- [ ] **Step 5: Commit server mutations**

```bash
git add server.js tests/fake-terminusdb.js tests/server.test.js
git commit -m "feat: persist list actions"
```

---

### Task 4: Frontend Sync And Complete Undo

**Files:**
- Modify: `list-manager.html`
- Modify: `FRONTEND.md`

- [ ] **Step 1: Add frontend sync helpers**

Add before mutation call sites:

```javascript
let pendingActions = Promise.resolve();

function sendAction(type, data) {
  pendingActions = pendingActions
    .then(() => fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data: data || {} })
    }))
    .then(r => r.json())
    .then(body => {
      if (!body.ok) showToast(body.error || 'Ошибка синхронизации');
      return body;
    })
    .catch(() => {
      showToast('Нет связи с сервером');
      return { ok: false, error: 'network error' };
    });
  return pendingActions;
}

function flattenForAction(tree = items) {
  const result = [];
  function walk(arr, parentId) {
    arr.forEach((item, position) => {
      result.push({ id: item.id, parentId, position });
      if (item.children?.length) walk(item.children, item.id);
    });
  }
  walk(tree, null);
  return result;
}

function cloneItems() {
  return JSON.parse(JSON.stringify(items));
}

window.__searchMyDataTest = {
  getItems: () => cloneItems(),
  getNextId: () => nextId,
  waitForSync: () => pendingActions
};
```

- [ ] **Step 2: Save undo snapshots before every mutation**

Call `saveUndoSnapshot()` before local state changes in:

```text
confirmModal() edit branch
confirmModal() nest branch
confirmModal() add branch
doDelete() before animation starts
execTag() before changing tags
toggleCollapse() before changing collapsed
startDrag() already does this
```

This is required because `SERVER.md` expects Undo after add/delete, while current frontend snapshots only before drag.

- [ ] **Step 3: Send action after each local mutation**

Add calls after local state is updated and `render()`/toast has run:

```javascript
sendAction('add_item', { id: newId, line1: l1, line2: l2 || undefined, parentId: null });
sendAction('add_item', { id: newId, line1: l1, line2: l2 || undefined, parentId: modalTargetId });
sendAction('edit_item', { id: modalTargetId, line1: l1, line2: l2 || undefined });
sendAction('delete_item', { id: itemId });
sendAction('toggle_tag', { id: itemId, tag });
sendAction('toggle_collapse', { id: itemId });
sendAction('reorder', { flat: flattenForAction(items) });
sendAction('Undo', {});
```

For add/nest, use `const newId = nextId++;` before inserting so the server receives the exact browser-assigned id.

- [ ] **Step 4: Add document-check helper**

Add:

```javascript
function normalizeTree(tree) {
  return tree.map(item => ({
    id: item.id,
    line1: item.line1,
    ...(item.line2 ? { line2: item.line2 } : {}),
    ...(item.tags?.length ? { tags: [...item.tags].sort() } : {}),
    ...(item.collapsed ? { collapsed: true } : {}),
    children: normalizeTree(item.children || [])
  }));
}

async function checkDocumentAgainstServer() {
  await pendingActions;
  const res = await fetch('/api/document-check');
  const server = await res.json();
  return {
    ok: JSON.stringify(normalizeTree(items)) === JSON.stringify(normalizeTree(server.items)),
    browser: normalizeTree(items),
    server: normalizeTree(server.items)
  };
}

window.__searchMyDataTest.checkDocumentAgainstServer = checkDocumentAgainstServer;
```

- [ ] **Step 5: Update frontend documentation**

Update `FRONTEND.md` with these facts:

```text
sendAction is queued, same-origin only, and does not call TerminusDB directly.
Undo snapshot is saved before every local mutation.
Roundtrip tests wait for pendingActions before comparing browser and server state.
```

- [ ] **Step 6: Commit frontend sync**

```bash
git add list-manager.html FRONTEND.md
git commit -m "feat: sync browser actions to server"
```

---

### Task 5: Browser Roundtrip Test

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e-roundtrip.spec.js`
- Modify: `tests/fake-terminusdb.js`

- [ ] **Step 1: Add Playwright config**

Create `playwright.config.js`:

```javascript
module.exports = {
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
};
```

- [ ] **Step 2: Write UI helpers**

Create helpers that use visible UI and same event handlers as a user:

```javascript
async function addRoot(page, line1, line2) {
  await page.locator('#add-btn').click();
  await page.locator('#input-line1').fill(line1);
  await page.locator('#input-line2').fill(line2);
  await page.locator('#btn-confirm').click();
}

async function waitForSync(page) {
  await page.evaluate(() => window.__searchMyDataTest.waitForSync());
}

async function assertBrowserEqualsServer(page) {
  const result = await page.evaluate(() => window.__searchMyDataTest.checkDocumentAgainstServer());
  expect(result.ok).toBe(true);
}
```

For swipe/drop and drag actions, use pointer movement against `.list-item-wrapper[data-id="<id>"] .list-item`.

- [ ] **Step 3: Test initial load from database**

```javascript
test('initial load renders all database items as a nested list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.list-item-wrapper')).toHaveCount(31);
  await expect(page.locator('.list-item-wrapper[data-id="26"]')).toHaveAttribute('data-level', '1');
  await expect(page.locator('.list-item-wrapper[data-id="27"]')).toHaveAttribute('data-level', '1');
});
```

- [ ] **Step 4: Test full documented action scenario**

The scenario must perform:

```text
1. Add root item through + modal.
2. Add nested item through right swipe -> "Вложенный".
3. View item through right swipe -> "Просмотр" and close modal.
4. Edit item through right swipe -> "Изменить".
5. Add a tag through left swipe tag panel.
6. Remove the same tag through left swipe tag panel.
7. Collapse a parent by tapping/clicking it.
8. Expand the same parent by tapping/clicking it.
9. Long-press drag one item to reorder it.
10. Long-press drag/right-shift one item to nest it.
11. Delete an item through right swipe -> "Удалить".
12. Use Undo and verify the deleted item returns.
13. Wait for sync queue to drain.
14. Compare browser tree with GET /document.
15. Reload page.
16. Compare reloaded browser tree with GET /document again.
```

Required assertions:

```javascript
await waitForSync(page);
await assertBrowserEqualsServer(page);

await page.reload();
await waitForSync(page);
await assertBrowserEqualsServer(page);
```

- [ ] **Step 5: Verify e2e failure before frontend implementation**

Run: `npm run test:e2e`

Expected: FAIL because `window.__searchMyDataTest` and action sync do not exist until Task 4 is complete.

- [ ] **Step 6: Verify e2e pass after frontend implementation**

Run: `npm run test:e2e`

Expected: PASS, with final browser tree equal to fresh server state before and after reload.

- [ ] **Step 7: Commit browser test**

```bash
git add playwright.config.js tests/e2e-roundtrip.spec.js tests/fake-terminusdb.js
git commit -m "test: cover browser server roundtrip"
```

---

### Task 6: Remote TerminusDB UAT

**Files:**
- Modify: `SERVER.md`
- Create: `docs/uat/terminusdb-roundtrip.md`

- [ ] **Step 1: Create remote UAT checklist**

Create `docs/uat/terminusdb-roundtrip.md`:

```markdown
# Remote TerminusDB Roundtrip UAT

## Preconditions

- Server is running on `http://127.0.0.1:3000`.
- `.env` points at the remote TerminusDB API.
- `TERMINUS_PASS` is present only in `.env`.
- `curl http://127.0.0.1:3000/document` returns HTTP 200 and JSON with `items`.

## Test

- Open `http://127.0.0.1:3000/`.
- Confirm all database items render as a nested list.
- Add root item.
- Add nested item.
- View item.
- Edit item.
- Delete item.
- Add tag.
- Remove tag.
- Collapse parent.
- Expand parent.
- Reorder item.
- Nest item by drag/right shift.
- Use Undo.
- Run in DevTools console:

```javascript
await window.__searchMyDataTest.waitForSync();
await window.__searchMyDataTest.checkDocumentAgainstServer();
```

Expected: `{ ok: true, ... }`.

- Reload the page.
- Run the same console check again.

Expected: `{ ok: true, ... }`.
```

- [ ] **Step 2: Start server against remote TerminusDB**

Run:

```bash
PORT=3000 node server.js
```

Expected: server listens on `http://127.0.0.1:3000`.

- [ ] **Step 3: Verify direct server API**

Run:

```bash
curl -sS http://127.0.0.1:3000/document | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); if(!Array.isArray(j.items)) process.exit(1); console.log(j.items.length)})"
```

Expected: prints a positive item count.

- [ ] **Step 4: Run browser UAT at direct URL**

Open `http://127.0.0.1:3000/` first. Do not use file URLs for this UAT because the acceptance criterion depends on server reload and `/api/action`.

- [ ] **Step 5: Commit UAT docs**

```bash
git add SERVER.md docs/uat/terminusdb-roundtrip.md
git commit -m "docs: add remote terminusdb uat"
```

---

### Task 7: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run server tests**

Run: `npm run test:server`

Expected: all tests PASS.

- [ ] **Step 2: Run browser roundtrip tests**

Run: `npm run test:e2e`

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: server and browser tests PASS.

- [ ] **Step 4: Verify worktree state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: branch contains the planned commits and has no unintended untracked files except local `.env`.

- [ ] **Step 5: Generate live preview link**

Run:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)
echo "https://htmlpreview.github.io/?https://raw.githubusercontent.com/021-lab/searchmydata/${BRANCH}/list-manager.html?v=${COMMIT}"
```

Expected: link opens the current `list-manager.html` version.

---

## Self-Review

- Spec coverage: server implementation, frontend implementation, all documented actions, database reload, browser/server final-state equality, and remote TerminusDB UAT are covered.
- Placeholder scan: no placeholder marker or unresolved acceptance step is left in the plan.
- API consistency: action names match `API.md`: `add_item`, `edit_item`, `delete_item`, `toggle_tag`, `toggle_collapse`, `reorder`, `Undo`.
- Risk noted: multiple independent document ids are not covered by current `API.md`; this plan covers all `ListItem` documents in the default document.
