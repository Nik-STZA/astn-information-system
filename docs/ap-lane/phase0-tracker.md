# Portal Xero parity: tracker

Last updated 19 Oct 2026 (evening). Goal: os.stza.io does everything the laptop MCP does
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
| 12 | First live confirmed-tier writes: STZA-TEST journal `76e5c8a2-e1a5-424d-aa0c-43be37a682c3` (Dr 429 / Cr 404, 0.01) posted with code `985a34326b`, then voided through the portal with code `f12aa1a6c0`. Both codes are recorded as consumed once, by nik@stza.io. Xero history shows both notes. | Nik ran it, 19 Oct 15:09 |
| 13 | STZA payroll-to-ledger checks: `GET .../checks/payroll` (`lib/payroll-checks.js`). Live on STZA it flags April (March NIC paid late) and June-September (NIC Payable in debit, see below). Feldspar gets a 422: payroll is run outside Xero. | PR #42, 19 Oct |
| 14 | Finance agents reach Xero through the portal: stza-finance-agents 0.9.0 ships its own `stza-xero` server, the practice toolset. Before this the agents named the retired `stza-xero` plugin's tools and had no Xero access at all. All 37 tools they use are served; smoke test passed. Auth is the `xero-mcp@stza-xero-vault` service account, granted `secretAccessor` on `finance-api-key`. | stza-finance-agents #12, #13, 19 Oct |

## Waiting on Nik

- [ ] Restart Claude Code, then confirm the synced agents plugin is 0.9.0 (it was still 0.8.0 on 19 Oct). If not, re-upload it in claude.ai.
- [ ] STZA catch-up (see "STZA ledger findings"): post draft journal `b97cb253`; give the September pension amount and date; pay HMRC 192.75; check the reference on the 18 Jun payment.
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
| 16 | Live proof that a spent code is refused | On 19 Oct the re-send was stopped by the duplicate-journal check, which runs before redemption. Single use is shown by `consumed_at` and the unit tests, not yet by a live refusal. |
| 13 | Settle cap test | The 5,000.00 STZA cap has not really been exercised. The only open STZA bill is 7.80, so "over the cap" was refused as "more than outstanding". It needs a bill over 5,000. |
| 15 | Switch-over | Run the two Desktop servers side by side, then remove the laptop one and retire the laptop's Xero grant. |

## STZA ledger findings (19 Oct 2026)

From the payroll checks. These are bookkeeping items for the agents and Nik, not platform work.

| Item | State |
|---|---|
| 18 Jun HMRC payment of 1,142.85 (bank txn `63eb4553`) was corporation tax for the year ended 31 Mar 2026 but was coded wholly to 826 NIC Payable, leaving 826 in debit | Draft reclass `b97cb253` (Dr 830 / Cr 826, dated 18 Jun) created 19 Oct. Nik to post. FM1 to review first once the agents load. |
| After the reclass, 826 shows 192.75 owed to HMRC: August NIC 35.62 (due 22 Sep) and September 157.13 (due 22 Oct) | Nik to pay |
| The 18 Jun line carries the PAYE accounts-office reference, copied from the 22 May PAYE line. If the payment really used the PAYE reference, HMRC allocated it to PAYE, not CT | Nik to check the bank statement |
| September employer pension (481) has no bill. Pattern Feb-Aug: Interactive Investor, "Employer Pension Contribution - <Mon> 2026", 481, no VAT, dated the payment date, then matched | AP Clerk to draft once Nik gives the amount and date |
| March NIC 11.25 paid on 22 May, a month late (0.07 interest) | Historical; flagged by the April check |

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
