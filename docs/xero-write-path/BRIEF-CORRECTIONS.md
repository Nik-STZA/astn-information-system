# Corrections and answers — Xero write path

Response to Claude Code's investigation report, 14 August 2026.
Read this **with** `xero-write-path-spec.md` in the same folder; where they
conflict, this file wins.

---

## 0. The spec exists — you searched before it was written

`xero-write-path-spec.md`, `xero_journals_endpoint.py`,
`stza_finance_post_journal_tool.py` and `CLAUDE-CODE-BRIEF.md` are at:

```
C:\Users\yogim\STZA Group\portal\xero-write-path\
```

They were written to disk mid-conversation, after your search. Not in
`astn-information-system` — I didn't have access to that tree.

**Ignore the language of `xero_journals_endpoint.py`.** It is FastAPI because
I was told the stack was "Python, I think". You've established it's Express in
`finance-api/`. The file is a *contract* — validation ordering, idempotency
semantics, response shapes, audit lifecycle. Port the behaviour, discard the
Python.

---

## 1. Corrections I accept

You read the code; I was inferring from the outside. These are all yours:

- **Repo.** `astn-information-system`, Xero code in `finance-api/` (Express,
  `stza-finance-api`). Not `stza-ops` — that's a bare Next.js scaffold with
  no finance routes, untouched since May.
- **Persist-before-use is already correct** (`server.js:434-437`). Only the
  lock is missing. Three of my four token items were already done.
- **`pg_advisory_xact_lock` is already in the codebase** (`server.js:1104`,
  `:1129`). Use the existing pattern; don't introduce a new primitive.
- **Secret Manager versions rather than overwrites** — rotation history is
  already auditable. Better than I assumed.
- **`finance.audit_log` exists.** Extend it, two rows sharing `target_id`.
  No new table.
- **The `normaliseIp()` trap** (`lib/xero.js:60-67`) — a bad audit value
  rolling back the transaction it was recording is exactly the class of bug
  worth stopping. Fix `server.js:317` and `:329` while you're in there.
- **`xero-server.py` is live, not dead.** It holds `_refresh_token()` at :104,
  `post_journal` at :830 and ~30 other tools. My step 6 was wrong — do not
  archive it until its readers are replaced.
- **`scripts/xero_auth.py` and `scripts/xero_authorize.py` both exist.** My
  claim that the README pointed at a missing script was wrong: I ran
  `Get-ChildItem -Filter *.py` at the folder root only, which doesn't recurse
  into `scripts/`. The README is correct.

## 2. The scope correction — you're right and it matters

`accounting.manualjournals` is present at `server.js:367` and is the correct
granular scope post-March-2026. **Do not add `accounting.transactions`.** My
spec §8 said to check for it; that was wrong and would have widened the grant
across invoices, bills and bank transactions and forced re-consent on every
entity. §8 has been rewritten.

Your per-entity caveat is the live risk: entities connected before
`accounting.manualjournals` was added still hold the old grant. That's the
scope audit in §4 below.

---

## 3. Where I think you're wrong: stza-finance exists

**It is registered in the Claude desktop app, not in any repo MCP config.**
It reaches this session proxied through the device bridge as
`mcp__remote-devices__stza-finance__*`. Searching the repo would never find
it.

I called it twice today. At ~15:30 it returned FGH's live trial balance as at
31 Aug 2026 (Advertising & Marketing (400) £12,000 YTD Dr; total
£744,180.22 both sides). Just now `list_clients` returned:

```
feldspar-sport-group   FRS 102   open_item_count 17   p1_count 4
sandbox-test-group     FRS 102   open_item_count 0
stza                   FRS 105   open_item_count 0
```

`open_item_count`, `p1_count`, `close_cadence`, `framework` are **platform DB
fields** — they map onto the clients and open-items routes you listed. So
stza-finance is backed by `finance-api`, not by `xero-server.py`.

