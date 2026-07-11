# Universal Nested List Interface Design

## Goal

Create a universal nested-list management interface that can connect to any backend.

The interface loads list state from a backend adapter, accepts user input, turns that input into semantic commands, asks an interpreter to produce state patches, applies those patches to local storage, renders the updated page, and syncs the local state back to an arbitrary backend through an adapter.

The first implementation must preserve the current visual interface and touch behavior of `list-manager.html`: tap, long press, drag reorder/nest, right swipe command panel, left swipe tag panel, modals, collapse, tags, and undo. PTT and the PTT debug block are removed from the product scope.

## Non-Negotiable UI Constraint

The existing touch and drag mechanics are a user-facing contract. The refactor must not redesign the gestures or change their feel.

The current gesture code may be reorganized, but the geometry-sensitive parts should be moved with minimal edits:

- horizontal swipe threshold behavior stays the same;
- long-press drag start stays the same;
- drag group movement stays the same;
- right-panel and left-panel vertical selection stays the same;
- modal focus behavior stays compatible with mobile browsers;
- current list item layout remains recognizable.

## Core Architecture

The system is split into modules with strict responsibility boundaries:

- `list-app.js`: application controller. It wires UI, interpreter, store, renderer, sync, and adapter together.
- `list-ui.js`: reads user input and gestures, then emits semantic input commands. It does not mutate list state.
- `list-interpreter.js`: receives semantic commands and current state, then returns JSON Patch operations and action-log entries.
- `list-store.js`: owns local persistence in `localStorage`, applies JSON Patch operations, and stores the snapshot plus action log.
- `list-renderer.js`: renders the page from the current snapshot and action log. It assigns `act-id` attributes to all active DOM elements.
- `list-sync.js`: performs local-first sync using the backend adapter.
- `list-backend-adapter.js`: backend boundary for `load()` and `save(state)`.
- `list-data.js`: demo seed/adapter data used when local storage is empty.

The first implementation uses browser ES modules and remains deployable as static HTML through GitHub/htmlpreview.

## Data Model

The nested list is stored as a flat list with parent references and explicit sibling order.

```js
{
  snapshot: {
    items: [
      {
        id: "a7k2p",
        parentId: null,
        order: 10,
        status: "Open",
        line1: "Task title",
        line2: "Optional detail",
        collapsed: false,
        tags: []
      }
    ]
  },
  actionLog: [
    {
      id: "h4m8q",
      createdAt: "2026-07-11T00:00:00.000Z",
      command: {
        type: "setStatus",
        actId: "a7k2p",
        payload: { "status": "Done" }
      },
      patch: [
        { "op": "replace", "path": "/snapshot/items/0/status", "value": "Done" }
      ],
      label: "Status changed to Done",
      syncStatus: "pending"
    }
  ]
}
```

`nextId` is not used. New tasks receive a random 5-character id. The first version should avoid collisions by retrying generation while the id already exists in the current snapshot.

Valid task statuses:

- `Open`
- `Done`
- `Focus`
- `Archive`
- `Pause`

New tasks default to `Open`.

## `act-id`

`act-id` is the DOM/context identifier used by the UI contract. It is not a separate data field in the snapshot.

For task elements, `act-id` is the task id:

```html
<div data-act-id="a7k2p" data-act-type="task">
```

The renderer derives `data-act-id` from the snapshot and adds it to every active DOM element, including list rows, command-panel items, tag-panel items, modal controls, and global controls.

Examples:

```html
<div class="list-item-wrapper" data-act-id="a7k2p" data-act-type="task">
<button data-act-id="a7k2p" data-command="toggleCollapse">
<button data-act-id="a7k2p" data-command="setStatus" data-status="Done">
<button data-act-id="list" data-act-type="list" data-command="addItem">
<button data-act-id="actionLog" data-act-type="panel" data-command="showActionLog">
```

This makes the UI extensible without editing the HTML page for every new command. The renderer can add declarative command metadata, while a single input-dispatch function translates user interaction into interpreter commands.

## User Input Contract

All user input goes through one dispatch boundary:

```js
dispatchUserInput({
  actId,
  actType,
  command,
  payload,
  source,
  rawEventMeta
});
```

The UI module must not directly mutate `items`, call `render()` after business changes, or edit local storage. It only recognizes input and sends commands.

Examples:

```js
dispatchUserInput({
  actId: "a7k2p",
  actType: "task",
  command: "setStatus",
  payload: { status: "Done" },
  source: "right-swipe-panel"
});
```

```js
dispatchUserInput({
  actId: "a7k2p",
  actType: "task",
  command: "editItem",
  payload: { line1: "Updated title", line2: "Updated detail" },
  source: "modal-confirm"
});
```

```js
dispatchUserInput({
  actId: "list",
  actType: "list",
  command: "addItem",
  payload: { line1: "New task", line2: "" },
  source: "add-button"
});
```

## Commands

Initial command set:

- `addItem`
- `addChild`
- `editItem`
- `deleteItem`
- `moveItem`
- `toggleCollapse`
- `setTags`
- `setStatus`
- `undo`
- `showList`
- `showActionLog`

The right swipe command panel includes the existing commands and status commands:

- `Nested`
- `View`
- `Edit`
- `Delete`
- `Open`
- `Done`
- `Focus`
- `Archive`
- `Pause`

The left swipe tag panel keeps its current behavior, but tag changes are emitted as commands instead of mutating the item directly.

## Interpreter Contract

The interpreter receives:

- current app state;
- the semantic command from `dispatchUserInput`;
- optional input metadata that helps preserve existing drag behavior.

It returns:

