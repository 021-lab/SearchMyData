"""Unit tests for account configuration loader."""

import os
import tempfile

import pytest

from src.auth import ConfigError, load_accounts
from src.models import GmailAccount


def _make_creds_file() -> str:
    """Write a temporary placeholder credentials file and return its path."""
    f = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    f.write(b'{"type": "authorized_user"}')
    f.close()
    return f.name


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


def test_load_accounts_raises_when_env_missing():
    with pytest.raises(ConfigError, match="GMAIL_ACCOUNTS"):
        load_accounts({})


def test_load_accounts_raises_when_creds_missing():
    env = {"GMAIL_ACCOUNTS": "work"}
    with pytest.raises(ConfigError, match="GMAIL_ACCOUNT_WORK_CREDS"):
        load_accounts(env)


def test_load_accounts_raises_when_creds_file_not_found():
    env = {
        "GMAIL_ACCOUNTS": "work",
        "GMAIL_ACCOUNT_WORK_CREDS": "/nonexistent/path/creds.json",
    }
    with pytest.raises(ConfigError, match="not found"):
        load_accounts(env)


def test_load_accounts_raises_on_empty_names():
    env = {"GMAIL_ACCOUNTS": ",,,"}
    with pytest.raises(ConfigError, match="no valid names"):
        load_accounts(env)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_load_accounts_single():
    creds = _make_creds_file()
    try:
        env = {
            "GMAIL_ACCOUNTS": "work",
            "GMAIL_ACCOUNT_WORK_CREDS": creds,
        }
        accounts = load_accounts(env)
        assert len(accounts) == 1
        assert accounts[0].name == "work"
        assert accounts[0].credentials_file == creds
        assert accounts[0].user_id == "me"
    finally:
        os.unlink(creds)


def test_load_accounts_multiple():
    c1, c2 = _make_creds_file(), _make_creds_file()
    try:
        env = {
            "GMAIL_ACCOUNTS": "work,personal",
            "GMAIL_ACCOUNT_WORK_CREDS": c1,
            "GMAIL_ACCOUNT_PERSONAL_CREDS": c2,
        }
        accounts = load_accounts(env)
        assert len(accounts) == 2
        names = {a.name for a in accounts}
        assert names == {"work", "personal"}
    finally:
        os.unlink(c1)
        os.unlink(c2)


def test_load_accounts_custom_user_id():
    creds = _make_creds_file()
    try:
        env = {
            "GMAIL_ACCOUNTS": "corp",
            "GMAIL_ACCOUNT_CORP_CREDS": creds,
            "GMAIL_ACCOUNT_CORP_USER": "admin@corp.com",
        }
        accounts = load_accounts(env)
        assert accounts[0].user_id == "admin@corp.com"
    finally:
        os.unlink(creds)


def test_load_accounts_strips_whitespace_from_names():
    creds = _make_creds_file()
    try:
        env = {
            "GMAIL_ACCOUNTS": " work , personal ",
            "GMAIL_ACCOUNT_WORK_CREDS": creds,
            "GMAIL_ACCOUNT_PERSONAL_CREDS": creds,
        }
        accounts = load_accounts(env)
        assert {a.name for a in accounts} == {"work", "personal"}
    finally:
        os.unlink(creds)