Its tool surface: `list_clients`, `list_entities`, `get_accounts`,
`get_trial_balance`, `get_balance_sheet`, `get_profit_and_loss`,
`get_aged_payables`, `get_aged_receivables`, `get_bank_summary`. All reads.

**The decisive fact:** these worked all afternoon while all three plugin
configs were dead with `invalid_grant`. Two independent credential paths, one
healthy. That is the whole argument for consolidating onto the platform, and
it's now evidenced rather than assumed.

**Open question this raises for you:** `get_trial_balance` returns live Xero
report data, but you found no ledger-read endpoints in `finance-api`'s 20
routes. Something serves it. Worth finding before building alongside it —
either the route inventory missed a Xero reports proxy, or stza-finance has a
second backend. Don't build the write path until you know which.

---

## 4. Answers to your three blockers

**1. The spec** — path above. Idempotency semantics §4, response shapes §2,
audit fields §5, validation §3.

**2. Where `post_journal` lives** — add it to the existing stza-finance MCP
server. Do not build a new one. Find it via the Claude desktop app's MCP
configuration (`claude_desktop_config.json` or the Cowork plugin registry),
not the repo. Endpoint in `finance-api`, tool wrapper on stza-finance,
matching the existing read tools' `client` + `entity` slug convention.

**3. Scope audit** — agreed, and it's a human task with DB access, not yours.
Blocks the first write, nothing before it.

**On the journal-posting skill:** you're right that it isn't in
`stza-finance-agents\skills\`. It ships inside the **stza-xero plugin**
(`skills/journal-posting/SKILL.md`) — prepare → present → approve → post →
verify. That's why it disappears when the plugin is decommissioned, and why
it needs re-homing into `stza-finance-agents` as part of this work. My "keeps
working unchanged" was wrong; keeping the **argument shape** unchanged is
what makes re-homing cheap.

Correct current signature, per your read:
`post_journal(entity, narration, date, lines, status="POSTED", dry_run=False)`,
balance tolerance `abs(total) > 0.01`. Keep the shape; change `status` to
default `"DRAFT"`; add `client`, `idempotency_key`, `reference`.

Keep its one good habit — capturing `r.text[:500]` on non-2xx rather than
discarding it. That's the behaviour `finance-api` is currently missing.

---

## 5. Green light

Start on the three unblocked items now:

1. **Serialise `refreshAccessToken()`** under `pg_advisory_xact_lock`, using
   the `server.js:1104` pattern. This is the outage.
2. **Pass Xero's error body through** (`server.js:424-431`). Keep
   `ErpUnavailable`'s friendly message for the UI, attach the raw body for
   API callers and logs. The callback path at `:512` can stay as it is —
   agreed that a browser-facing body is a defensible exception.
3. **Alert on `invalid_grant`.** Five weeks of silent breakage is the
   defect under the defect.

Plus, independently: **step 5, move working data out of the configs
directory** — `assumptions.json`, `dashboard_*.json`, `highlights_*.json`,
`variance_evidence_*.json`, `balance_control_ack.json` sitting beside
plaintext secrets.

**Escalated to urgent:** `example.json` holding real credentials and **not
gitignored**. Check git history immediately —
`git log --all --oneline -- '*example.json'`. If those credentials were ever
committed, they are compromised regardless of what the file looks like now,
and the secret must be rotated at developer.xero.com. That outranks
everything else in this document.

Also worth noting from your findings: all three configs cache
`xero_last_access_token` (~1,410 chars) on disk. Access tokens are bearer
credentials. They should never be persisted.

---

## 6. Still unverified

Whether the plugin app and the platform app are the same Xero app — needs
`xero-app-client-id` from Secret Manager. Plugin client_id starts `8EA540A6`.
If they match, the mechanism is confirmed: reconnecting an already-connected
tenant under the same app revokes the prior refresh token, which is what
killed all three configs on 12 July within a three-minute window.

If they *don't* match, the cause is different and worth understanding before
we assume consolidation fixes it.
