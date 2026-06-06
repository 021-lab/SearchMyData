# SearchMyData — API Surface (source of truth)

> **This file is the contract between the frontend and server coders.**
> Neither coder may change it unilaterally.
> If your implementation needs a change here, stop and escalate to the project owner.

---

## Base URL

```
http://localhost:3000
```

---

## GET /document

Returns a document and its full descendant tree as nested JSON — the same shape
the frontend natively renders as a nested list.

**Request**

```
GET /document
GET /document?id=<documentId>
```

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | no | Identifies which document to fetch. When omitted, the server returns the default document — the one named `list-data.js` (see below). |

**Response**

```json
{
  "id": "list-data.js",
  "nextId": 33,
  "items": [
    {
      "id": 1,
      "line1": "Молоко 3.2%",
      "line2": "2 пакета",
      "tags": ["Важное"],
      "collapsed": false,
      "children": []
    },
    {
      "id": 2,
      "line1": "Хлеб ржаной",
      "children": [
        { "id": 26, "line1": "Бородинский", "line2": "400 г", "children": [] },
        { "id": 27, "line1": "Столичный",   "line2": "500 г", "children": [] }
      ]
    }
  ]
}
```

Rules:
- `nextId` — integer, equals max item `id` across the returned tree + 1
- Every item has `id` (integer), `line1` (string), `children` (array, may be empty)
- Optional fields omitted when absent: `line2`, `tags`, `collapsed`
- Children sorted by their position under their parent; root items sorted by their position
- If `id` does not match any document, respond `{ "ok": false, "error": "document not found" }`

---

## GET /list-data.js

The default-document case of `GET /document`, served as an executable JavaScript
file so the page can keep loading it as a `<script>` tag with **no change to the
data-loading code**:

**Response**

```
Content-Type: application/javascript
```

```javascript
/* auto-generated — do not edit */
const nextId = 33;
const items = [ /* same nested shape as GET /document */ ];
```

Rules:
- Same lookup, ordering, and field rules as `GET /document` (defaulting to the
  document named `list-data.js`)
- If the database is unreachable, serve the static `list-data.js` file from disk unchanged

---

## GET /api/document-check

Lets the frontend verify that its local copy of the document tree matches the
server's current state, and surface drift to the user — e.g. from a missed
`sendAction` call or a concurrent edit made elsewhere — instead of silently
trusting local state.

**Request**

```
GET /api/document-check?id=<documentId>
```

`id` is optional, same default as `GET /document`.

**Response**

```json
{
  "id": "list-data.js",
  "nextId": 33,
  "items": [ /* the server's current tree, same nested shape as GET /document */ ]
}
```

The frontend compares this tree against its local `items`/`nextId` and, on any
discrepancy, shows the difference to the user (e.g. a diff view) rather than
overwriting local state automatically.

---

## POST /api/action

Single endpoint for all user mutations.

**Request**

```
Content-Type: application/json
```

```json
{ "type": "<action_type>", "data": { ... } }
```

**Success response** (HTTP 200) — same shape for every action, including `Undo`:

```json
{ "ok": true }
```

**Error response** (HTTP 200, `ok: false`)

```json
{ "ok": false, "error": "human-readable message" }
```

---

### Action types

#### `add_item`

Add a new root-level item or a child item.

```json
{
  "type": "add_item",
  "data": {
    "id":       33,
    "line1":    "Сахар",
    "line2":    "1 кг",
    "parentId": null
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | yes | browser-assigned, equals `nextId` at time of creation |
| `line1` | string | yes | non-empty |
| `line2` | string | no | omit if empty |
| `parentId` | integer \| null | yes | `null` for root; parent's `id` for child |

---

#### `edit_item`

Replace `line1` and/or `line2` of an existing item.

```json
{
  "type": "edit_item",
  "data": {
    "id":    26,
    "line1": "Бородинский 400 г",
    "line2": "600 г"
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | yes | |
| `line1` | string | yes | non-empty |
| `line2` | string | no | omit to clear the field |

---

#### `delete_item`

Delete an item and all its descendants.

```json
{
  "type": "delete_item",
  "data": {
    "id": 10
  }
}
```

| Field | Type | Required |
|-------|------|----------|
| `id` | integer | yes |

Server is responsible for finding and deleting all descendant items.

---

#### `toggle_tag`

Add the tag if the item does not have it; remove it if it does.

```json
{
  "type": "toggle_tag",
  "data": {
    "id":  1,
    "tag": "Срочно"
  }
}
```

| Field | Type | Required |
|-------|------|----------|
| `id` | integer | yes |
| `tag` | string | yes |

---

#### `toggle_collapse`

Toggle the `collapsed` state of an item that has children.

```json
{
  "type": "toggle_collapse",
  "data": {
    "id": 2
  }
}
```

| Field | Type | Required |
|-------|------|----------|
| `id` | integer | yes |

---

#### `reorder`

Provide the complete new ordering of all items as a flat list with parent assignments.

```json
{
  "type": "reorder",
  "data": {
    "flat": [
      { "id": 10, "parentId": null, "position": 0 },
      { "id": 2,  "parentId": null, "position": 1 },
      { "id": 26, "parentId": 2,    "position": 0 },
      { "id": 27, "parentId": 2,    "position": 1 },
      { "id": 1,  "parentId": null, "position": 2 }
    ]
  }
}
```

`flat` contains every item in the tree. `position` is the zero-based index within the parent (or at root level). `parentId` is `null` for root items.

Server applies only the items whose position or parentId changed.

---

#### `Undo`

Roll back the most recent mutation. Like every other action, the frontend has
already reverted the mutation locally (from its own saved snapshot) before
sending this — the server doesn't need to, and the frontend doesn't wait for it
to, return a fresh tree.

```json
{
  "type": "Undo",
  "data": {}
}
```

**Response** — same generic shape as every other action:

```json
{ "ok": true }
```

If there is nothing to undo:

```json
{ "ok": false, "error": "nothing to undo" }
```
