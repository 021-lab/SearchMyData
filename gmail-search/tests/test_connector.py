"""Unit tests for GmailConnector (gws CLI wrapper)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from src.connector import (
    GmailConnector,
    GwsAuthError,
    GwsCommandError,
    GwsNotFoundError,
    _gws_bin,
    _run_gws,
)
from src.models import GmailAccount, GmailMessage, SearchResult


ACCOUNT = GmailAccount(name="work", credentials_file="/tmp/fake-creds.json")


# ---------------------------------------------------------------------------
# _gws_bin
# ---------------------------------------------------------------------------


def test_gws_bin_not_found():
    with patch("src.connector.which", return_value=None):
        with pytest.raises(GwsNotFoundError, match="gws"):
            _gws_bin()


def test_gws_bin_found():
    with patch("src.connector.which", return_value="/usr/local/bin/gws"):
        assert _gws_bin() == "/usr/local/bin/gws"


# ---------------------------------------------------------------------------
# _run_gws
# ---------------------------------------------------------------------------


def _make_completed_process(stdout="", stderr="", returncode=0):
    result = MagicMock()
    result.stdout = stdout
    result.stderr = stderr
    result.returncode = returncode
    return result


def test_run_gws_success():
    with patch("src.connector.subprocess.run", return_value=_make_completed_process(stdout='{"ok": true}')):
        with patch("src.connector._gws_bin", return_value="/usr/bin/gws"):
            out = _run_gws(["gmail", "triage"], {})
    assert '"ok": true' in out


def test_run_gws_auth_error():
    with patch("src.connector.subprocess.run", return_value=_make_completed_process(stderr="Unauthenticated", returncode=1)):
        with patch("src.connector._gws_bin", return_value="/usr/bin/gws"):
            with pytest.raises(GwsAuthError):
                _run_gws(["gmail", "triage"], {})


def test_run_gws_command_error():
    with patch("src.connector.subprocess.run", return_value=_make_completed_process(stderr="some error", returncode=2)):
        with patch("src.connector._gws_bin", return_value="/usr/bin/gws"):
            with pytest.raises(GwsCommandError, match="exited 2"):
                _run_gws(["gmail", "triage"], {})


# ---------------------------------------------------------------------------
# GmailConnector._parse_message_ids
# ---------------------------------------------------------------------------


def test_parse_message_ids_json_wrapper():
    output = json.dumps({"messages": [{"id": "a1"}, {"id": "b2"}]})
    ids = GmailConnector._parse_message_ids(output)
    assert ids == ["a1", "b2"]


def test_parse_message_ids_ndjson():
    lines = [json.dumps({"id": "x1"}), json.dumps({"id": "x2"})]
    output = "\n".join(lines)
    ids = GmailConnector._parse_message_ids(output)
    assert ids == ["x1", "x2"]


def test_parse_message_ids_empty_output():
    assert GmailConnector._parse_message_ids("") == []


def test_parse_message_ids_skips_invalid_lines():
    output = 'not-json\n{"id": "ok1"}'
    ids = GmailConnector._parse_message_ids(output)
    assert ids == ["ok1"]


def test_parse_message_ids_skips_objects_without_id():
    output = json.dumps({"messages": [{"threadId": "t1"}, {"id": "valid"}]})
    ids = GmailConnector._parse_message_ids(output)
    assert ids == ["valid"]


# ---------------------------------------------------------------------------
# GmailConnector.search_message_ids
# ---------------------------------------------------------------------------


def test_search_message_ids_builds_correct_params():
    connector = GmailConnector(ACCOUNT)
    list_output = json.dumps({"messages": [{"id": "m1"}]})

    with patch("src.connector._run_gws", return_value=list_output) as mock_run:
        ids = connector.search_message_ids("is:unread", max_results=50)

    assert ids == ["m1"]
    call_args = mock_run.call_args[0][0]  # positional args[0] = args list
    assert "gmail" in call_args
    assert "messages" in call_args
    assert "list" in call_args
    # Verify params JSON contains the query
    params_idx = call_args.index("--params") + 1
    params = json.loads(call_args[params_idx])
    assert params["q"] == "is:unread"
    assert params["userId"] == "me"


def test_search_message_ids_adds_page_all_when_large():
    connector = GmailConnector(ACCOUNT)
    with patch("src.connector._run_gws", return_value='{"messages": []}'):
        connector.search_message_ids("test", max_results=200)
    # Just check it doesn't raise; --page-all path exercised


# ---------------------------------------------------------------------------
# GmailConnector.get_message
# ---------------------------------------------------------------------------


def test_get_message_returns_gmail_message():
    raw = {
        "id": "abc",
        "threadId": "t1",
        "snippet": "preview",
        "payload": {
            "headers": [
                {"name": "Subject", "value": "Hello"},
                {"name": "From", "value": "a@b.com"},
            ]
        },
    }
    connector = GmailConnector(ACCOUNT)
    with patch("src.connector._run_gws", return_value=json.dumps(raw)):
        msg = connector.get_message("abc")

    assert isinstance(msg, GmailMessage)
    assert msg.id == "abc"
    assert msg.subject == "Hello"
    assert msg.account_name == "work"


# ---------------------------------------------------------------------------
# GmailConnector.search (full flow)
# ---------------------------------------------------------------------------


def test_connector_search_end_to_end():
    list_output = json.dumps({"messages": [{"id": "m1"}, {"id": "m2"}]})
    msg_raw = {"id": "m1", "threadId": "t1", "snippet": "s", "payload": {"headers": []}}

    connector = GmailConnector(ACCOUNT)
    with patch("src.connector._run_gws", side_effect=[list_output, json.dumps(msg_raw), json.dumps({**msg_raw, "id": "m2"})]):
        result = connector.search("is:unread", max_results=10)

    assert isinstance(result, SearchResult)
    assert result.total_count == 2
    assert result.accounts_searched == ("work",)


def test_connector_search_empty_results():
    connector = GmailConnector(ACCOUNT)
    with patch("src.connector._run_gws", return_value='{"messages": []}'):
        result = connector.search("nothing", max_results=10)

    assert result.total_count == 0
    assert result.messages == ()
