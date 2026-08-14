"""
post_journal — new tool for the stza-finance MCP server.

Sits alongside the existing read tools (get_trial_balance, get_accounts, …)
so preparing, posting and verifying a journal all happen over one connection
with one credential store.

Deliberately mirrors the retired stza-xero plugin's argument shape — entity,
narration, date, lines[account_code/amount/description/tax_type], status,
dry_run — so the `journal-posting` skill and any existing CSVs keep working
without edits.

Two differences from the old plugin, both intentional:

  * `status` defaults to "DRAFT", not "POSTED". Writing to a client ledger
    should be a deliberate act.
  * `idempotency_key` is accepted and should always be sent. The skill says
    "never post the same journal twice"; this is what enforces it.
"""

from typing import Any

import httpx

# from .server import mcp, api_client   # adapt to the actual stza-finance module layout


@mcp.tool()  # noqa: F821
async def post_journal(
    client: str,
    entity: str,
    narration: str,
    date: str,
    lines: list[dict[str, Any]],
    status: str = "DRAFT",
    dry_run: bool = False,
    idempotency_key: str | None = None,
    reference: str | None = None,
) -> dict[str, Any]:
    """
    Post a manual journal to Xero via os.stza.io. REQUIRES PRIOR USER APPROVAL.

    Args:
        client: Client slug from list_clients (e.g. "feldspar-sport-group")
        entity: Entity slug from list_entities (e.g. "feldspar-group-holdings")
        narration: Journal description — reference the working paper or issue
        date: Journal date, YYYY-MM-DD (normally the period end)
        lines: Each a dict with:
               - account_code (str): Xero account code
               - amount (float): positive = debit, negative = credit
               - description (str): line description
               - tax_type (str, optional): "NONE" | "INPUT2" | "OUTPUT2"
        status: "DRAFT" or "POSTED" (default "DRAFT")
        dry_run: Validate only, do not post (default False)
        idempotency_key: Stable key preventing double-posting. Recommended
                         format: {entity}-{period}-{purpose}-v{n},
                         e.g. "fgh-2026-08-marketing-provision-v1"
        reference: Optional working paper / reconciliation reference

    Returns:
        On success: journal_id, journal_number, status, audit_id,
                    balances_before/after, idempotent_replay
        On validation failure: every issue found, with nothing sent to Xero
        On Xero rejection: Xero's error body verbatim
    """
    payload = {
        "client": client,
        "entity": entity,
        "narration": narration,
        "date": date,
        "lines": lines,
        "status": status,
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
        "reference": reference,
    }

    try:
        resp = await api_client.post("/api/finance/xero/journals", json=payload)  # noqa: F821
    except httpx.RequestError as e:
        return {"ok": False, "stage": "transport", "error": str(e)}

    # Pass the platform's response through unchanged, including errors.
    # The agent needs the real reason, not a sanitised one.
    try:
        body = resp.json()
    except ValueError:
        return {"ok": False, "stage": "transport",
                "http_status": resp.status_code, "raw": resp.text[:2000]}

    if resp.status_code >= 400:
        detail = body.get("detail", body)
        return {"ok": False, "http_status": resp.status_code, **(
            detail if isinstance(detail, dict) else {"detail": detail}
        )}

    return body
