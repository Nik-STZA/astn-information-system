# Xero write path — moving journal posting into os.stza.io

**Status:** design spec
**Author:** prepared for STZA, 14 August 2026
**Replaces:** the `stza-xero` local MCP plugin

---

## 1. Why

The current build has two integrations against the same three Xero
organisations (FGH, FSL, UDL):

| | os.stza.io | stza-xero plugin |
|---|---|---|
| Location | Hosted (GCP) | Analyst laptop |
| Credentials | Platform-owned, rotated | Copy in `configs\*.json`, plaintext |
| Xero app | `8EA540A6…` | **Same app** |
| Capability | Read only | Read (duplicated) + **write** |
| Audit trail | Platform | None |
| Status 14 Aug 2026 | Working | Dead since ~12 July |

Both hold refresh tokens for the same Xero app. Xero rotates the refresh
token on **every** refresh and invalidates the old one after a short grace
window. Two independent holders therefore cannot both stay valid: whichever
refreshes second presents a token the first has already consumed.

Observed failure, 14 Aug 2026 — all three local configs:

```
{"error":"invalid_grant","error_description":"Refresh token has been consumed"}
last saved: 2026-07-12
```

This is structural, not a one-off. Re-authorising the local copies resets the
clock; it does not remove the second holder. **The fix is to have one holder.**

A second Xero app for the plugin would also work mechanically, but keeps
write credentials for three client ledgers in plaintext on a laptop and keeps
journal posting outside any audit trail. For a practice posting to client
ledgers, that is the wrong trade.

### Target

```
Claude / analyst
      |
      v
stza-finance MCP  ──►  os.stza.io  ──►  Xero
  (read + write)        (sole credential holder,
                         serialised refresh,
                         audit log, approval gate)
```

One credential store. One reconnect button. One audit trail. The local
plugin is removed.

---

## 2. Endpoint

### `POST /api/finance/xero/journals`

Auth: existing platform session/service auth. Caller must have write
permission on the client.

#### Request

```jsonc
{
  "client": "feldspar-sport-group",     // client slug
  "entity": "feldspar-group-holdings",  // entity slug, NOT a config filename
  "date": "2026-08-31",                 // YYYY-MM-DD, the period the journal belongs to
  "narration": "Provision for marketing costs — August 2026",
  "status": "DRAFT",                    // DRAFT | POSTED, default DRAFT
  "dry_run": false,
  "idempotency_key": "fgh-2026-08-marketing-provision-v1",
  "reference": "WP-2026-08-014",        // optional: working paper / recon ref
  "lines": [
    { "account_code": "400", "amount":  50000.00, "description": "Marketing provision - Aug 2026", "tax_type": "NONE" },
    { "account_code": "805", "amount": -50000.00, "description": "Provision for marketing costs",  "tax_type": "NONE" }
  ]
}
```

**Sign convention:** positive = debit, negative = credit. Inherited from the
existing plugin deliberately, so the `journal-posting` skill and any CSVs
keep working unchanged.

**`status` defaults to `DRAFT`.** The current plugin defaults to `POSTED`;
this inverts it. Posting straight to a client ledger should be the explicit
choice, not the fallback.

#### Response — success

```jsonc
{
  "ok": true,
  "journal_id": "b1f2…",           // Xero ManualJournalID
  "journal_number": "MJ-0042",
  "status": "DRAFT",
  "audit_id": "aud_01J…",
  "net": 0.00,
  "idempotent_replay": false        // true if this key was already posted
}
```

#### Response — validation failure (422, nothing sent to Xero)

```jsonc
{
  "ok": false,
  "stage": "validation",
  "issues": [
    { "code": "UNBALANCED", "detail": "Debits 50000.00 != credits 49000.00, net 1000.00" },
    { "code": "UNKNOWN_ACCOUNT", "detail": "Account code 999 does not exist in FGH" }
  ]
}
```

#### Response — Xero rejection (502)

```jsonc
{
  "ok": false,
  "stage": "xero",
  "http_status": 400,
  "xero_error": { /* Xero's response body, VERBATIM */ },
  "audit_id": "aud_01J…"
}
```

> **Return Xero's body verbatim.** The current plugin calls
> `raise_for_status()` and discards it, which turned a one-line diagnosis
> (`invalid_grant: refresh token has been consumed`) into a multi-hour
> investigation. Never swallow the upstream error.

---

## 3. Validation

Run **all** of these before any call to Xero. Return every failure at once,
not just the first.

| Code | Rule |
|---|---|
| `UNBALANCED` | `sum(amount)` must be exactly `0`. Use integer minor units or `Decimal` — never float accumulation. |
| `NO_LINES` | At least 2 lines. |
| `ZERO_AMOUNT` | No line may be `0`. |
| `UNKNOWN_ACCOUNT` | Every `account_code` must exist in that entity's chart of accounts. |
| `ARCHIVED_ACCOUNT` | Account must be `ACTIVE`. (FGH has archived codes, e.g. 803.) |
| `BANK_ACCOUNT` | Reject manual journals to bank accounts — Xero rejects these anyway, better to catch early. |
| `PERIOD_LOCKED` | Reject if `date` falls on or before the entity's lock date. |
| `FUTURE_PERIOD` | Warn (do not block) if `date` is in a future period. |
| `DATE_FORMAT` | Strict `YYYY-MM-DD`. |
| `MATERIALITY` | Warn (do not block) above a per-client threshold. Surfaces to the approver rather than failing. |

