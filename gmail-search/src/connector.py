"""Low-level wrapper around the `gws` CLI for Gmail operations."""

from __future__ import annotations

import json
import os
import subprocess
from shutil import which
from typing import Generator

from .models import GmailAccount, GmailMessage, SearchResult


class GwsNotFoundError(RuntimeError):
    """Raised when the `gws` binary cannot be found on PATH."""


class GwsAuthError(RuntimeError):
    """Raised when `gws` returns an authentication error."""


class GwsCommandError(RuntimeError):
    """Raised when `gws` exits with a non-zero status."""


def _gws_bin() -> str:
    """Return path to the gws binary or raise GwsNotFoundError."""
    path = which("gws")
    if path is None:
        raise GwsNotFoundError(
            "`gws` not found on PATH. Install with: npm install -g @googleworkspace/cli"
        )
    return path


def _run_gws(args: list[str], env: dict[str, str]) -> str:
    """Run a gws command and return stdout, raising on error."""
    result = subprocess.run(
        [_gws_bin(), *args],
        capture_output=True,
        text=True,
        env={**os.environ, **env},
    )
    stderr_lower = result.stderr.lower()
    if "unauthenticated" in stderr_lower or "unauthorized" in stderr_lower:
        raise GwsAuthError(f"Authentication failed: {result.stderr.strip()}")
    if result.returncode != 0:
        raise GwsCommandError(
            f"gws exited {result.returncode}: {result.stderr.strip()}"
        )
    return result.stdout


class GmailConnector:
    """Wraps `gws` CLI calls for a single Gmail account."""

    def __init__(self, account: GmailAccount) -> None:
        self._account = account
        self._env = {"GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE": account.credentials_file}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def search_message_ids(
        self,
        query: str,
        max_results: int = 100,
    ) -> list[str]:
        """Return message IDs matching *query*.  Uses --page-all when max_results>100."""
        params = {
            "userId": self._account.user_id,
            "q": query,
            "maxResults": min(max_results, 500),
        }
        args = [
            "gmail", "users", "messages", "list",
            "--params", json.dumps(params),
            "--fields", "messages(id,threadId)",
        ]
        if max_results > 100:
            args.append("--page-all")

        output = _run_gws(args, self._env)
        return self._parse_message_ids(output)

    def get_message(self, message_id: str) -> GmailMessage:
        """Fetch a single message by ID including headers and snippet."""
        params = {"userId": self._account.user_id, "id": message_id}
        fields = "id,threadId,snippet,payload/headers"
        args = [
            "gmail", "users", "messages", "get",
            "--params", json.dumps(params),
            "--fields", fields,
        ]
        raw = json.loads(_run_gws(args, self._env))
        return GmailMessage.from_gws_response(raw, self._account.name)

    def search(self, query: str, max_results: int = 100) -> SearchResult:
        """Full search: list IDs then fetch each message."""
        ids = self.search_message_ids(query, max_results)
        messages = [self.get_message(mid) for mid in ids]
        return SearchResult(
            query=query,
            messages=tuple(messages),
            total_count=len(messages),
            accounts_searched=(self._account.name,),
        )

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_message_ids(output: str) -> list[str]:
        """Parse NDJSON or plain JSON output from gws list command."""
        ids: list[str] = []
        for line in output.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            # gws list returns {"messages": [...]} or NDJSON of individual msgs
            if "messages" in obj:
                for msg in obj["messages"]:
                    if "id" in msg:
                        ids.append(msg["id"])
            elif "id" in obj:
                ids.append(obj["id"])
        return ids
