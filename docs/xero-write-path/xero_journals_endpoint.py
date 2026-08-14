"""
Reference implementation — POST /api/finance/xero/journals

FastAPI. Adapt to whatever os.stza.io actually runs; the important parts are
the token lock (get_access_token) and the validation/audit ordering, not the
framework.

The two things that must survive adaptation:

  1. get_access_token() holds a lock across read -> refresh -> persist, and
     persists the rotated refresh token BEFORE the access token is used.
     Skipping this reproduces the exact bug that killed the local plugin.

  2. Xero's error body is returned verbatim. Never raise_for_status() and
     discard it.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

router = APIRouter(prefix="/api/finance/xero", tags=["xero"])

XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class JournalLine(BaseModel):
    account_code: str
    amount: Decimal = Field(..., description="positive = debit, negative = credit")
    description: str = ""
    tax_type: str = "NONE"

    @field_validator("amount")
    @classmethod
    def _finite(cls, v: Decimal) -> Decimal:
        if not v.is_finite():
            raise ValueError("amount must be a finite number")
        return v


class JournalRequest(BaseModel):
    client: str
    entity: str
    date: dt.date
    narration: str
    lines: list[JournalLine]
    status: Literal["DRAFT", "POSTED"] = "DRAFT"   # NB: DRAFT is the default
    dry_run: bool = False
    idempotency_key: str | None = None
    reference: str | None = None


class Issue(BaseModel):
    code: str
    detail: str


# ---------------------------------------------------------------------------
# Token handling — the part that matters
# ---------------------------------------------------------------------------

async def get_access_token(client: str) -> tuple[str, str]:
    """
    Return (access_token, tenant_id) for an entity's Xero connection.

    MUST serialise read -> refresh -> persist. Xero rotates the refresh token
    on every use and invalidates the previous one; two concurrent refreshes
    mean the loser presents a consumed token and the connection dies.

    Replace the pseudo-locking below with your real primitive:
      - Firestore:  async with db.transaction() as txn:
      - Cloud SQL:  SELECT ... FOR UPDATE
      - Redis:      SET NX with a TTL and a fencing token
    """
    async with token_lock(client):                      # noqa: F821 - your lock
        record = await load_token_record(client)        # noqa: F821 - your store

        if record.access_token_valid_for() > dt.timedelta(minutes=2):
            return record.access_token, record.tenant_id

        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.post(
                XERO_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": record.refresh_token,
                },
                auth=(record.client_id, record.client_secret),
            )

        if resp.status_code != 200:
            # Surface Xero's reason. "invalid_grant / refresh token has been
            # consumed" is actionable; "400 Bad Request" is not.
            await alert_ops(                            # noqa: F821
                f"Xero token refresh failed for {client}: "
                f"{resp.status_code} {resp.text}"
            )
            raise HTTPException(
                status_code=502,
                detail={"stage": "token_refresh",
                        "http_status": resp.status_code,
                        "xero_error": _safe_json(resp)},
            )

        tokens = resp.json()

        # Persist BEFORE returning. A crash after this point costs an access
        # token (30 min); a crash before it costs the whole connection.
        await save_token_record(                        # noqa: F821
            client,
            access_token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            expires_in=tokens["expires_in"],
        )
        return tokens["access_token"], record.tenant_id


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text[:2000]}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def validate(req: JournalRequest, accounts: dict[str, dict]) -> tuple[list[Issue], list[str]]:
    """Return (blocking_issues, warnings). Collect everything — don't stop at the first."""
    issues: list[Issue] = []
    warnings: list[str] = []

    if len(req.lines) < 2:
        issues.append(Issue(code="NO_LINES", detail="A journal needs at least two lines."))

    try:
        net = sum((ln.amount for ln in req.lines), Decimal("0"))
    except InvalidOperation:
        issues.append(Issue(code="BAD_AMOUNT", detail="Could not sum line amounts."))
        net = Decimal("0")

    if net != Decimal("0"):
        debits = sum((l.amount for l in req.lines if l.amount > 0), Decimal("0"))
        credits = -sum((l.amount for l in req.lines if l.amount < 0), Decimal("0"))
        issues.append(Issue(
            code="UNBALANCED",
            detail=f"Debits {debits} != credits {credits}, net {net}",
        ))

    for ln in req.lines:
        if ln.amount == 0:
            issues.append(Issue(code="ZERO_AMOUNT",
                                detail=f"Line for account {ln.account_code} has amount 0."))

        acct = accounts.get(ln.account_code)
        if acct is None:
            issues.append(Issue(code="UNKNOWN_ACCOUNT",
                                detail=f"Account code {ln.account_code} does not exist in {req.entity}."))
            continue
        if acct.get("Status") != "ACTIVE":
            issues.append(Issue(code="ARCHIVED_ACCOUNT",
                                detail=f"Account {ln.account_code} ({acct.get('Name')}) is {acct.get('Status')}."))
        if acct.get("Type") == "BANK":
            issues.append(Issue(code="BANK_ACCOUNT",
                                detail=f"Account {ln.account_code} is a bank account; Xero rejects manual journals to these."))

    lock_date = await get_lock_date(req.client, req.entity)      # noqa: F821
    if lock_date and req.date <= lock_date:
        issues.append(Issue(code="PERIOD_LOCKED",
                            detail=f"{req.date} is on or before the lock date {lock_date}."))

    threshold = await get_materiality_threshold(req.client)      # noqa: F821
    gross = sum((abs(l.amount) for l in req.lines), Decimal("0")) / 2
    if threshold and gross > threshold:
        warnings.append(f"MATERIALITY: {gross} exceeds threshold {threshold}")

    if req.date > dt.date.today():
        warnings.append(f"FUTURE_PERIOD: {req.date} is in the future.")

    return issues, warnings


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/journals")
async def post_journal(req: JournalRequest, actor=Depends(current_actor)):  # noqa: F821
    await assert_write_permission(actor, req.client)             # noqa: F821

    # --- idempotency ------------------------------------------------------
    if req.idempotency_key:
        prior = await find_by_idempotency_key(req.client, req.entity, req.idempotency_key)  # noqa: F821
        if prior:
            if prior.request_payload != req.model_dump(mode="json"):
                raise HTTPException(409, detail={
                    "stage": "idempotency",
                    "detail": "Key reused with a different payload.",
                    "original": prior.request_payload,
                    "submitted": req.model_dump(mode="json"),
                })
            return {**prior.result, "idempotent_replay": True}

    accounts = await get_chart_of_accounts(req.client, req.entity)          # noqa: F821
    issues, warnings = await validate(req, accounts)

    if issues:
        raise HTTPException(422, detail={
            "ok": False, "stage": "validation",
            "issues": [i.model_dump() for i in issues],
            "warnings": warnings,
        })

    xero_payload = {
        "ManualJournals": [{
            "Narration": req.narration,
            "Date": req.date.isoformat(),
            "Status": req.status,
            "LineAmountTypes": "NoTax",
            "JournalLines": [
                {
                    "AccountCode": ln.account_code,
                    "LineAmount": str(ln.amount),
                    "Description": ln.description,
                    "TaxType": ln.tax_type,
                }
                for ln in req.lines
            ],
        }]
    }

    if req.dry_run:
        return {
            "ok": True, "action": "DRY RUN — validated, not posted",
            "net": "0.00", "warnings": warnings, "xero_payload": xero_payload,
        }

    balances_before = await get_balances(req.client, req.entity, req.date,   # noqa: F821
                                         [l.account_code for l in req.lines])

    # Audit row written BEFORE the call, so a crash mid-flight leaves evidence.
    audit_id = await open_audit_record(                                      # noqa: F821
        client=req.client, entity=req.entity, actor=actor,
        request_payload=req.model_dump(mode="json"),
        xero_request=xero_payload, warnings=warnings,
        balances_before=balances_before,
        idempotency_key=req.idempotency_key, reference=req.reference,
    )

    access_token, tenant_id = await get_access_token(req.client)

    async with httpx.AsyncClient(timeout=60) as http:
        resp = await http.post(
            f"{XERO_API_BASE}/ManualJournals",
            json=xero_payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Xero-Tenant-Id": tenant_id,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code not in (200, 201):
        await close_audit_record(audit_id, outcome="failed",                 # noqa: F821
                                 xero_response=_safe_json(resp))
        raise HTTPException(502, detail={
            "ok": False, "stage": "xero",
            "http_status": resp.status_code,
            "xero_error": _safe_json(resp),          # verbatim, always
            "audit_id": audit_id,
        })

    journal = resp.json()["ManualJournals"][0]
    balances_after = await get_balances(req.client, req.entity, req.date,    # noqa: F821
                                        [l.account_code for l in req.lines])

    result = {
        "ok": True,
        "journal_id": journal["ManualJournalID"],
        "journal_number": journal.get("JournalNumber"),
        "status": journal["Status"],
        "audit_id": audit_id,
        "net": "0.00",
        "warnings": warnings,
        "idempotent_replay": False,
    }

    await close_audit_record(audit_id, outcome=req.status.lower(),           # noqa: F821
                             xero_response=journal, result=result,
                             balances_after=balances_after)
    return result
