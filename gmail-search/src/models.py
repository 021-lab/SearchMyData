"""Immutable data models for gmail-search."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class GmailAccount:
    """Represents one Google account to search."""

    name: str
    credentials_file: str
    user_id: str = "me"


@dataclass(frozen=True)
class GmailMessage:
    """A single Gmail message result."""

    id: str
    thread_id: str
    account_name: str
    snippet: str = ""
    subject: str = ""
    sender: str = ""
    date: str = ""
    body_plain: str = ""

    @staticmethod
    def from_gws_response(raw: dict, account_name: str) -> "GmailMessage":
        """Parse a message from gws JSON response."""
        headers = _extract_headers(raw.get("payload", {}).get("headers", []))
        return GmailMessage(
            id=raw.get("id", ""),
            thread_id=raw.get("threadId", ""),
            account_name=account_name,
            snippet=raw.get("snippet", ""),
            subject=headers.get("Subject", ""),
            sender=headers.get("From", ""),
            date=headers.get("Date", ""),
        )


@dataclass(frozen=True)
class SearchResult:
    """Aggregated results from a search across one or more accounts."""

    query: str
    messages: tuple[GmailMessage, ...] = field(default_factory=tuple)
    total_count: int = 0
    accounts_searched: tuple[str, ...] = field(default_factory=tuple)

    @staticmethod
    def merge(query: str, results: list["SearchResult"]) -> "SearchResult":
        """Merge results from multiple accounts into one."""
        all_messages: list[GmailMessage] = []
        accounts: list[str] = []
        for r in results:
            all_messages.extend(r.messages)
            accounts.extend(r.accounts_searched)
        return SearchResult(
            query=query,
            messages=tuple(all_messages),
            total_count=len(all_messages),
            accounts_searched=tuple(accounts),
        )


def _extract_headers(headers: list[dict]) -> dict[str, str]:
    """Convert Gmail header list to a name→value dict."""
    return {h["name"]: h["value"] for h in headers if "name" in h and "value" in h}
