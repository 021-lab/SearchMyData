"""Multi-account Gmail search orchestration."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .auth import load_accounts
from .connector import GmailConnector
from .models import GmailAccount, SearchResult


class GmailSearcher:
    """Searches Gmail across one or more accounts in parallel."""

    def __init__(
        self,
        accounts: list[GmailAccount],
        max_workers: int = 4,
    ) -> None:
        if not accounts:
            raise ValueError("At least one account is required.")
        self._accounts = accounts
        self._max_workers = max_workers

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_env(cls, max_workers: int = 4) -> "GmailSearcher":
        """Create a searcher from environment variables (see auth.py)."""
        accounts = load_accounts()
        return cls(accounts=accounts, max_workers=max_workers)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def search(self, query: str, max_results_per_account: int = 100) -> SearchResult:
        """Search *query* across all accounts in parallel and merge results.

        Args:
            query: Gmail search query (same syntax as the web UI).
            max_results_per_account: Maximum messages to fetch per account.

        Returns:
            Merged SearchResult with messages from all accounts.
        """
        if not query.strip():
            raise ValueError("Search query must not be empty.")

        per_account: list[SearchResult] = []

        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            futures = {
                pool.submit(
                    self._search_one, account, query, max_results_per_account
                ): account
                for account in self._accounts
            }
            for future in as_completed(futures):
                account = futures[future]
                try:
                    per_account.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    # Log and continue — partial results are better than none
                    per_account.append(
                        SearchResult(
                            query=query,
                            messages=(),
                            total_count=0,
                            accounts_searched=(account.name,),
                        )
                    )

        return SearchResult.merge(query, per_account)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _search_one(
        account: GmailAccount,
        query: str,
        max_results: int,
    ) -> SearchResult:
        return GmailConnector(account).search(query, max_results)
