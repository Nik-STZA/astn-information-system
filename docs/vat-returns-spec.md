# VAT returns and VAT group clearing - build spec

Status: draft for CFO review, 17 November 2026. Nothing here is built yet.
Built with Claude Code. Client neutral within the UK: any client with a **UK
VAT registration** (HMRC, Making Tax Digital, the nine-box return), single
company or VAT group. Other countries' indirect taxes are out of scope (13). Pilot client: Feldspar Sport Group (UDL is the
representative member; FSL and FGH are members; VAT number 493735845).

## 1. Why

Xero has no group VAT return. A group files through the representative
member's Xero organisation: each member's return is exported, the members'
figures are added into the representative member's return by importing a box
1-9 file, and the representative member submits to HMRC. The refund lands in
the representative member's bank, and each member's share has to be cleared to
intercompany by journal.

At Feldspar all of this is done by hand in a workbook per period. On 17 November
2026 a review found:

- **Clearing stopped for six months.** The May to October 2026 returns were
  filed and refunded (GBP 121,699.33 in total) with no clearing journals, so the
  members' VAT accounts and the intercompany balances drifted. Caught only by a
  manual review.
- **A claim misread by GBP 53,512.** The October to December 2025 refund was
  recorded as GBP 144,210 outstanding. The group return actually claimed
  GBP 86,837.16: the members' own returns had been added on top of a
  representative return that already contained them.
- **Manual adjustments with nothing behind them.** That return carried
  GBP 61,961.91 of "adjustments with no accounting transactions", including
  GBP 8,450 for Venture Proof that no ledger holds.
- **Imports add to the return; they do not replace it.** March 2026 took six
  imports; a wrong import has to be reversed by another import, worked out by
  hand.

Every one of these is mechanical and checkable. The system should do the
arithmetic, keep the record, and stop a month being signed off until it ties.

## 2. Principles

- **The upload is the input.** Xero's API does not expose UK VAT returns, so a
  person exports each company's return from Xero and uploads it. That is the
  only manual step besides importing and submitting in Xero itself.
- **Scripts compute, agents interpret** (decision 20). Building the group
  return, the import file, the clearing journals and the matching is code.
- **The CFO approves** (decision 1). Journals go to the Journals page; nothing
  is written to a VAT return in Xero by the system (there is no API for it).
- **Evidence is kept.** Every upload is stored with its hash; every import file
  generated is kept; every figure has a source.
- **Short in Xero, full in os.stza.io.** Journal narration and line labels are
  short; the reasoning goes in the journal's reason (decision 2, `journals.js`).

## 3. Configuration per client

`finance.vat_registrations`, one row per VAT registration:

- client, **jurisdiction** (`GB` only at launch), VAT number, type `single` or
  `group`
- representative entity (for a group) and member entities, effective dated, so
  a company joining or leaving the group is recorded, not overwritten
- return frequency and stagger (monthly, or the quarter months), effective
  dated (Feldspar: quarterly to December 2025, a two-month bridge for
  January-February 2026, monthly from March 2026)
- the Xero organisation the return is filed from (the representative's)
- intercompany accounts per member, as pairs: member side and representative
  side (Feldspar: FSL 802 / UDL 640; FGH 621 / UDL 641)
- export: drive id and folder path pattern, as pack profiles
  (`pack-engine/profiles/*.json` `output`), e.g. `["VAT", "{fy}", "{period}"]`

A single-company registration uses everything except the group build, the
import file and the clearing journals.

**UK only.** Everything here is built for HMRC: the nine boxes, MTD submission
through Xero, Xero UK's VAT return export, UK VAT group rules (a representative
member files for the group), pre-registration and late-claim rules. Switching
on a registration with any other jurisdiction is **refused, with the reason**,
in the same way the asset register refuses a framework it has no template for.
The registration carries the jurisdiction from the start so another country can
be added later as its own template (return layout, parser, payment matching),
without changing the tables.

## 4. Data model

All in `finance`, keyed to `shared.clients`. Amounts `numeric(14,2)`. No DELETE
grant; rows end by state.

