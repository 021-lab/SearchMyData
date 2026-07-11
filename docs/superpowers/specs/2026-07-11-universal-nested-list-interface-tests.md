# Universal Nested List Interface Tests

## Goal

Define the deploy-first test workflow for the universal nested-list interface.

The application must always have a working GitHub htmlpreview deployment. CI must run Playwright tests against that deployed htmlpreview URL, not only against local files. The tests verify that the real rendered page updates after each user-visible list change.

## Permanent Htmlpreview Deployment

Every pushed version on the working branch must be reachable through GitHub htmlpreview:

```text
https://htmlpreview.github.io/?https://raw.githubusercontent.com/021-lab/searchmydata/<branch>/<entrypoint-html>?v=<version-hash>
```

For this branch the entrypoint is:

```text
list-manager.html
```

The preview URL must be generated from the current branch and current version hash during CI and local handoff.

## Cache-Busting Asset Rule

Each deployable version must use a random hash to prevent GitHub/htmlpreview/browser cache from serving stale components.

The hash must be applied to component file references, not only to the outer htmlpreview URL.

Example:

```html
<link rel="stylesheet" href="list-manager.css?v=r8k3p2">
<script type="module" src="list-app.js?v=r8k3p2"></script>
<script type="module" src="list-renderer.js?v=r8k3p2"></script>
```

Requirements:

- The version hash is generated per pushed/deployed version.
- The same hash is used for all component references belonging to that version.
- CI tests the exact htmlpreview URL that includes that hash.
- A stale component file must not be able to pass CI because the page accidentally loaded it from cache.

If the project later switches to hashed filenames instead of query parameters, the same rule applies:

```text
list-app.r8k3p2.js
list-renderer.r8k3p2.js
list-manager.r8k3p2.css
```

## CI Contract

CI runs Playwright against the deployed htmlpreview page.

Required CI steps:

1. Checkout the branch under test.
2. Generate or read the version hash for this build.
3. Ensure the HTML references component assets with that hash.
4. Build the htmlpreview URL for `list-manager.html`.
5. Verify raw GitHub returns `HTTP 200` for the HTML and all hashed component assets.
6. Run Playwright against the htmlpreview URL.
7. Upload Playwright traces/screenshots on failure.

The test must fail if:

- htmlpreview URL does not load;
- any component asset returns non-200;
- the page loads stale assets;
- rendered page assertions fail after a user action.

## Playwright UAT Scenarios

The CI test uses the real page and real UI behavior. It should interact with the deployed htmlpreview page as a user would.

Before each scenario:

- open the htmlpreview URL;
- clear app localStorage for the test namespace;
- reload the page so the test starts from known seed/demo state;
- wait for the list container to render.

### Scenario 1: Create Task

Steps:

1. Click the add button.
2. Fill the task title with a unique test value, for example `E2E Task <hash>`.
3. Confirm the modal.
4. Assert the rendered list contains the new task title.
5. Assert the new task has default status `Open`.
6. Assert the action-log tab/panel contains an `addItem` entry for the created task.

Expected result: the page render updates with the new top-level task.

### Scenario 2: Create Subtask

Steps:

1. Select the task created in Scenario 1.
2. Open the right swipe command panel for that task.
3. Choose the nested/subtask command.
4. Fill the subtask title with a unique test value, for example `E2E Subtask <hash>`.
5. Confirm the modal.
6. Assert the rendered list contains the subtask under the parent task.
7. Assert the subtask is visually nested relative to the parent.
8. Assert the action-log tab/panel contains an `addChild` entry.

Expected result: the page render updates with a child task whose parent is the created task.

### Scenario 3: Change Status

Steps:

1. Open the right swipe command panel for the task created in Scenario 1.
2. Choose status `Focus`.
3. Assert the rendered task row shows the `Focus` status badge.
4. Open the right swipe command panel again.
5. Choose status `Done`.
6. Assert the rendered task row shows the `Done` status badge.
7. Assert the action-log tab/panel contains `setStatus` entries for both status changes.

Expected result: each status change is visible on the rendered page immediately after the action.

## Required Render Assertions

Every user-visible mutation must be followed by a render assertion against the deployed page:

- after creating a task, the task title appears in the list;
- after creating a subtask, the subtask title appears nested under its parent;
- after changing status, the status badge text changes on the task row;
- after each mutation, the action log shows the corresponding command.

The tests must not pass by inspecting internal JavaScript state only. Internal state may be used for debugging, but pass/fail assertions must prove the rendered page shows the expected data.

## Relationship To Module Tests

The deployed Playwright tests are the required CI gate for user-visible behavior.

Module-level tests can still exist for interpreter/store/sync logic, but they are not a substitute for the deployed htmlpreview Playwright test. The deployed test is the proof that the current branch produces a working UI with fresh assets and correct rendering.