```js
{
  patch: [
    { op: "replace", path: "/snapshot/items/0/status", value: "Done" }
  ],
  actionLogEntry: {
    id: "h4m8q",
    createdAt: "...",
    command,
    patch,
    label: "Status changed to Done",
    syncStatus: "pending"
  }
}
```

The chosen patch format is JSON Patch.

The first version renders from state after applying patches. It does not need real DOM patch operations.

## Store Contract

The store persists the whole app document in one localStorage key, because the action log is a visible part of the application:

```js
{
  snapshot,
  actionLog
}
```

Store responsibilities:

- load app state from localStorage;
- seed from `list-data.js` if localStorage is empty;
- apply JSON Patch operations;
- append action-log entries;
- save the app document back to localStorage;
- expose read-only current state to app/controller.

The store must not know about DOM details.

## Renderer Contract

The renderer receives current app state and renders:

- the nested list, reconstructed from flat `items` using `parentId` and `order`;
- item status badges on the right side of each row;
- the existing action panels and tag panels;
- the action-log tab/panel;
- active DOM attributes such as `data-act-id`, `data-act-type`, and `data-command`.

Rendering may fully rebuild the list after every state patch in the first version.

The renderer is responsible for deriving hierarchy for display only. It does not own business mutation logic.

## Sync Contract

Sync is local-first:

1. User command is applied locally.
2. UI is re-rendered from local state.
3. Sync saves the current app document to the backend adapter.

The first backend adapter contract is snapshot-based:

```js
adapter.load();
adapter.save(state);
```

Conflict policy for the first version is last write wins.

The action log shows sync state to the user through `syncStatus`, for example:

- `pending`
- `synced`
- `failed`

## Preserving Current Drag And Swipe Behavior

The safest refactor path is to keep the current gesture recognizers intact and change their outputs.

Today, `bindGesture(el, actionBg, itemId, wrapper)` recognizes tap, swipe, long press, drag, right-panel selection, and left-panel tag selection. The refactor keeps this responsibility but replaces direct mutation calls with `dispatchUserInput`.

Examples of replacements:

- `toggleCollapse(itemId)` becomes `dispatchUserInput({ actId, command: "toggleCollapse" })`.
- `execDrop(action, itemId, wrapper)` becomes a command dispatch derived from the selected action.
- `execTag(tag, itemId)` becomes `dispatchUserInput({ actId, command: "setTags", payload })`.
- modal confirm becomes `dispatchUserInput({ actId, command: "editItem" | "addItem" | "addChild", payload })`.
- drag finalization sends a `moveItem` command after reading the final DOM order and intended parent/order.

The current drag math can still use DOM wrappers during the gesture. The difference is that the committed result is interpreted through the command contract.

## Action Log UI

The application includes a separate action-log tab/panel.

Each log entry should show:

- time;
- command label;
- affected `act-id`;
- sync status;
- optional technical details for JSON Patch.

The log is part of the app document and is saved with the snapshot.

## Cross-Module Test With Mock UI

The critical end-to-end test replaces the real UI module with a mock UI and verifies all non-UI modules together.

Purpose: prove that the interpreter, store, renderer boundary, sync module, and backend adapter work without depending on touch events or DOM gesture code.

Test setup:

1. Start with an empty localStorage test namespace.
2. Use the demo seed adapter to initialize state.
3. Replace `list-ui.js` with a mock emitter that calls `dispatchUserInput` directly.
4. Use a mock backend adapter with in-memory `load()` and `save(state)` methods.
5. Use a renderer spy that records the state it was asked to render.

Test flow:

```js
mockUi.emit({
  actId: "list",
  actType: "list",
  command: "addItem",
  payload: { line1: "Mock task", line2: "Created by test" },
  source: "mock-ui"
});

mockUi.emit({
  actId: newlyCreatedTaskId,
  actType: "task",
  command: "setStatus",
  payload: { status: "Focus" },
  source: "mock-ui"
});

mockUi.emit({
  actId: newlyCreatedTaskId,
  actType: "task",
  command: "addChild",
  payload: { line1: "Child task" },
  source: "mock-ui"
});
```

Expected assertions:

- store state contains a flat `snapshot.items` array;
- newly created ids are 5 characters long;
- new items default to `Open` unless a command changes status;
- `setStatus` updates the task to `Focus`;
- child task has `parentId` equal to the parent task id;
- sibling order is represented by `order`;
- every command creates a JSON Patch entry;
- every command appends an action-log entry;
- renderer is called after each applied command with updated state;
- sync adapter `save(state)` receives the same app document shape `{ snapshot, actionLog }`;
- no test step imports or calls the real UI gesture handlers.

This test proves that the backend-ready application core works when the real UI is swapped out. Separate browser/UAT checks still verify that the preserved touch and drag UI dispatches the same commands.

## Acceptance Criteria

- Current list UI remains visually and behaviorally recognizable.
- PTT and PTT debug UI are removed.
- Data is flat with `parentId` and `order`.
- No `nextId` remains.
- New ids are random 5-character ids.
- Tasks support `Open`, `Done`, `Focus`, `Archive`, and `Pause`.
- Right swipe panel can set task status.
- Status appears as a compact badge on each list item.
- All user input flows through `dispatchUserInput`.
- Renderer assigns `data-act-id` and command metadata to active DOM elements.
- UI module does not mutate business state directly.
- Interpreter returns JSON Patch and action-log entries.
- Store persists `{ snapshot, actionLog }`.
- Sync is local-first and uses `adapter.load()` / `adapter.save(state)`.
- Cross-module mock UI test passes for the non-UI application core.

