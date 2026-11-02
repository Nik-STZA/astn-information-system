"""stza-finance-api client.

finance-api is the only holder of Xero tokens; the engine only ever sees report
JSON. The key comes from the environment (Secret Manager on Cloud Run) and is
never written anywhere.
"""

from __future__ import annotations

import os
import time
from datetime import date

import requests

RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_SLEEPS = (5, 20, 60, 95)   # Xero 429s surface as 502s; its window is 60 seconds
# Xero allows 60 calls a minute per organisation. finance-api's limiter caps calls
# at once and retries a 429, but does not pace, so long sequential reads pace here.
READ_INTERVAL = 1.1              # seconds between paced reads: about 54 a minute
PAGE_SIZE = 100                  # Xero's page size for paged lists
MAX_PAGES = 500                  # stop rather than loop, and never return part of a list


class FinanceApiError(RuntimeError):
    pass


class FinanceApi:
    def __init__(self, base_url: str | None = None, api_key: str | None = None,
                 session: requests.Session | None = None, sleep=time.sleep):
        self.base_url = (base_url or os.environ.get("FINANCE_API_URL", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("FINANCE_API_KEY", "")
        if not self.base_url or not self.api_key:
            raise FinanceApiError("FINANCE_API_URL and FINANCE_API_KEY must be set")
        self.session = session or requests.Session()
        self.sleep = sleep
        self.clock = time.monotonic
        self._last_paced: float | None = None

    def pace(self) -> None:
        """Wait until a paced read is within Xero's 60 calls a minute."""
        now = self.clock()
        if self._last_paced is not None and now - self._last_paced < READ_INTERVAL:
            self.sleep(READ_INTERVAL - (now - self._last_paced))
        self._last_paced = self.clock()

    def get(self, path: str, params: dict | None = None, *, missing_ok: bool = False) -> dict | None:
        url = f"{self.base_url}{path}"
        for attempt, pause in enumerate((*RETRY_SLEEPS, None)):
            r = self.session.get(url, params=params, timeout=120,
                                 headers={"X-API-Key": self.api_key})
            if r.status_code < 400:
                return r.json()
            if r.status_code == 404 and missing_ok:
                return None
            if r.status_code not in RETRY_STATUS or pause is None:
                raise FinanceApiError(f"GET {path} failed {r.status_code}: {r.text[:300]}")
            self.sleep(pause)
        raise FinanceApiError(f"GET {path} failed after retries")  # pragma: no cover

    # --- Platform data ------------------------------------------------------------
    def account_mapping(self, client: str, entity: str) -> dict | None:
        """{categories, mappings} saved in the portal, or None from a finance-api
        that predates migration 017."""
        return self.get(f"/api/finance/clients/{client}/entities/{entity}/account-mapping", missing_ok=True)

    # --- Xero reads, per entity -------------------------------------------------
    def _x(self, client: str, entity: str, what: str) -> str:
        return f"/api/finance/clients/{client}/xero/{entity}/{what}"

    def accounts(self, client: str, entity: str) -> list[dict]:
        d = self.get(self._x(client, entity, "accounts"))
        return d.get("data") or d.get("Accounts") or []

    def trial_balance(self, client: str, entity: str, as_at: date) -> dict:
        return self.get(self._x(client, entity, "trial-balance"), {"date": as_at.isoformat()})["report"]

    def profit_and_loss(self, client: str, entity: str, start: date, end: date) -> dict:
        return self.get(self._x(client, entity, "profit-and-loss"),
                        {"fromDate": start.isoformat(), "toDate": end.isoformat()})["report"]

    def balance_sheet(self, client: str, entity: str, as_at: date) -> dict:
        return self.get(self._x(client, entity, "balance-sheet"), {"date": as_at.isoformat()})["report"]

    def read(self, client: str, entity: str, resource: str, **params) -> dict:
        """finance-api's allowlisted, GET-only Xero passthrough, paced."""
        self.pace()
        return self.get(self._x(client, entity, f"read/{resource}"), params or None).get("data") or {}

    def paged(self, client: str, entity: str, resource: str, key: str, **params) -> list[dict]:
        """Every page of a list. Xero only returns line items on paged reads."""
        out: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            batch = self.read(client, entity, resource, page=page, **params).get(key) or []
            out.extend(batch)
            if len(batch) < PAGE_SIZE:
                return out
        raise FinanceApiError(f"{resource}: more than {MAX_PAGES} pages; stopped rather than return part of it")
