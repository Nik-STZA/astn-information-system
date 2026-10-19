# Portal Xero parity: tracker

Last updated 18 Oct 2026 (evening). Goal: os.stza.io does everything the laptop MCP does
(and more), with STZA's method staying server-side. Detail lives in
`ap-lane-spec.md` (the spec) and `xero-capability-register.md` (test evidence).

## Rules that apply throughout

- Live write tests run on the **STZA organisation only**. Records stay in draft and
  are labelled `STZA-TEST <date>`. Nik voids or deletes them himself. No write
  tests on Feldspar or Aspire.
- Writes that cannot stay in draft are never run live without asking Nik first.
  These are payments, bank transactions, transfers, allocations, emailing,
  settings and conversion balances.
- Nik merges PRs: `! gh pr merge N --squash --delete-branch --repo Nik-STZA/astn-information-system`.
- The finance-api key comes from Secret Manager and is never written to a file.

## Done

| # | What | Evidence |
|---|------|----------|
| 1 | Portal asks Xero for the same 23 scopes as the laptop | PR #30, merged 16 Oct |
| 2 | All 4 portal entities reconnected with the 23 scopes | 16 Oct, 16:30–16:37 |
| 3 | One reconnect updates every entity of a client (shared token) | PR #31 |
| 4 | Read parity: 44 resources and 8 reports | PRs #32 and #33. STZA passes 81/81. Feldspar fails only on payroll, which is expected because its payroll is run outside Xero. |
| 5 | Note and draft writes: contacts, draft bills, invoices and credit notes, history notes, attachments, Files inbox upload, Match, linked transactions | PRs #34 and #35. Proven live on STZA on 16 Oct. |
| 6 | Capability checks you can re-run | `finance-api/scripts/xero-read-check.js` and `xero-write-check.js` |

## Waiting on Nik

- [ ] Delete the STZA-TEST records in STZA's Xero:
  - bill `de21c20e-1433-406a-9868-226b5f1c0cee` (deleting it also removes its linked transaction)
  - credit note `dee937ba-0203-431c-9f77-6a5558307850`
  - archive contact `d50b49d1-8134-442e-a71f-6d657de8f897`
  - delete files `ce9b6c7a-0df2-428d-aacc-a27971111a0f` and `eb23de8f-4567-4208-92ec-33aa7b7298ce`
- [ ] Decide on the Xero connection limit. The app is at 5 of 5 connections. Adding
  payment details (Core tier, AUD 35/mo) is needed before a 6th client or the Demo
  Company.
- [ ] Run `! gcloud auth login --update-adc`. The login expired on 18 Oct, which blocks the migration and the live checks.
- [ ] Merge PR #36 once migration 018 is applied (see "In flight"), then PR #37.
- [ ] Say "go" for one live redemption test on STZA. For example, post a 0.01 STZA-TEST journal and void it. Nothing in PR #36 has been redeemed live yet.
- [ ] Decide when to switch Claude Desktop from the laptop `stza-xero` to `stza-xero-portal`.

## In flight (18 Oct 2026)

| # | What | State |
|---|------|-------|
| 7 | Writes that need confirmation (post, send, settle, setup, conversion), plus journals from file (the Feldspar payroll CSV) and `post_journal` as JSON | PR #36, CI green. Migration 018 must be applied before merge: it adds `finance.write_confirmations` and sets `write_policy` (Feldspar post on; STZA post and settle on). |
| 9 | CI parity test: all 74 laptop tools mapped to portal routes (`lib/laptop-parity.js`), and `check_bill` ported to the portal | In PR #36 |
| 8 | Laptop MCP as a thin client: `STZA_TOOLSET=practice` in `finance-api/mcp-server` | PR #37, which builds on #36. Rebase onto main after #36 merges. |

After merging: run `FINANCE_API_KEY=... node scripts/xero-confirmed-check.js stza stza`, then the same for each Feldspar entity. These are dry runs and refusals only.

## Still to do in phase 0

| # | What | Notes |
|---|------|-------|
| 10 | STZA payroll controls | STZA runs payroll in Xero. Payroll reads already pass, so this adds payroll-to-ledger checks. |
| 11 | Commit `docs/ap-lane/` | The spec, register and this tracker are still uncommitted. Commit them when Nik asks. |
| 12 | Switch-over | Run the two Desktop servers side by side, then remove the laptop one and retire the laptop's Xero grant. |

## After phase 0 (AP lane and backlog)

- AP lane phases 1–4, from spec section 5 onwards: data sync, then the supplier
  master (identity, VAT, default GL), then extraction with computed checks, then
  queue, approve and write. Phase 2 passes when a replay of the 12 Oct UDL batch
  flags all five known errors.
- Q4b: FSL reverse charge on Asian Capital Partners (HK).
- Supplier master clean-up (dormant suppliers).
- Runner token trims.
- Security clean-up:
  - rotate keys;
  - the processing register still says Vertex;
  - get os.stza.io categorised so the HSBC firewall stops blocking it.
- UX/UI pass on the portal.

## Known Xero limits (not gaps)

Xero refuses these for this app on the laptop too:

- receipts, expense claims and the published reports list (401);
- `/Users/{id}` (404);
- Feldspar payroll (not provisioned).

`/Journals` is not available to either the laptop or the portal.
