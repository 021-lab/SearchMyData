# Chat With Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/chat-with-secrets` with `Data`, `Chat`, and `History` tabs, backed by TerminusDB reserved documents and a dummy-capable server-side chat flow.

**Architecture:** Extend the existing Node server with a small reserved-document layer for `context_all_reserved`, `settings_reserved`, and `answers_reserved`, add chat endpoints under `/api/chat/*`, and serve a new standalone HTML page at `/chat-with-secrets` that embeds the existing data UI without modifying its code. Keep the current list-manager API unchanged and add tests before each implementation step.

**Tech Stack:** Node.js built-in `http` server, TerminusDB HTTP API, plain HTML/CSS/JS, Node test runner, Playwright

---

## File Map

- Modify: `server.js`
  - add reserved-document read/write helpers
  - add `/api/chat/context`, `/api/chat/history`, `/api/chat/send`, `/chat-with-secrets`
  - keep existing list-manager routes stable
- Create: `chat-with-secrets.html`
  - three-tab UI
  - iframe-based `Data` tab
  - chat send flow and history loading
- Modify: `tests/fake-terminusdb.js`
  - support reserved non-`ListItem` documents used by chat tests
- Modify: `tests/server.test.js`
  - add failing server tests for reserved docs and dummy chat flow
- Create: `tests/e2e-chat-with-secrets.spec.js`
  - direct browser flow for dummy response and persisted history
- Modify: `playwright.config.js`
  - include new e2e spec
- Modify: `package.json`
  - run both e2e specs
- Modify: `README.md`
  - document new external route

### Task 1: Add Server Test Coverage For Reserved Documents And Dummy Chat

**Files:**
- Modify: `tests/fake-terminusdb.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Write a failing test for reading chat context**

```javascript
test('GET /api/chat/context returns nested reserved context JSON', async () => {
  const res = await fetch(`${appUrl}/api/chat/context`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.context_all_reserved.id, 'context_all_reserved');
  assert.equal(body.context_all_reserved.children[0].id, 'context_child_a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server.test.js --test-name-pattern "GET /api/chat/context returns nested reserved context JSON"`

Expected: FAIL with `404` or `not found` because route/helper does not exist yet.

- [ ] **Step 3: Write a failing test for dummy send flow and saved history**

```javascript
test('POST /api/chat/send stores request and dummy response in reserved history', async () => {
  const sendRes = await fetch(`${appUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello secrets' }),
  });
  const sendBody = await sendRes.json();

  const historyRes = await fetch(`${appUrl}/api/chat/history`);
  const historyBody = await historyRes.json();

  assert.equal(sendRes.status, 200);
  assert.equal(sendBody.ok, true);
  assert.match(sendBody.response, /dummy/i);
  assert.equal(historyBody.entries.at(-1).user_request, 'Hello secrets');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/server.test.js --test-name-pattern "POST /api/chat/send stores request and dummy response in reserved history"`

Expected: FAIL because route/storage does not exist yet.

- [ ] **Step 5: Extend fake TerminusDB to seed and persist reserved docs**

```javascript
const RESERVED_DOCS = {
  context_all_reserved: {
    '@id': 'ChatDoc/context_all_reserved',
    '@type': 'ChatDoc',
    docId: 'context_all_reserved',
    body: {
      id: 'context_all_reserved',
      children: [{ id: 'context_child_a', value: 'alpha', children: [] }],
    },
  },
  settings_reserved: {
    '@id': 'ChatDoc/settings_reserved',
    '@type': 'ChatDoc',
    docId: 'settings_reserved',
    body: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      api_token: 'test-token',
    },
  },
  answers_reserved: {
    '@id': 'ChatDoc/answers_reserved',
    '@type': 'ChatDoc',
    docId: 'answers_reserved',
    body: { entries: [] },
  },
};
```

- [ ] **Step 6: Re-run the new tests and keep them failing only on app behavior**

Run: `npm run test:server -- --test-name-pattern "api/chat"`

Expected: fake DB understands reserved docs, but server tests still fail on missing app routes.

- [ ] **Step 7: Commit**

```bash
git add tests/fake-terminusdb.js tests/server.test.js
git commit -m "test: add chat reserved document coverage"
```

### Task 2: Implement Reserved-Document Helpers And Chat API

**Files:**
- Modify: `server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Implement minimal reserved-document helpers**

```javascript
async function getReservedDoc(docId) {
  const apiPath = `/api/document/${dbPath()}/${encodeURIComponent('ChatDoc')}/${encodeURIComponent(docId)}`;
  const { status, body } = await terminusReq('GET', apiPath);
  if (status !== 200 || !body) throw new Error(`${docId} not found`);
  return body;
}

async function writeReservedDoc(docId, body) {
  const doc = {
    '@type': 'ChatDoc',
    '@id': `ChatDoc/${docId}`,
    docId,
    body,
  };
  const { status } = await terminusReq(
    'POST',
    withCommitMeta(`/api/document/${dbPath()}`, `write ${docId}`),
    [doc]
  );
  if (status !== 200 && status !== 201) throw new Error(`failed to write ${docId}`);
}
```

- [ ] **Step 2: Add context/history/send handlers**

```javascript
async function serveChatContext(res) {
  const contextDoc = await getReservedDoc('context_all_reserved');
  sendJson(res, 200, contextDoc.body, { 'Cache-Control': 'no-store' });
}

async function handleChatSend(req, res) {
  const body = await readJsonBody(req);
  requireNonEmptyString(body?.message, 'message');
  const contextDoc = await getReservedDoc('context_all_reserved');
  const settingsDoc = await getReservedDoc('settings_reserved');
  const answersDoc = await getReservedDoc('answers_reserved');
  const responseText = buildDummyResponse(body.message, contextDoc.body, settingsDoc.body);
  const saved = { created_at: new Date().toISOString(), user_request: body.message, model_response: responseText };
  await writeReservedDoc('answers_reserved', { entries: [...answersDoc.body.entries, saved] });
  sendJson(res, 200, { ok: true, response: responseText, saved }, { 'Cache-Control': 'no-store' });
}
```

- [ ] **Step 3: Wire new routes without touching existing list-manager routes**

```javascript
if (req.method === 'GET' && url.pathname === '/api/chat/context') { ... }
if (req.method === 'GET' && url.pathname === '/api/chat/history') { ... }
if (req.method === 'POST' && url.pathname === '/api/chat/send') { ... }
if (req.method === 'GET' && url.pathname === '/chat-with-secrets') { ... }
```

- [ ] **Step 4: Run targeted server tests to verify green**

Run: `npm run test:server -- --test-name-pattern "api/chat"`

Expected: PASS for new chat tests.

- [ ] **Step 5: Run full server suite**

Run: `npm run test:server`

Expected: PASS, including existing list-manager tests.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/server.test.js tests/fake-terminusdb.js
git commit -m "feat: add reserved-document chat api"
```

### Task 3: Add `/chat-with-secrets` Frontend

**Files:**
- Create: `chat-with-secrets.html`
- Modify: `server.js`

- [ ] **Step 1: Write a failing browser test for dummy response and reload persistence**

```javascript
test('chat-with-secrets shows dummy response in history after reload', async ({ page }) => {
  await page.goto('/chat-with-secrets');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByPlaceholder('Ask the database context').fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/dummy/i)).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('hello')).toBeVisible();
  await page.reload();
  await expect(page.getByText('hello')).toBeVisible();
});
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npx playwright test tests/e2e-chat-with-secrets.spec.js`

Expected: FAIL because page and tabs do not exist yet.

- [ ] **Step 3: Implement the new standalone page**

```html
<main class="shell">
  <nav class="tabs">
    <button data-tab="data">Data</button>
    <button data-tab="chat">Chat</button>
    <button data-tab="history">History</button>
  </nav>
  <section data-panel="data"><iframe src="/"></iframe></section>
  <section data-panel="chat">...</section>
  <section data-panel="history">...</section>
