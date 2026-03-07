"""Unit tests for multi-account GmailSearcher."""

from unittest.mock import MagicMock, patch

import pytest

from src.models import GmailAccount, GmailMessage, SearchResult
from src.search import GmailSearcher


WORK = GmailAccount(name="work", credentials_file="/tmp/w.json")
PERSONAL = GmailAccount(name="personal", credentials_file="/tmp/p.json")


def _make_result(account_name: str, msg_ids: list[str], query: str = "q") -> SearchResult:
    msgs = tuple(GmailMessage(id=mid, thread_id=f"t{mid}", account_name=account_name) for mid in msg_ids)
    return SearchResult(
        query=query,
        messages=msgs,
        total_count=len(msgs),
        accounts_searched=(account_name,),
    )


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


def test_searcher_raises_on_empty_accounts():
    with pytest.raises(ValueError, match="At least one"):
        GmailSearcher(accounts=[])


# ---------------------------------------------------------------------------
# Single-account search
# ---------------------------------------------------------------------------


def test_search_single_account():
    searcher = GmailSearcher(accounts=[WORK])
    expected = _make_result("work", ["m1", "m2"])

    with patch("src.search.GmailConnector") as MockConnector:
        MockConnector.return_value.search.return_value = expected
        result = searcher.search("is:unread")

    assert result.total_count == 2
    assert result.accounts_searched == ("work",)


def test_search_empty_query_raises():
    searcher = GmailSearcher(accounts=[WORK])
    with pytest.raises(ValueError, match="empty"):
        searcher.search("   ")


# ---------------------------------------------------------------------------
# Multi-account search
# ---------------------------------------------------------------------------


def test_search_two_accounts_merged():
    searcher = GmailSearcher(accounts=[WORK, PERSONAL])
    work_result = _make_result("work", ["w1"])
    personal_result = _make_result("personal", ["p1", "p2"])

    with patch("src.search.GmailConnector") as MockConnector:
        def side_effect(account):
            m = MagicMock()
            if account.name == "work":
                m.search.return_value = work_result
            else:
                m.search.return_value = personal_result
            return m

        MockConnector.side_effect = side_effect
        result = searcher.search("from:boss@example.com")

    assert result.total_count == 3
    assert set(m.id for m in result.messages) == {"w1", "p1", "p2"}
    assert set(result.accounts_searched) == {"work", "personal"}


def test_search_continues_when_one_account_fails():
    """Partial failure should not prevent results from other accounts."""
    searcher = GmailSearcher(accounts=[WORK, PERSONAL])
    personal_result = _make_result("personal", ["p1"])

    with patch("src.search.GmailConnector") as MockConnector:
        def side_effect(account):
            m = MagicMock()
            if account.name == "work":
                m.search.side_effect = RuntimeError("auth failed")
            else:
                m.search.return_value = personal_result
            return m

        MockConnector.side_effect = side_effect
        result = searcher.search("test")

    # personal results still present despite work failing
    assert any(m.account_name == "personal" for m in result.messages)


def test_search_passes_max_results():
    searcher = GmailSearcher(accounts=[WORK])

    with patch("src.search.GmailConnector") as MockConnector:
        mock_instance = MagicMock()
        mock_instance.search.return_value = _make_result("work", [])
        MockConnector.return_value = mock_instance
        searcher.search("test", max_results_per_account=25)

    mock_instance.search.assert_called_once_with("test", 25)


# ---------------------------------------------------------------------------
# from_env factory
# ---------------------------------------------------------------------------


def test_from_env_delegates_to_load_accounts():
    with patch("src.search.load_accounts", return_value=[WORK]) as mock_load:
        searcher = GmailSearcher.from_env()

    mock_load.assert_called_once()
    assert len(searcher._accounts) == 1
