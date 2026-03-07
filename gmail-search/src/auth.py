"""Account configuration loader for gmail-search.

Accounts are declared via environment variables:

    GMAIL_ACCOUNTS=work,personal

    GMAIL_ACCOUNT_WORK_CREDS=/path/to/work-creds.json
    GMAIL_ACCOUNT_WORK_USER=me           # optional, default "me"

    GMAIL_ACCOUNT_PERSONAL_CREDS=/path/to/personal-creds.json
"""

from __future__ import annotations

import os

from .models import GmailAccount


class ConfigError(ValueError):
    """Raised when account configuration is invalid or missing."""


def load_accounts(env: dict[str, str] | None = None) -> list[GmailAccount]:
    """Return all configured Gmail accounts from environment variables.

    Raises ConfigError if no accounts are configured or a credentials
    file is declared but does not exist.
    """
    env = env if env is not None else dict(os.environ)

    names_raw = env.get("GMAIL_ACCOUNTS", "").strip()
    if not names_raw:
        raise ConfigError(
            "GMAIL_ACCOUNTS env var is not set. "
            "Example: GMAIL_ACCOUNTS=work,personal"
        )

    accounts: list[GmailAccount] = []
    for name in [n.strip() for n in names_raw.split(",") if n.strip()]:
        key = name.upper()
        creds_var = f"GMAIL_ACCOUNT_{key}_CREDS"
        creds = env.get(creds_var, "").strip()
        if not creds:
            raise ConfigError(
                f"Missing credentials for account '{name}'. "
                f"Set {creds_var}=/path/to/creds.json"
            )
        if not os.path.exists(creds):
            raise ConfigError(
                f"Credentials file for '{name}' not found: {creds}"
            )
        user_id = env.get(f"GMAIL_ACCOUNT_{key}_USER", "me").strip()
        accounts.append(GmailAccount(name=name, credentials_file=creds, user_id=user_id))

    if not accounts:
        raise ConfigError("GMAIL_ACCOUNTS is set but contains no valid names.")

    return accounts