</main>
```

- [ ] **Step 4: Add minimal client logic for tabs, send, and history reload**

```javascript
async function sendMessage() {
  const res = await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  const body = await res.json();
  renderCurrentResponse(body.saved);
  await loadHistory();
}
```

- [ ] **Step 5: Re-run the new browser test**

Run: `npx playwright test tests/e2e-chat-with-secrets.spec.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add chat-with-secrets.html tests/e2e-chat-with-secrets.spec.js server.js
git commit -m "feat: add chat with secrets frontend"
```

### Task 4: Integrate Test Runner And Documentation

**Files:**
- Modify: `playwright.config.js`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Include the new e2e spec in the test command**

```json
{
  "scripts": {
    "test:e2e": "playwright test tests/e2e-roundtrip.spec.js tests/e2e-chat-with-secrets.spec.js"
  }
}
```

- [ ] **Step 2: Document the new route briefly**

```md
- `https://viewterminus.smileme.ai/chat-with-secrets` exposes the dummy-backed chat UI with History persisted in TerminusDB reserved docs.
```

- [ ] **Step 3: Run the full automated suite**

Run: `npm test`

Expected: PASS with server tests and both Playwright specs.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.js package.json README.md tests/e2e-chat-with-secrets.spec.js
git commit -m "test: wire chat with secrets checks"
```

### Task 5: Host Verification And Public Route Check

**Files:**
- Modify if needed: host launchd/service files outside repo only after backup

- [ ] **Step 1: Start the app on its expected local port**

Run: `PORT=4312 node server.js`

Expected: server listens on `http://127.0.0.1:4312`.

- [ ] **Step 2: Verify the public route locally through the origin**

Run: `curl -I http://127.0.0.1:4312/chat-with-secrets`

Expected: `200 OK`.

- [ ] **Step 3: Verify the external route through Cloudflare**

Run: `curl -I https://viewterminus.smileme.ai/chat-with-secrets`

Expected: `200 OK`.

- [ ] **Step 4: Manually check the new page in a browser**

Open: `https://viewterminus.smileme.ai/chat-with-secrets`

Confirm:
- `Data` tab renders the existing UI
- `Chat` tab sends a message
- `History` tab shows the saved pair

- [ ] **Step 5: Final status summary must include the clickable frontend URL**

```md
[Chat With Secrets](https://viewterminus.smileme.ai/chat-with-secrets)
```
