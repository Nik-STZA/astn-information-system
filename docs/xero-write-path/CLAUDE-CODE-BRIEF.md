# Brief for Claude Code — Xero write path on os.stza.io

Hand this to Claude Code working in the os.stza.io repository, together with
`xero-write-path-spec.md`, `xero_journals_endpoint.py` and
`stza_finance_post_journal_tool.py`.

The reference files were written **without repo access**. They are a
contract and a set of hard-won constraints, not code to paste. Match the
repo's actual conventions; keep the behaviour.

---

## Paste this into Claude Code

> We need to move Xero journal posting into this platform. Right now it lives
> in a local MCP plugin on an analyst laptop that holds a duplicate copy of
> OAuth refresh tokens for the same Xero app this platform uses. Because Xero
> rotates the refresh token on every refresh, the two holders invalidate each
> other — the local copies died on 12 July 2026 with
> `invalid_grant: refresh token has been consumed` and nobody noticed until
> 14 August. We are removing the second holder, not re-authorising it.
>
> Read `xero-write-path-spec.md` first — it has the full contract.
>
> Before writing any code, investigate and report back on:
>
> 1. **Where and how Xero OAuth tokens are currently stored and refreshed.**
>    Find the code behind `/api/finance/xero/callback`. I need to know the
>    storage backend, whether the refresh is serialised with any lock, and
>    whether the rotated refresh token is persisted before or after the
>    access token gets used.
> 2. **What scopes the current Xero grant holds.** If `accounting.transactions`
>    is absent, the grant was read-only and adding write scope needs a
>    conscious decision plus re-consent — flag it, don't just add it.
> 3. **How the existing read endpoints are structured** (the ones behind
>    `get_trial_balance`, `get_accounts`, etc. on the stza-finance MCP
>    server) — I want the new write endpoint to look like its neighbours.
> 4. **Whether an audit/event table already exists** that the journal audit
>    record should extend rather than duplicate.
>
> Then implement:
>
> - `POST /api/finance/xero/journals` per the spec — validation before any
>   Xero call, idempotency keys, audit record opened before the call and
>   closed after, Xero's error body returned verbatim.
> - A `post_journal` tool on the stza-finance MCP server matching the
>   argument shape in `stza_finance_post_journal_tool.py`, so the existing
>   `journal-posting` skill keeps working unchanged.
> - Serialised token refresh, if it isn't already. This is the actual bug.
>   Read → refresh → persist must happen under a lock, and the rotated
>   refresh token must be persisted before the access token is used.
> - Alerting on `invalid_grant`. A dead Xero connection should page someone
>   the same day.
>
> Tests I care about: unbalanced journal rejected before any Xero call;
> replayed idempotency key does not double-post; concurrent refresh does not
> consume a token twice; Xero error bodies reach the caller intact.
>
> Note `status` defaults to `DRAFT`, inverting the old plugin's `POSTED`
> default. That is deliberate.

---

## Migration and decommission

Do these in order. Do not skip step 4.

1. **Ship the endpoint and the MCP tool.** Both live alongside the existing
   read path; nothing is removed yet.
2. **Verify with a dry run** against FGH: `dry_run: true` on a balanced
   two-line journal. Confirm validation catches an unbalanced one.
3. **Post one real DRAFT journal** end to end, and confirm the audit record
   captured actor, payload, Xero response and before/after balances.
4. **Only then, decommission the local plugin:**
   - Uninstall the `stza-xero` plugin from Cowork.
   - Delete `C:\Users\yogim\Feldspar_Project\XERO REPORTING\configs\*.json`
     credentials — client secrets and refresh tokens for three client
     ledgers currently sit there in plaintext.
   - Revoke any Xero app credentials that existed solely for the plugin.
5. **Tidy the configs folder regardless of the above.** It currently mixes
   credentials with working data — `assumptions.json`,
   `dashboard_2026-05.json`, `highlights_2026-06.json`,
   `variance_evidence_2026-05.json`, `balance_control_ack.json`. The plugin
   treated every `.json` in there as a Xero entity config, which is why
   `list_entities` reported dashboards as organisations. Move working data
   out of any directory that holds secrets.
6. **Archive `xero-server.py`** (86KB, no OAuth code in it) once nothing
   references it, and remove the README's instruction to "re-run
   `xero_auth.py`" — that script does not exist in the folder.

---

## Constraints worth restating

**One holder for the refresh token.** Every incident in this saga traces
back to two systems holding credentials for one Xero app. Do not solve a
future problem by making a second copy — not a second app, not a cached
token, not a config file.

**Never swallow the upstream error.** The old plugin called
`raise_for_status()` and discarded the response body, so
`invalid_grant: refresh token has been consumed` surfaced as
`400 Bad Request`. That single decision turned a one-minute diagnosis into
an afternoon.

**Fail loudly on a dead connection.** A month of silent breakage is the
real defect here. The journal that prompted all this was blocked by an
outage that started five weeks earlier and never alerted anyone.
