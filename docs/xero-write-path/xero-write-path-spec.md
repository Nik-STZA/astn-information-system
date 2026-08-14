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
| Xero app | `8A909173…` | `8EA540A6…` — **different app** |
| Capability | Read only | Read (duplicated) + **write** |
| Audit trail | Platform | None |
| Status 14 Aug 2026 | Working | Dead since ~12 July |

**Correction, verified 14 August 2026.** These are **different Xero apps** —
platform `8A909173…`, plugin `8EA540A6…`, confirmed against Secret Manager.
Different apps have independent refresh-token lineages, so the platform never
consumed the plugin's tokens and could not have. The original premise here was
wrong.

What is still true, and still the reason to consolidate: the ~22 programs in
XERO REPORTING all share **one** app and the same three config files. Xero
rotates the refresh token on every refresh and invalidates the old one after a
30-minute grace period, so those 22 do invalidate each other. The collision is
real but entirely local to the plugin side. The last-saved timestamps
(UDL 12:58:13, FSL 13:00:25, FGH 13:01:12) look like one sequential loop over
the three entities, consistent with a local batch run rather than anything the
platform did.

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
  "approval": {                         // REQUIRED - see §5
    "approved_by": "nik@stza.io",
    "approved_at": "2026-08-14T15:03:58Z",
    "via": "cowork",
    "presented_text": "Post to Feldspar Group Holdings, 31 Aug 2026:\n  Dr 400 Marketing provision - Aug 2026  50,000.00\n  Cr 805 Provision for marketing costs   50,000.00\nStatus: DRAFT. Net 0.00.",
    "agreed_text": "approved"
  },
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

**`approval` is required, including on `dry_run`.** There is no default and no
way to omit it. A caller that cannot supply one cannot post — which is the
point: the field is the assertion, and the endpoint's job is to make asserting
it unavoidable and permanent.

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
| `MATERIALITY` | Warn (never block) above the threshold, which is **£1** — see §8.3. In practice every journal warns, and that is the intent: the warning carries the amount into `presented_text` so the approver always sees the size of what they are agreeing to. |
| `MISSING_APPROVAL` | `approval` absent, or missing any of `approved_by`, `approved_at`, `presented_text`, `agreed_text`. |
| `APPROVAL_STALE` | `approved_at` is more than 30 minutes before the request, or in the future. An approval agreed hours earlier was agreed to a different set of numbers. |
| `APPROVAL_MISMATCH` | `presented_text` does not contain the entity, date, net and every account code in `lines`. Catches a payload edited after it was shown to the human — the one failure the assertion model cannot otherwise detect. |

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
  "approval_payload": {
    "approved_by": "nik@stza.io",
    "approved_at": "2026-08-14T15:03:58Z",
    "via": "cowork",
    "presented_text": "Post to Feldspar Group Holdings, 31 Aug 2026:\n  Dr 400 …  50,000.00\n  Cr 805 …  50,000.00\nStatus: DRAFT. Net 0.00.",
    "agreed_text": "approved"
  },
  "idempotency_key": "fgh-2026-08-marketing-provision-v1",
  "reference": "WP-2026-08-014",
  "request_payload": { /* exactly as received */ },
  "validation": { "passed": true, "warnings": ["MATERIALITY: 50000.00 exceeds 1.00 threshold"] },
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

### Where approval lives — decided 14 August 2026

**Approval is captured in Claude Cowork, transmitted with the write, and
persisted here. The platform builds no approval UI.**

The human sees the rendered journal in Cowork and agrees there. The MCP tool
sends what was shown and what was said as `approval.presented_text` and
`approval.agreed_text`, and the platform stores them verbatim in
`approval_payload`.

**Why the full payload rather than a boolean, or a bare `approved_by`.** Cowork
sessions are ephemeral; `finance.audit_log` is not. The question three years
from now is *who approved this £50,000 provision, and what exactly did they
see when they did* — and "it was in a chat that no longer exists" is not an
answer to an auditor, an insurer, or a client. A boolean records that someone
clicked; the payload records what they agreed to. Only the second survives the
session it was created in, and only the second distinguishes approving *this*
journal from approving *a* journal.

**What this record is, and is not.** It is the platform's immutable evidence of
what the FD asserted at the moment of posting. It is **not** a guarantee that
approval genuinely occurred — the platform cannot observe a Cowork
conversation, and nothing in this design pretends otherwise. That is the
correct liability position for a subscription product: STZA provides the
instrument and the record; the practitioner carries the assertion. Anything
stronger would be the platform vouching for a human interaction it never saw.

`APPROVAL_MISMATCH` in §3 is what stops the assertion drifting from the
instrument. Everything else here is trust; that check is not.

