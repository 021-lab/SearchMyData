# gmail-search

Subproject of SearchMyData. Searches Gmail across multiple Google accounts using
the [`gws` CLI](https://github.com/googleworkspace/cli) (Google Workspace CLI).

## Purpose

Given a Gmail search query, fan out to all configured accounts in parallel and
return a merged, unified result set.

## Architecture

```
gmail-search/
├── src/
│   ├── models.py       ← Immutable dataclasses: GmailAccount, GmailMessage, SearchResult
│   ├── auth.py         ← Load accounts from env vars
│   ├── connector.py    ← Thin wrapper around `gws` CLI subprocess calls
│   └── search.py       ← Multi-account parallel orchestration
└── tests/
    ├── test_models.py
    ├── test_auth.py
    ├── test_connector.py
    └── test_search.py
```

## External Dependency

Requires the `gws` CLI:
```bash
npm install -g @googleworkspace/cli
gws auth setup   # one-time GCP project setup
gws auth login   # authenticate each account
```

Credentials are stored per-account as JSON files referenced via env vars.

## Configuration

Copy `.env.example` to `.env` and fill in credential paths:

```bash
GMAIL_ACCOUNTS=work,personal
GMAIL_ACCOUNT_WORK_CREDS=/run/secrets/gmail_work_creds.json
GMAIL_ACCOUNT_PERSONAL_CREDS=/run/secrets/gmail_personal_creds.json
```

## Usage

```python
from src.search import GmailSearcher

searcher = GmailSearcher.from_env()
result = searcher.search("is:unread after:2025/01/01")

for msg in result.messages:
    print(f"[{msg.account_name}] {msg.sender}: {msg.subject}")
```

## Gmail Search Syntax

Supports the same query syntax as the Gmail web UI:
- `is:unread` — unread messages
- `from:boss@company.com` — by sender
- `subject:invoice` — by subject
- `after:2025/01/01 before:2025/02/01` — date range
- `label:important` — by label
- `has:attachment` — with attachments

## Key Commands

```bash
cd gmail-search
pip install -e ".[dev]"
python -m pytest            # run tests with coverage
python -m pytest -v -k test_search  # run specific tests
```

## Parent codebase
@../CLAUDE.md
