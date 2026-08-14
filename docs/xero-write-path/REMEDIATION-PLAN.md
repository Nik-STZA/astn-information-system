# Xero integration — what needs fixing

Consolidated from the 14 August 2026 investigation (Cowork session +
Claude Code repo read). Ordered by priority, not by effort.

Context: a journal could not be posted because all three local Xero configs
had been dead since 12 July with `invalid_grant: refresh token has been
consumed`. Nobody noticed for five weeks. Investigating that surfaced the
rest.

---

## P0 — Security. Today.

### 0.1 `example.json` may have leaked live credentials
`configs/example.json` contains what appear to be **real populated
credentials**, and unlike the other configs it is **not gitignored**.

```
git log --all --oneline -- '*example.json'
git log --all -p -- '*example.json' | grep -i "client_secret"
```

If it was ever committed, the secret is compromised — private repos are not a
control. Rotate at developer.xero.com and update Secret Manager.
**This outranks everything else here.**

### 0.2 Plaintext credentials on a laptop
`feldspar_holdings.json`, `feldspar_ltd.json`, `ultraspeed.json` each hold
plaintext `xero_client_id`, `xero_client_secret`, `xero_refresh_token` —
client secret identical across all three (one Xero app, three tenants) —
covering three client ledgers.

### 0.3 Cached access tokens persisted to disk
Each config also caches `xero_last_access_token` (~1,410 chars). Access tokens
are bearer credentials. Never persist them. Remove the field and the code
that writes it.

### 0.4 Working data sharing a directory with secrets
`assumptions.json`, `dashboard_2026-05/06.json`, `highlights_2026-05/06.json`,
`variance_evidence_2026-05.json`, `balance_control_ack.json` sit in `configs/`
beside the credentials. Move them out. Independent of everything else, five
minutes, reduces blast radius.

---

## P1 — The outage and its siblings

### 1.1 `refreshAccessToken()` is not serialised — THE ROOT CAUSE
`finance-api/server.js:407`. Sequence is read secret → POST to Xero → store
rotated token, with **no lock**. Two concurrent callers both read version N,
both refresh, the loser's token is dead on arrival. Xero rotates on every
refresh and invalidates the predecessor.

Fix with `pg_advisory_xact_lock` — already used in this codebase at
`server.js:1104` and `:1129` for diary and sync. Same pattern.

*Already correct, don't touch:* the rotated token is persisted before the
access token is used (`:434-437`), a deliberate decision per the comment at
`:399-406`.

### 1.2 Xero's error body is swallowed — in both systems
- `finance-api/server.js:424-431` — logs 200 chars to console, throws
  `ErpUnavailable("The Xero connection has expired…")`. Caller never sees
  `invalid_grant: refresh token has been consumed`.
- `xero-server.py:113` — `raise_for_status()` and discard.

This single behaviour turned a one-minute diagnosis into an afternoon.
Keep the friendly message for the UI; attach the raw body for API callers and
logs. The OAuth callback path at `:512` can stay as-is — that body reaches a
browser.

*Worth copying:* the plugin's `post_journal` captures `r.text[:500]` on
non-2xx rather than discarding it. That habit is what `finance-api` lacks.

### 1.3 No alerting
`console.error` only. A dead Xero connection should page someone the day it
happens. Five weeks of silence is the defect under the defect.

### 1.4 `normaliseIp()` not applied
`server.js:317` and `:329` pass `req.get("X-Forwarded-For")` raw. `ip_address`
is a Postgres `inet` and takes exactly one address; a chain throws and rolls
back the enclosing transaction. Already documented at `lib/xero.js:60-67` —
a bad audit value once destroyed the Xero connection it was recording.

---

## P2 — The architecture

### 2.1 Two credential holders for one Xero app
os.stza.io (Secret Manager, versioned, rotating) and the local plugin
(JSON files, stale since 12 July). If both use the same Xero app —
**still unverified**, needs `xero-app-client-id` from Secret Manager; plugin
client_id begins `8EA540A6` — then reconnecting a tenant revokes the other
holder's token. That fits the evidence exactly: all three configs died within
a three-minute window.

**Resolve this first.** If the apps differ, the cause is something else and
consolidation may not fix it.

### 2.2 Build the write path on the platform
`POST /api/finance/xero/journals` in `finance-api`, per
`xero-write-path-spec.md`: validate before any Xero call, idempotency keys,
audit rows opened before and closed after, error bodies passed through.

Extend `finance.audit_log` — two rows sharing `target_id`. No new table.

### 2.3 Add `post_journal` to the existing stza-finance MCP server
It exists — registered in the Claude desktop app, not in the repo, proxied as
`mcp__remote-devices__stza-finance__*`. Verified working 14 Aug while the
plugin was dead. Don't build a new server.

Signature: keep the plugin's shape so re-homing is cheap. Add `client`,
`idempotency_key`, `reference`. **Change `status` default from `POSTED` to
`DRAFT`** — writing to a client ledger should be deliberate.

### 2.4 Unexplained: what serves `get_trial_balance`?
It returns live Xero report data, but no ledger-read routes were found among
`finance-api`'s 20. Either the inventory missed a Xero reports proxy, or
stza-finance has a second backend. **Answer this before building alongside
it.**

### 2.5 Re-home the journal-posting skill
It ships inside the stza-xero plugin (`skills/journal-posting/SKILL.md`) and
disappears when the plugin goes. Move it into `stza-finance-agents/skills/`.

### 2.6 Decommission the plugin — last, not first
`xero-server.py` is the entire read path (~30 tools: `get_accounts`,
`list_entities`, `get_trial_balance`, `post_journal` at :830,
`post_journal_from_csv`). It cannot be archived until its readers are
replaced. Order: ship endpoint → ship MCP tool → verify with a dry run →
post one real DRAFT → *then* uninstall the plugin and delete local
credentials.

---

## P3 — Correctness and hygiene

- **Scope audit.** `accounting.manualjournals` is present at
  `server.js:367` and is the correct granular scope. **Do not add
  `accounting.transactions`** — legacy broad scope, would widen the grant and
  force re-consent everywhere. But scopes are recorded per entity in
  `accounting_system_config.scopes` at connect time: any entity connected
  before that scope was added still holds the old grant. Check per entity
  before the first write. Needs DB access.
- **No duplicate-posting protection.** The skill says "never post the same
  journal twice" with no mechanism. Idempotency keys, spec §4.
- **`list_entities` reports dashboards as Xero organisations** — the plugin
  treats every `.json` in `configs/` as an entity config. Fixed by 0.4;
  moot after 2.6.
- **Doc drift.** The plugin README says re-run `xero_auth.py` with no path;
  it's at `scripts/xero_auth.py` alongside `scripts/xero_authorize.py`, and
  the configs README correctly points at `scripts/xero_authorize.py`. Make
  the plugin README match.
- **Balance tolerance.** Plugin uses `abs(total) > 0.01` on floats. Use
  integer minor units or `Decimal` in the new endpoint.

---

## Sequence

1. `example.json` git history → rotate if exposed *(P0)*
2. Move working data out of `configs/` *(P0, independent)*
3. Advisory lock on the refresh; error bodies through; alerting *(P1 — unblocks the outage)*
4. `normaliseIp()` *(P1, small)*
5. Confirm same-app hypothesis; answer the `get_trial_balance` question *(P2, investigation)*
6. Endpoint → MCP tool → skill re-home *(P2, build)*
7. Verify, then decommission the plugin and delete local credentials *(P2, last)*
8. Scope audit before the first real write *(P3, blocking that one step)*
