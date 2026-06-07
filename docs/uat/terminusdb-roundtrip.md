# Remote TerminusDB Roundtrip UAT

## Preconditions

- server starts on `http://127.0.0.1:3000`
- `.env` points to the remote TerminusDB API
- `TERMINUS_PASS` stays only in `.env`
- `curl http://127.0.0.1:3000/document` returns HTTP 200 and JSON with `items`

## Start

Run:

```bash
PORT=3000 node server.js
```

Then verify:

```bash
curl -sS http://127.0.0.1:3000/document | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); if(!Array.isArray(j.items)) process.exit(1); console.log(j.items.length)})"
```

Expected: a positive item count.

## Browser UAT

Open `http://127.0.0.1:3000/` directly. Do not use `file://` for this check.

Confirm that the page initially renders all database items as a nested list, then perform:

1. Add a root item.
2. Add a nested item.
3. View an item.
4. Edit an item.
5. Delete an item.
6. Add a tag.
7. Remove the same tag.
8. Collapse a parent.
9. Expand the same parent.
10. Reorder an item by drag.
11. Nest an item by drag with right shift.
12. Use Undo.

## Console verification

Run in DevTools:

```javascript
await window.__searchMyDataTest.waitForSync();
await window.__searchMyDataTest.checkDocumentAgainstServer();
```

Expected:

```javascript
{ ok: true, browser: [...], server: [...] }
```

## Reload verification

Reload the page, then run the same console check again:

```javascript
await window.__searchMyDataTest.waitForSync();
await window.__searchMyDataTest.checkDocumentAgainstServer();
```

Expected: `ok: true` again. The test passes only if the final browser document
matches a fresh server load before and after page reload.