`dry_run: true` runs every check and returns the would-be payload with
`"action": "DRY RUN — validated, not posted"`. No Xero call, no audit record
beyond a dry-run entry.

---

## 4. Idempotency

The `journal-posting` skill says *"never post the same journal twice"* but
gives no mechanism. Add one.

- `idempotency_key` is optional but **strongly recommended**; the MCP tool
  should always send one.
- Store `(client, entity, idempotency_key)` unique.
- On repeat with the same key: **do not post again.** Return the original
  result with `idempotent_replay: true`.
- On repeat with the same key but a *different* payload: reject `409`
  with both payloads in the response. That's a caller bug worth surfacing.

Suggested key format: `{entity}-{period}-{purpose}-v{n}`, e.g.
`fgh-2026-08-marketing-provision-v1`.

Independently, warn (don't block) if a journal with the same entity, date,
absolute amount and account pair already exists — catches duplicates posted
without a key.

---

## 5. Audit record

Written **before** the Xero call, updated after. A crash mid-call must leave
evidence.

```jsonc
{
  "audit_id": "aud_01J…",
  "created_at": "2026-08-14T15:04:05Z",
  "client": "feldspar-sport-group",
  "entity": "feldspar-group-holdings",
  "actor": { "type": "user|agent", "id": "nik@stza.io", "via": "cowork|ui|api" },
  "approved_by": "nik@stza.io",
  "approved_at": "2026-08-14T15:03:58Z",
  "idempotency_key": "fgh-2026-08-marketing-provision-v1",
  "reference": "WP-2026-08-014",
  "request_payload": { /* exactly as received */ },
  "validation": { "passed": true, "warnings": ["MATERIALITY: 50000.00 exceeds 25000.00 threshold"] },
  "xero_request": { /* exactly as sent */ },
  "xero_response": { /* exactly as received, success or failure */ },
  "journal_id": "b1f2…",
  "outcome": "posted|draft|failed|dry_run",
  "balances_before": { "400": 12000.00, "805": 0.00 },
  "balances_after":  { "400": 62000.00, "805": -50000.00 }
}
```

`balances_before` / `balances_after` make the skill's verify step a property
of the record rather than a separate manual check.

Retain for at least the statutory record-keeping period — six years for UK
companies, so align with whatever the platform already does for client data.

---

## 6. Token handling — the actual root cause

This is the part that must not be got wrong, because getting it wrong is
what produced this whole incident.

**Rules:**

1. **One holder.** Only os.stza.io holds Xero refresh tokens. No copies
   anywhere else, ever. Not in a config file, not on a laptop, not in a
   second app.

2. **Serialise the refresh.** The failure mode is: process A reads token,
   process B reads the same token, A refreshes (Xero rotates), B refreshes
   with the now-dead token. Take a lock across read-refresh-write.

   On GCP, any of:
   - Firestore transaction on the token document
   - Cloud SQL `SELECT … FOR UPDATE` on the token row
   - Secret Manager + a distributed lock

   The current plugin does read → POST → write with **no lock**, which is
   precisely this race.

3. **Persist before use.** Write the new refresh token to durable storage
   *before* using the access token for anything. If the API call fails you
   still hold a valid refresh token; if you write after, a crash loses it.

4. **Refresh proactively.** Access tokens last 30 minutes, refresh tokens
   60 days. Refresh on a schedule (say every 20 minutes of activity, or a
   daily keepalive) rather than only on demand — a 60-day idle gap kills
   the grant.

5. **Alert on failure.** An `invalid_grant` should page someone the day it
   happens, not surface a month later when someone tries to post a journal.
   This one went unnoticed from 12 July to 14 August.

6. **Never swallow the error body.** See §2.

---

## 7. Non-goals

- Not building a general Xero write API. Manual journals only, for now.
- Not migrating the read tools — they work.
- Not touching os.stza.io's existing OAuth grant or redirect URI.

---

## 8. Open questions

1. ~~**Does the platform's current Xero grant include
   `accounting.transactions`?**~~ **RESOLVED — and the question was wrong.**
   Verified against the code: `XERO_SCOPES` (`finance-api/server.js:367`)
   already includes **`accounting.manualjournals`**, requested from the start
   precisely so journals could be posted. The grant is *not* read-only and no
   re-consent is needed at the app level.

   `accounting.transactions` is absent, but that is the **legacy broad
   scope**. The platform app uses the post-March-2026 granular set, where
   manual journals are governed by `accounting.manualjournals`. **Do not add
   `accounting.transactions`** — it would widen the grant to invoices, bills
   and bank transactions for no reason and force re-consent across every
   connected entity.

   The remaining live question is per-entity, not per-app: scopes are
   recorded at connect time in `accounting_system_config.scopes`. Any entity
   connected *before* `accounting.manualjournals` was added still holds the
   old grant and needs reconnecting. Audit that against the DB before the
   first write.
2. **Where does approval live?** The `journal-posting` skill requires
   explicit human approval before posting. Is that captured in the platform
   UI, or asserted by the caller? The audit record assumes the latter for
   now; the former is stronger.
3. **Per-client materiality thresholds** — where configured?
