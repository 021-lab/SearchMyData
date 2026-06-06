# SearchMyData — Frontend integration guide

> **For the frontend coder.**
> API contract: see `API.md`. Do not change `API.md`; escalate to project owner if needed.
> Do not add any TerminusDB logic to the browser.

---

## What to do

Add server sync to `list-manager.html` with the smallest possible diff:
1. One global helper `sendAction(type, data)` — fires a POST to `/api/action` and ignores errors
2. One `sendAction()` call at the end of each mutation function
3. One `sendAction()` call at the end of the undo button handler — same rule as #2

The page already loads `list-data.js` as a `<script>` tag — the server will start serving
that file dynamically from the database. **No change needed to the data-loading code.**

---

## 1. Add the `sendAction` helper

Add this function once, anywhere before it is called (e.g. just before the `render()` call):

```javascript
function sendAction(type, data) {
  fetch('/api/action', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, data: data || {} })
  }).catch(() => {}); // silent — local state is already applied
}
```

---

## 2. Append one call to each mutation

Add the `sendAction(...)` call at the very end of each code block listed below,
**after** all existing logic. Do not move or modify existing code.

### `confirmModal()` — mode `'add'`

Existing last lines (around line 833):
```javascript
    items.push({ id: nextId++, line1: l1, line2: l2 || undefined });
    render();
    closeModal();
    showToast('Элемент добавлен');
```

Add after `showToast(...)`:
```javascript
    sendAction('add_item', { id: nextId - 1, line1: l1, line2: l2 || undefined, parentId: null });
```

---

### `confirmModal()` — mode `'nest'`

Existing last lines (around line 830):
```javascript
    render();
    closeModal();
    showToast('Добавлен вложенный');
```

Add after `showToast(...)`:
```javascript
    sendAction('add_item', { id: nextId - 1, line1: l1, line2: l2 || undefined, parentId: modalTargetId });
```

---

### `confirmModal()` — mode `'edit'`

Existing last lines (around line 822):
```javascript
    render();
    closeModal();
    showToast('Сохранено');
```

Add after `showToast(...)`:
```javascript
    sendAction('edit_item', { id: modalTargetId, line1: l1, line2: l2 || undefined });
```

---

### `doDelete()` — inside the `setTimeout` callback

Existing last lines inside `setTimeout` (around line 722):
```javascript
    removeFromTree(itemId);
    render();
    showToast('Элемент удалён');
```

Add after `showToast(...)`:
```javascript
    sendAction('delete_item', { id: itemId });
```

---

### `execTag()`

Existing last line (around line 564):
```javascript
  render();
```

Add after `render()`:
```javascript
  sendAction('toggle_tag', { id: itemId, tag });
```

---

### `toggleCollapse()`

Existing last line (around line 196):
```javascript
  render();
```

Add after `render()`:
```javascript
  sendAction('toggle_collapse', { id: itemId });
```

---

### `finalizeDrag()` — inside the `setTimeout` callback, after `buildTree`

Existing last lines inside `setTimeout` (around line 481):
```javascript
    items = buildTree(flatList);
    render();
```

Add after `render()`:
```javascript
    sendAction('reorder', {
      flat: (function() {
        const result = [];
        function walk(arr, parentId) {
          arr.forEach((item, idx) => {
            result.push({ id: item.id, parentId: parentId, position: idx });
            if (item.children?.length) walk(item.children, item.id);
          });
        }
        walk(items, null);
        return result;
      })()
    });
```

---

## 3. Add a `sendAction` call to the undo button handler

Undo follows the **same rule as every other mutation**: the front applies the
change locally from its own saved data, then fires a sync message to the server.
No special server round-trip, no waiting for or trusting a server-returned tree —
that would make undo inconsistent with `add_item`/`edit_item`/etc. and add a
visible delay to what should be an instant local action.

Find the existing handler (around line 178):

```javascript
undoBtn.addEventListener('click', () => {
  if (!undoSnapshot) return;
  items = undoSnapshot;
  undoSnapshot = null;
  render();
  undoBtn.disabled = true;
  showToast('Отменено');
});
```

Add one `sendAction(...)` call at the end, exactly like step 2 above:

```javascript
undoBtn.addEventListener('click', () => {
  if (!undoSnapshot) return;
  items = undoSnapshot;
  undoSnapshot = null;
  render();
  undoBtn.disabled = true;
  showToast('Отменено');
  sendAction('Undo', {});
});
```

---

## Testing checklist

- [ ] Add an item → refresh page → item still present
- [ ] Edit an item → refresh → change persists
- [ ] Delete an item → refresh → item gone
- [ ] Add/remove a tag → refresh → tag persists
- [ ] Collapse/expand → refresh → state persists
- [ ] Drag to reorder → refresh → order persists
- [ ] Undo after add → item removed both locally and after refresh
- [ ] Server offline → all local mutations still work; no JS error thrown

---

## Constraints

- Do **not** add any `import` statements or external scripts
- Do **not** call TerminusDB endpoints directly
- Do **not** change `API.md`; escalate to project owner if the API needs to change
