# SearchMyData — Frontend integration guide

Frontend state stays local-first and syncs to the server with a queued same-origin helper.
The browser must not call TerminusDB directly.

## Runtime rules

- `list-data.js` is loaded as a plain `<script>` and must expose mutable `let items` / `let nextId`
- `sendAction(type, data)` posts only to `/api/action`
- action posts are queued through `pendingActions` so tests can wait for all writes to finish
- errors are ignored in the browser because local UI state is already applied
- `saveUndoSnapshot()` must run before every local mutation, not only before drag

## Mutations that sync

- add root item -> `add_item`
- add nested item -> `add_item`
- edit item -> `edit_item`
- delete item -> `delete_item`
- toggle tag -> `toggle_tag`
- collapse/expand -> `toggle_collapse`
- drag reorder / reparent -> `reorder`
- undo button -> `Undo`

## Browser test hooks

The page exposes `window.__searchMyDataTest` with:

- `getItems()`
- `getNextId()`
- `waitForSync()`
- `checkDocumentAgainstServer()`

Roundtrip tests must wait for `pendingActions` before comparing browser state with `/api/document-check`.

## Constraints

- no `import` statements
- no TerminusDB calls from the browser
- no API contract changes without owner approval
