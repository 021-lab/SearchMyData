# Universal Nested List Interface Tests

## Goal

Define the cross-module test that proves the backend-ready application core works when the real UI module is replaced with a mock UI.

This document is separate from the architecture specification so implementation and verification details can evolve without making the design document noisy.

## Scope

The critical test covers every module after the UI boundary:

- app/controller dispatch path;
- interpreter;
- JSON Patch generation;
- store/localStorage boundary;
- action log;
- renderer boundary;
- sync module;
- backend adapter.

The test intentionally does not import or call the real touch/drag gesture handlers. Browser/UAT checks cover the preserved real UI separately.

## Test Setup

1. Start with an empty localStorage test namespace.
2. Use the demo seed adapter to initialize state.
3. Replace `list-ui.js` with a mock emitter that calls `dispatchUserInput` directly.
4. Use a mock backend adapter with in-memory `load()` and `save(state)` methods.
5. Use a renderer spy that records the state it was asked to render.

## Test Flow

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

## Expected Assertions

- Store state contains a flat `snapshot.items` array.
- Newly created ids are 5 characters long.
- New items default to `Open` unless a command changes status.
- `setStatus` updates the task to `Focus`.
- Child task has `parentId` equal to the parent task id.
- Sibling order is represented by `order`.
- Every command creates a JSON Patch entry.
- Every command appends an action-log entry.
- Renderer is called after each applied command with updated state.
- Renderer receives state that is ready for the current full-render list strategy.
- Sync adapter `save(state)` receives the same app document shape `{ snapshot, actionLog }`.
- No test step imports or calls the real UI gesture handlers.

## Result Proven By This Test

The test proves that the backend-ready application core works when the real UI is swapped out. It also proves that all user input can cross the same command contract without requiring the real page gesture code.

Separate browser/UAT checks must still verify that the preserved touch and drag UI dispatches the same command shapes through `dispatchUserInput`.
