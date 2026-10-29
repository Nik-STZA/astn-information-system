---
name: payroll-journal
title: Payroll journal and net pay control
version: 2.0.0
summary: The monthly payroll journal from a summary of totals, and the net pay control that clears to nil. No per-person data.
roles: fm1,fc
---

# Payroll journal and net pay control

The pattern STZA already runs for a bureau client, written down so it transfers to other
clients and to STZA's own in-house payroll.

**The principle: the ledger carries totals, the bank carries names, and they meet at a
control account that clears to nil every month.**

## The boundary — read this before anything else

**No agent in this chain ingests per-person data.** Not salaries, not net pay, not bank
details, not National Insurance numbers. The agent works from a **payroll summary of
totals** and nothing else.

This is not a matter of instructing the agent to be careful. It is a design where the data
is not present:

| Artefact | Who handles it |
|---|---|
| Payroll file, payslips, per-person net pay | Payroll system or bureau only |
| BACS file (sort code, account number, net pay per person) | **Human only. Never an agent, never a script** |
| Payroll summary — totals by cost line | Agent |
| GL journal | Agent |
| Bank reconciliation of the net pay control | Agent |

The BACS upload is an instruction to move money to named individuals. It stays human in
every variant below, permanently, regardless of how good the automation gets.

## The posting pattern

### 1. The payroll journal, on pay date

```
Dr  Gross salaries              by cost centre where the client uses them
Dr  Employer NI
Dr  Employer pension
      Cr  Net pay control                    total
      Cr  PAYE / NIC liability               total
      Cr  Pension liability                  total
      Cr  Other deductions (student loan,
          attachment of earnings, etc.)      total
```

Every credit is a total. No line names a person.

Where the client posts payroll to more than one entity, or recharges it, keep the recharge
in a **separate account** rather than netting it into the payroll codes — the payroll-to-GL
control below depends on those three codes agreeing to the payroll report permanently, with
no reconciling item.

### 2. The bank payment

```
Dr  Net pay control             total
      Cr  Bank
```

Net pay control clears to nil. If it does not, either the bank paid a different amount from
the payroll summary, or a payment is unpresented, or someone was paid outside the run. All
three are findings.

### 3. The liabilities

PAYE/NIC and pension clear when paid, on their own dates. They are not part of this journal
and they carry their own reconciliation — the PAYE control against the HMRC statement, the
pension control against the provider's schedule.

## The critical operational detail

**Pay as one batch debit, not individual transfers.**

If the client pays people with separate faster payments, the bank feed delivers one line per
person **with their name on it**. The journal is clean and the ledger is not, and the whole
design is defeated by the bank statement. A bulk or batch payment presents as a single debit.

**Test this before relying on it.** Run one cycle and look at how the bank actually presents
the payment in the feed. Banks differ, and some present a bulk payment as individual items.
This is a one-run test and it settles the question permanently for that client.

Ask for the answer to be recorded in the client's rules for this procedure.

## Controls — assert all three, every month

| # | Assertion | Tolerance |
|---|---|---|
| 1 | Payroll summary total gross + employer NI + employer pension **=** movement in the three payroll GL codes | £0.00 |
| 2 | Payroll summary net pay **=** credit to net pay control **=** the bank debit | £0.00 |
| 3 | Net pay control balance after the bank payment | **nil** |

Control 1 is the payroll-to-GL bridge. It only holds if recharges and adjustments are kept
out of the payroll codes — see §1 above.

A non-nil net pay control at month-end is an exception, not a rounding difference. Do not
write it off; find it.

## Variants

### A — Bureau (the house default)

Payroll runs entirely outside Xero. The bureau produces the summary and the BACS file. The
summary is posted as a journal; the BACS file goes bureau-to-bank.

**Per-person data never enters the Xero tenant at all.** Nothing to leak, nothing to scope,
nothing to explain to a client or an auditor. This is the strongest variant and it should be
the default recommendation for new clients.

### B — In-house, payroll software outside Xero

Same as A, but the client runs the software. Same journal, same controls. The only
difference is who produces the summary.

RTI filing (FPS and EPS to HMRC) is a regulated obligation and needs recognised software —
confirm it is in place before taking this on for a client.

### C — Xero Payroll

Payroll runs inside the Xero tenant, so the per-person data **is** in the tenant: employment
records, salaries, payslips.

The boundary stops being architectural and becomes a scope decision. Take
`payroll.settings.read` and `payroll.payruns.read` only; refuse `payroll.employees`,
`payroll.payslip` and `payroll.timesheets`. Record the refusal in the client's rules so the
next session does not quietly add them.

**This is the weakest variant on confidentiality.** Support it where a client already runs
it; do not recommend moving a client to it on our advice.

## Where aggregation does not help

With one or two people on the payroll, the total *is* the individual. Aggregation conceals
nothing and should not be presented to a client as though it does.

Say so plainly where it applies. The reason to run the pattern anyway is that it has to be
right before the client has ten employees, not after.

Directors' remuneration is separately disclosable in the statutory accounts, so it sits
outside this concern entirely — treat it as a named policy decision per client rather than
something the aggregation is protecting.

## Outputs

- The journal proposed for approval, then created as a **DRAFT** once approved; a person
  posts it in Xero.
- The reconciliation in your answer, with all three assertions and their actual figures.
- The payroll task in Work updated per `how-work-moves`.
- Any exception recorded with the amount, not just the fact of it.

## STZA in-house pilot

STZA's own payroll is the test case for variant B before it is offered to any client.

Specifically to establish during the pilot:

1. How the bank presents a batch payment in the feed — the §"critical operational detail" test.
2. Whether RTI filing and the payroll summary come out of the chosen software in a form that
   feeds control 1 without manual reworking.
3. Whether the three assertions can run unattended, or whether one of them needs judgement
   every month.

If any of those is unsatisfactory, the variant does not get offered to clients. Bureau
(variant A) remains the default and nothing is lost.
- **2.0.0 (29 Oct 2026)** - Cloud version for the agents in os.stza.io: work moves through Work tasks, client specifics come from the client's rules, client names removed. Treatment unchanged.
