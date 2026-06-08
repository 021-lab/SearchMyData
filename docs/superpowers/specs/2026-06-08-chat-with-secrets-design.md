# Chat With Secrets Design

Date: 2026-06-08
Repo: `SearchMyData`
Branch: `secrets-chat-gatekeeper`

## Goal

Add a new externally reachable page at `/chat-with-secrets` that uses the existing
server as a backend, reads chat context from TerminusDB documents, calls a model
using settings stored in TerminusDB, and stores request/response history back in
TerminusDB.

The existing data-management UI must remain available and its code must not be
modified as part of this feature.

## Scope

In scope:

- new chat page route: `/chat-with-secrets`
- three-tab frontend: `Data`, `Chat`, `History`
- TerminusDB-backed reserved documents for chat context, chat settings, and chat history
- server-side model invocation using settings loaded from the database
- dummy-response mode for initial test coverage
- external availability at `https://viewterminus.smileme.ai/chat-with-secrets`

Out of scope:

- search
- multi-session chat
- per-user settings
- browser-direct model calls
- editing the existing `Data` tab code path

## Reserved Documents

The feature uses three reserved logical documents in the same database.

### `context_all_reserved`

Purpose:

- source of truth for model context

Behavior:

- stores a tree of documents/items already managed by the existing data system
- on each chat request, the server reads this document and all nested children
- the server serializes that structure into one nested JSON payload
- the server appends the current user request as a sibling field:

```json
{
  "context_all_reserved": { "...nested context..." : true },
  "user_request": "..."
}
```

### `settings_reserved`

Purpose:

- global model settings for the whole database

Shape:

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "api_token": "sk-..."
}
```

Rules:

- exactly one global settings document is used
- server reads this document on every chat request
- the document must exist and be editable in the database
- the initial shape must be OpenAI-compatible so OpenRouter or OpenAI-style
  endpoints can be supported server-side

### `answers_reserved`

Purpose:

- append-only chat history store

Each saved exchange is stored as a pair:

```json
{
  "created_at": "2026-06-08T20:00:00.000Z",
  "user_request": "Summarize the context",
  "model_response": "Dummy answer"
}
```

Rules:

- saved in the same database
- shown verbatim in the `History` tab
- page reload must reload history from this reserved document

## Request Flow

For each user message:

1. Browser posts the message to `POST /api/chat/send`.
2. Server loads `context_all_reserved`.
3. Server converts the current nested context into JSON.
4. Server adds `{ "user_request": "<message>" }`.
5. Server loads `settings_reserved`.
6. Server calls the configured model using server-side credentials.
7. Server saves `{ user_request, model_response, created_at }` into `answers_reserved`.
8. Server returns the response payload to the browser.
9. Browser renders the response immediately and history reload continues to come from the server.

## Dummy Mode

The first acceptance test only requires a dummy model response.

Dummy mode behavior:

- enabled by explicit server configuration
- skips external model call
- generates a deterministic placeholder response
- still writes the request/response pair into `answers_reserved`
- must be indistinguishable from a real response at the UI and history layer

This keeps the storage contract stable while model integration is still being
validated.

## API Design

New endpoints:

- `GET /api/chat/context`
  - returns the nested JSON built from `context_all_reserved`
- `GET /api/chat/history`
  - returns the saved request/response array from `answers_reserved`
- `POST /api/chat/send`
  - input: `{ "message": "..." }`
  - output: `{ "ok": true, "response": "...", "saved": { ... } }`

Existing endpoints stay unchanged:

- `/document`
- `/list-data.js`
- `/api/document-check`
- `/api/action`

## Frontend Design

Route:

- `/chat-with-secrets`

Layout:

- single page
- top-level tab strip with `Data`, `Chat`, `History`

### `Data` tab

Requirement:

- must preserve the existing data-management frontend behavior
- do not modify that code

Implementation choice:

- embed the existing `list-manager.html` in an `iframe`

Reason:

- gives exact code isolation
- avoids regression risk in the already working data UI
- keeps one public entry point while respecting the "do not touch code" requirement

### `Chat` tab

Elements:

- chat transcript area for the current page session
- textarea or single-line input
- send button
- loading state while request is in flight

Behavior:

- user sends a message
- frontend calls `POST /api/chat/send`
- response is displayed in the chat tab
- the tab does not need search, threads, or model selection

### `History` tab

Elements:

- chronological list of saved request/response pairs
- timestamp per entry

Behavior:

- data is loaded from `GET /api/chat/history`
- reload always re-fetches from the server
- test passes when the dummy answer appears in this history view

## Error Handling

Server:

- if `context_all_reserved` is missing, return a clear JSON error
- if `settings_reserved` is missing or malformed, return a clear JSON error
- if `answers_reserved` cannot be written, treat the request as failed
- in dummy mode, no external model error path is needed

Frontend:

- show failed send state inline in the `Chat` tab
- do not silently fake success
- keep `History` authoritative from server reads

## Testing Strategy

### Server tests

- builds nested context JSON from `context_all_reserved`
- loads global model settings from `settings_reserved`
- writes request/response pairs into `answers_reserved`
- returns dummy response when dummy mode is enabled

### Browser E2E

Target:

- `http://127.0.0.1:3000/chat-with-secrets`

Flow:

1. Open `/chat-with-secrets`.
2. Switch to `Chat`.
3. Send a test message.
4. Confirm dummy response is shown.
5. Switch to `History`.
6. Confirm the saved request/response pair is shown.
7. Reload the page.
8. Confirm `History` still shows the same saved pair from the server.

### External verification

Final public URL:

- `https://viewterminus.smileme.ai/chat-with-secrets`

After deployment, verify:

- page opens externally
- `Data` tab loads
- `Chat` tab can submit
- dummy response appears
- `History` shows the saved pair after reload

## Delivery Notes

- Always present the final frontend as a clickable link.
- Prefer modular server additions so the existing list-manager paths stay stable.
- Do not change the behavior of the existing `Data` page while adding the new route.
