"""Unit tests for data models."""

import pytest

from src.models import GmailAccount, GmailMessage, SearchResult, _extract_headers


# ---------------------------------------------------------------------------
# GmailAccount
# ---------------------------------------------------------------------------


def test_gmail_account_is_immutable():
    account = GmailAccount(name="work", credentials_file="/tmp/creds.json")
    with pytest.raises(AttributeError):
        account.name = "other"  # type: ignore[misc]


def test_gmail_account_default_user_id():
    account = GmailAccount(name="work", credentials_file="/tmp/creds.json")
    assert account.user_id == "me"


def test_gmail_account_custom_user_id():
    account = GmailAccount(name="work", credentials_file="/tmp/creds.json", user_id="user@example.com")
    assert account.user_id == "user@example.com"


# ---------------------------------------------------------------------------
# GmailMessage
# ---------------------------------------------------------------------------


def test_gmail_message_is_immutable():
    msg = GmailMessage(id="abc", thread_id="t1", account_name="work")
    with pytest.raises(AttributeError):
        msg.id = "other"  # type: ignore[misc]


def test_gmail_message_from_gws_response_full():
    raw = {
        "id": "msg123",
        "threadId": "thread456",
        "snippet": "Hello world snippet",
        "payload": {
            "headers": [
                {"name": "Subject", "value": "Test Subject"},
                {"name": "From", "value": "sender@example.com"},
                {"name": "Date", "value": "Mon, 1 Jan 2025 10:00:00 +0000"},
            ]
        },
    }
    msg = GmailMessage.from_gws_response(raw, "work")
    assert msg.id == "msg123"
    assert msg.thread_id == "thread456"
    assert msg.account_name == "work"
    assert msg.snippet == "Hello world snippet"
    assert msg.subject == "Test Subject"
    assert msg.sender == "sender@example.com"
    assert msg.date == "Mon, 1 Jan 2025 10:00:00 +0000"


def test_gmail_message_from_gws_response_missing_fields():
    raw = {"id": "msg1", "threadId": "t1"}
    msg = GmailMessage.from_gws_response(raw, "personal")
    assert msg.snippet == ""
    assert msg.subject == ""
    assert msg.sender == ""


def test_gmail_message_from_gws_response_missing_header():
    raw = {
        "id": "msg2",
        "threadId": "t2",
        "payload": {"headers": [{"name": "Subject", "value": "Only Subject"}]},
    }
    msg = GmailMessage.from_gws_response(raw, "personal")
    assert msg.subject == "Only Subject"
    assert msg.sender == ""


# ---------------------------------------------------------------------------
# SearchResult
# ---------------------------------------------------------------------------


def test_search_result_defaults():
    result = SearchResult(query="test")
    assert result.total_count == 0
    assert result.messages == ()
    assert result.accounts_searched == ()


def test_search_result_merge_empty():
    merged = SearchResult.merge("test", [])
    assert merged.query == "test"
    assert merged.total_count == 0
    assert merged.messages == ()


def test_search_result_merge_single():
    msg = GmailMessage(id="1", thread_id="t1", account_name="work")
    r = SearchResult(query="q", messages=(msg,), total_count=1, accounts_searched=("work",))
    merged = SearchResult.merge("q", [r])
    assert merged.total_count == 1
    assert merged.messages == (msg,)
    assert merged.accounts_searched == ("work",)


def test_search_result_merge_multiple_accounts():
    msg1 = GmailMessage(id="1", thread_id="t1", account_name="work")
    msg2 = GmailMessage(id="2", thread_id="t2", account_name="personal")
    r1 = SearchResult(query="q", messages=(msg1,), total_count=1, accounts_searched=("work",))
    r2 = SearchResult(query="q", messages=(msg2,), total_count=1, accounts_searched=("personal",))
    merged = SearchResult.merge("q", [r1, r2])
    assert merged.total_count == 2
    assert set(m.id for m in merged.messages) == {"1", "2"}
    assert set(merged.accounts_searched) == {"work", "personal"}


def test_search_result_is_immutable():
    result = SearchResult(query="q")
    with pytest.raises(AttributeError):
        result.query = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# _extract_headers
# ---------------------------------------------------------------------------


def test_extract_headers_normal():
    headers = [
        {"name": "Subject", "value": "Hello"},
        {"name": "From", "value": "a@b.com"},
    ]
    assert _extract_headers(headers) == {"Subject": "Hello", "From": "a@b.com"}


def test_extract_headers_empty():
    assert _extract_headers([]) == {}


def test_extract_headers_skips_invalid():
    headers = [{"name": "Subject", "value": "OK"}, {"broken": True}]
    result = _extract_headers(headers)
    assert "Subject" in result
    assert len(result) == 1