**Consequence for retention:** `approval_payload` is the part of the record with
evidential value, so it inherits the six-year retention below rather than any
shorter operational log policy. Do not truncate `presented_text`.

Retain for at least the statutory record-keeping period — six years for UK
companies, so align with whatever the platform already does for client data.

### Ordering constraint: get the token before opening the audit transaction

**Acquire the Xero access token *before* opening the audit transaction, never
inside it.**

`refreshAccessToken()` checks out its own pooled connection to take
`pg_advisory_xact_lock`. The audit record is written on a second checked-out
connection. The obvious implementation — open the audit transaction, write the
"before" row, then call Xero — therefore holds one connection while waiting for
a second.

`finance-api` runs with `pool.max = 5` and no `--concurrency` flag, so Cloud Run
allows 80 concurrent requests per instance. Five simultaneous journal posts
would each hold one connection and each wait for a second that cannot come:
every connection is held by a request waiting for one. That is a self-deadlock,
and it resolves only when `connectionTimeoutMillis` (10s) fires on all five.

The order that works:

```js
const ctx = await xeroEntityContext(slug, entity);   // token acquired, connection released
const conn = await pool.connect();                   // now open the audit transaction
```

No caller violates this today — the only two call sites reach
`refreshAccessToken()` via `pool.query()`, which releases between statements.
The journal endpoint is the first thing that will naturally get it wrong.

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

   The remaining per-entity question is also now **RESOLVED**. Audited against
   the live database, 14 August 2026: all four connected entities
   (`feldspar-group-holdings`, `feldspar-ltd`, `ultraspeed-digital`, `stza`)
   hold `accounting.manualjournals`. None was connected before it was added,
   and **none needs reconnecting to post**. The only scope difference between
   them is `openid`, absent from the two 30 July connections — not an
   accounting scope, but the reason those two returned no `id_token` and so no
   `authentication_event_id` for `selectTenant` to match on.

   **Separately, three read scopes are missing** and gate the script migration
   rather than the write path. See §9.
2. ~~**Where does approval live?**~~ **RESOLVED, 14 August 2026.** Captured in
   Claude Cowork, transmitted with the write, persisted by the platform. No
   platform approval UI. `approval` is a required request field and the audit
   record stores the full `approval_payload`, not a boolean. See §5.
3. ~~**Per-client materiality thresholds**~~ **DECIDED, 14 August 2026: £1.**

   Not a per-client figure and not an audit-materiality judgement. **£1 means
   every journal carries materiality context into `presented_text`**, so the
   approver always sees the size of what they are agreeing to, stated the same
   way every time.

   It is a rule rather than a threshold, and deliberately so while the write
   path is new: a threshold that silences most journals would mean the first
   journal to trip it is also the first one anyone reads carefully. Uniform
   output is what makes an unusual number visible. Revisit once the system has
   earned trust — the value is one constant, and raising it later costs
   nothing. Lowering it after a miss costs a great deal more.

   `MATERIALITY` therefore warns on effectively every journal and must never
   block. Do not treat a universal warning as noise to be suppressed; it is the
   context line, not an exception report.

---

## 9. Read scopes gating the script migration

Not required for the write path — `accounting.manualjournals` is already held
everywhere (§8.1). These gate migrating the 21 reporting scripts off their own
credentials, which is the other half of removing the second credential holder.

Verified against the live grants and the endpoint inventory, 14 August 2026:

| Passthrough entry | Xero endpoint | Scope required | Callers in migrating scripts |
|---|---|---|---|
| `payments` | `/Payments` | `accounting.payments.read` | `xero_payments_to_sheets.py` |
| `executive-summary` | `/Reports/ExecutiveSummary` | `accounting.reports.executivesummary.read` | `append_xero_livecheck.py` |
| `journals` | `/Journals` | `accounting.journals.read` | `append_category_supplier_tabs.py`, `monthly_close.py` |

**One reconnection per entity covers all three.** Scopes are granted per
authorisation, not per scope, so adding all three to `XERO_SCOPES` and
reconnecting each of the four entities once grants the lot. Four consent
screens total, not twelve — and it is the same reconnection, so do it once and
add anything else wanted at the same time rather than in a second pass.

Two cautions before scheduling it:

- **`accounting.journals.read` may carry a Xero plan requirement.** Third-party
  scope documentation notes it as needing an Advanced tier. Unverified against
  Xero's own docs, and it decides whether `/Journals` is reachable at all for a
  given client — check before promising the two scripts that depend on it.
- **`accounting.reports.read` is discontinued** under the granular model, so
  there is no umbrella that grants all reports. Each report needs its own
  scope, and any report without a granular equivalent has no path at all. That
  is what removed `/Reports/BudgetSummary` and `/Reports/AccountTransactions`
  from the allowlist — the latter is not a Xero endpoint in any case
  (`xero-server.py:590`).
