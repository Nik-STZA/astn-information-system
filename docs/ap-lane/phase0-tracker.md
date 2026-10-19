# Portal Xero parity: tracker

Last updated 19 Oct 2026. Goal: os.stza.io does everything the laptop MCP does
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
| 6 | Capability checks you can re-run | `finance-api/scripts/xero-read-check.js`, `xero-write-check.js` and `xero-confirmed-check.js` |
| 7 | Writes that need confirmation (post, send, settle, setup, conversion), journals from file (the Feldspar payroll CSV) and `post_journal` as JSON. Codes live in `finance.write_confirmations`. | PR #36, merged 19 Oct. Migration 018 applied to prod 19 Oct, before the merge. |
| 8 | Laptop MCP as a thin client: `STZA_TOOLSET=practice` in `finance-api/mcp-server` | PR #39 (replaced #37, which GitHub closed when #36's branch was deleted), merged 19 Oct |
| 9 | CI parity test (all 74 laptop tools mapped to portal routes) and `check_bill` on the portal | In PR #36 |
| 10 | Confirmed-tier check run live, dry runs and refusals only: STZA 17/17, Feldspar Group Holdings 9/9, Feldspar Ltd 9/9, Ultraspeed Digital 11/11 | 19 Oct, after the script fixes in PR #38 |
| 11 | STZA-TEST records from 16 Oct deleted, contact archived | Nik, 19 Oct |

## Waiting on Nik

- [ ] Post the live confirmed-tier test journal on STZA and then void it. The dry run
  passed on 19 Oct (Dr 429 / Cr 404, 0.01, POSTED, narration "STZA-TEST 2026-10-19
  confirmed-tier live test (void me)"). Nothing in PR #36 has been redeemed live yet.
- [ ] Decide on the Xero connection limit. The app is at 5 of 5 connections. Adding
  payment details (Core tier, AUD 35/mo) is needed before a 6th client or the Demo
  Company.
- [ ] Decide when to switch Claude Desktop from the laptop `stza-xero` to `stza-xero-portal`.
- [ ] Give STZA's Round Money Market bank account a code in Xero, or ask for the write
  routes to accept an AccountID. Today the settle routes name bank accounts by Code only,
  so an account without one cannot be used.

## Still to do in phase 0

| # | What | Notes |
|---|------|-------|
| 12 | Live redemption test | See "Waiting on Nik". Also proves single use: re-sending the same code must be refused. |
| 13 | Settle cap test | The 5,000.00 STZA cap has not really been exercised. The only open STZA bill is 7.80, so "over the cap" was refused as "more than outstanding". It needs a bill over 5,000. |
| 14 | STZA payroll controls | STZA runs payroll in Xero. Payroll reads already pass, so this adds payroll-to-ledger checks. |
| 15 | Switch-over | Run the two Desktop servers side by side, then remove the laptop one and retire the laptop's Xero grant. |

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