- `vat_registrations` (3)
- `vat_returns`: registration, period start and end, status (`building`,
  `import_ready`, `import_confirmed`, `submitted`, `paid`, `part_paid`,
  `outstanding`), submission date and HMRC receipt reference, box 1-9 as
  submitted, signed by and when
- `vat_return_uploads`: each uploaded export: return, entity, kind
  (`member_export`, `representative_pre_import`, `representative_post_import`,
  `hmrc_receipt`), file hash, stored file, uploaded by and when
- `vat_return_figures`: per return and entity, boxes 1-9 as parsed
- `vat_return_lines`: the "Transactions by VAT Box" rows: entity, box, section
  (standard, late claims, reverse charge, adjusted, **adjustment with no
  accounting transaction**), date, account, reference, details, VAT, net
- `vat_imports`: each import file generated: return, kind (`group`,
  `correction`, `reset`), boxes 1-9 as deltas, generated by and when, confirmed
  by which post-import upload
- `vat_payments`: HMRC receipts or payments matched to a return: bank
  transaction id, date, amount, difference to the return, matched by and when
- `vat_adjustment_reasons`: for every adjustment-with-no-transaction line: the
  reason, the evidence reference, who accepted it

## 5. Upload and checks

The Xero export (one workbook per company per period) has three tabs: VAT
Return, Transactions by VAT Box, Transactions by Tax Rate. The parser reads
all three.

Checks, all shown on the page, blocking where marked:

1. **Period**: every member's export covers the registration's period for this
   return (blocking). Catches stale headers, as in Feldspar's 2605/2606 files.
2. **Members complete**: one export for every member on the period end date
   (blocking).
3. **Ledger tie**: each company's box 1 and box 4 transactions agree with the
   movement on its VAT control account for the period, after taking out
   clearing journals and HMRC receipts. A difference is shown, not explained
   away.
4. **Late claims** listed by original date and account.
5. **Adjustments with no accounting transactions** (blocking until accepted):
   each needs a reason and evidence, accepted by the CFO. FGH's GBP 17,012
   pre-registration VAT and the Venture Proof GBP 8,450 would have stopped here.
6. **Box arithmetic**: box 3 = 1 + 2; box 5 = 3 - 4 with its sign.

## 6. The group return and the import file

The group return is the sum of the members, laid out as Feldspar's GROUP tab:
a column per company, the group total, and the import.

**The import file is the target less what is already in the representative's
return.** "Already there" is read from the representative's latest export: its
own transactions plus every import made so far (imports appear in that export
as adjustments with no accounting transactions, with the date created). So a
second import never double counts, and a wrong one is corrected by a
generated correcting file, not by hand.

Steps:

1. Generate the import file in Xero's VAT return import template (boxes 1-9).
2. A person imports it into the representative's return in Xero, re-exports the
   return and uploads it.
3. The system confirms every box equals the group target. Only then is the
   return `import_confirmed`. If not, it generates the exact correcting file.

**Check before go-live: box 5.** Xero's template computes box 5 as
`=ABS(box 3 - box 4)`. A correcting import is a negative adjustment, and ABS
turns it positive. If Xero takes box 5 from the file rather than recalculating,
correcting imports would move box 5 the wrong way. Confirm against Xero's
bridging article and one test import, and generate box 5 accordingly.

## 7. Submission and clearing journals

The person submits in Xero and records the submission (date, HMRC receipt, or
uploads the receipt). The return becomes `submitted` and its box 1-9 are fixed.

**Clearing is proposed at submission, not at refund.** Once filed, each
member's VAT for the period is a balance with the representative, whatever HMRC
does next:

