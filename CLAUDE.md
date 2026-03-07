# SearchMyData

Agent for searching personal data. Containerized, connected to all personal data sources.
Administered via personal Discord channel. No internet access except required API endpoints.

## Architecture

```
SearchMyData/          ← this repo (main agent)
├── src/
│   ├── connectors/    ← data source connectors (Gmail, GDrive, iCloud, etc.)
│   ├── search/        ← search/query engine
│   ├── discord/       ← Discord bot interface
│   └── api/           ← internal API
├── docker-compose.yml
└── .env.example

~/.claude/             ← ECC global config (all sessions)
├── skills/            ← 60+ skills auto-loaded
├── rules/             ← coding standards (TS, Python, Go)
└── everything-claude-code/  ← ECC source
```

## Related Codebases

If you're working across multiple repos, add them here with `@` imports:

```
# Example for future services:
# @../search-indexer/CLAUDE.md
# @../auth-service/CLAUDE.md
```

## Stack

- **Runtime:** Python (connectors, search engine)
- **Bot:** Discord.py
- **Storage:** Local vector DB for search index
- **Container:** Docker Compose (no external internet except APIs)

## Key Commands

```bash
docker compose up          # start all services
docker compose logs -f     # follow logs
python -m pytest           # run tests
python src/main.py         # run locally
```

## Data Sources

| Source | Status | Connector |
|--------|--------|-----------|
| Gmail  | planned | `src/connectors/gmail.py` |
| Google Drive | planned | `src/connectors/gdrive.py` |
| Google Contacts | planned | `src/connectors/contacts.py` |
| iCloud Files | planned | `src/connectors/icloud.py` |

## Conventions

- **Branches:** `feature/*`, `fix/*`, `claude/*`
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, etc.)
- **Secrets:** `.env` only, never hardcoded. Template in `.env.example`
- **Tests:** pytest, 80%+ coverage required
- **Style:** PEP 8, type hints everywhere, immutable data patterns

## Multi-Codebase Navigation Guide

When this agent grows into multiple repos, orient Claude by:

1. **Root workspace CLAUDE.md** — create at the parent folder level:
   ```
   ~/projects/
     CLAUDE.md          ← ties all repos together
     SearchMyData/
       CLAUDE.md        ← this file
     search-indexer/
       CLAUDE.md
   ```

2. **`@file` imports** — reference sibling repos directly in CLAUDE.md:
   ```markdown
   ## Auth service
   @../auth-service/CLAUDE.md
   ```

3. **Global context** — `~/.claude/CLAUDE.md` maps ALL your projects.

4. **Launch Claude from workspace root** — gives visibility into all sibling repos:
   ```bash
   cd ~/projects   # parent of all repos
   claude
   ```

## ECC (Everything Claude Code)

Installed globally at `~/.claude/everything-claude-code`. Active on every session:
- **SessionStart** — restores previous context, detects package manager
- **PostToolUse** — quality gates, auto-format after edits
- **Stop** — persists session state, tracks costs, evaluates patterns
- **Rules** — Python, TypeScript, Go standards auto-loaded

See [ECC repo](https://github.com/affaan-m/everything-claude-code) for full docs.