- member: Dr intercompany with the representative, Cr VAT control, its box 5
- representative: Dr VAT control (the members' total), Cr each member's
  intercompany

One journal per company per return, dated the submission date, onto the
Journals page with source `vat` for CFO approval:

- narration: `VAT group clearing: <period> return`
- line description: `<period> VAT return` (representative lines add
  `- <member> share`)
- reason: the box 5 figure, the return, the source upload. Never in Xero.

After clearing, each member's VAT control holds only the current, unfiled
period, and the representative's holds what HMRC owes (or is owed) for filed
returns plus its own current period.

## 8. Payments and refunds

Bank transactions into or out of the representative's bank with HMRC as
contact and the VAT control as account are matched to returns by amount and
order:

- matched to the penny: the return is `paid`
- different: `part_paid`, and the difference becomes an open item with its age
- none after the usual window: `outstanding`, with a chase log (Work tasks).
  Feldspar October to December 2025 starts here: GBP 86,837.16 claimed, booked
  GBP 80,807.40 after clearing, HMRC investigation open.

HMRC can set a repayment off against another tax debt; a part payment carries a
reason field for that.

## 9. Reconciliation and the close

The `vat` line in `bs-matrix.js` is `proof: "outside_evidence"`. The register
supplies that evidence through a new `rec_evidence` method `vat_return`:

- member VAT control = its activity since the last submitted return's period
  end
- representative VAT control = filed returns not yet paid + its own activity
  since the last period end
- any other difference is a finding

The Close page's VAT step is done only when every company's VAT control is
proved this way. Today it reads "Done" with neither VAT reconciliation tying.

## 10. The group return workbook (export)

Generated by the pack engine (`pack_engine/vat.py`), formulas live, typed
numbers only on source tabs, as `render.py`:

- GROUP: a column per company, the group total, the import and each correction,
  as Feldspar's manual file
- per company: VAT Return, Transactions by VAT Box, Transactions by Tax Rate,
  as uploaded
- import log: every file generated and confirmed, with dates
- clearing journals and payment matched
- client branding from the profile

Download from the page, and **save to the client's drive** through
`pack_engine/drive.py` (`ensure_folder_path`) using the folder pattern from the
client's registration (3). Applies to every client, not just Feldspar. One
naming rule: **name by the VAT period**, e.g. `<Client> - VAT Group Return -
2026-10.xlsx` for the October 2026 return, never by the month filed (Feldspar's
files mix the two).

## 11. Back-loading and acceptance

For Feldspar, load as history:

- March to October 2026 from the group workbooks (`Feldspar_VAT_Group_Return -
  2603` to `2611`)
- October to December 2025 from the three company exports
- earlier returns from `I:\Shared drives\Clients\Feldspar Sport\VAT`

Acceptance: the rebuilt group return for every month March to October 2026
equals the GROUP tab and the refund received, to the penny; October to December
2025 rebuilds to GBP 86,837.16 with its GBP 61,961.91 of adjustments itemised;
the clearing journals the system would have proposed equal the 21 posted on
17 November 2026.

## 12. Build order

1. Migration (next free number after the asset register's 049): the tables in
   4, journal source `vat`, grants.
2. Parser for the Xero export and the checks in 5, tested on Feldspar's files.
3. Group build and import file (6), with the box 5 question settled first.
4. Submission, clearing proposals (7) and payment matching (8).
5. Rec evidence and the close step (9).
6. Workbook export and drive save (10).
7. Back-load and the acceptance test (11).
8. Pages: Returns list, a return (members, checks, import, submission,
   journals, payment), Outstanding refunds.

## 13. Scope and open questions

**Out of scope:** indirect tax outside the UK, for example South Africa VAT
(VAT201), UAE VAT, or Australian GST (BAS). Each would be a separate template
on the same tables. Note that Xero does expose the Australian and New Zealand
returns through its reporting API, so those would not need the upload step.

**Open questions for the CFO:**

1. Box 5 in the import file (6): confirm how Xero treats it.
2. Folder pattern for the client drive export (Feldspar: under the client's
   `VAT` folder by year and period?).
3. Whether to keep proposing clearing at refund date for any client that prefers
   it, or submission date for all (recommended: submission for all).
4. The FGH GBP 822.27 pre-registration VAT and the UDL items in the October to
   December 2025 return (Venture Proof GBP 8,450; UDL GBP 2,420.24), to settle
   before back-loading that period.
