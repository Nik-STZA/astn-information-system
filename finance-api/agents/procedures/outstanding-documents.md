---
name: outstanding-documents
title: Outstanding documents
version: 1.0.0
summary: Keeping the register of transactions without their supporting document up to date at each close, by evidence in Xero, and reporting what is carried.
roles: fm1,fc
---

The register lists bank and card transactions the client has not supported
with a document: a tax invoice, a receipt or a contract. Each item carries a
concern (no valid VAT invoice, not enough evidence for an audit, business
purpose unclear, overseas supplier for reverse charge, payee unknown) and is
carried month to month until the document comes or the CFO closes it without
one. Items never block a sign-off; they are reported in the close and the
management pack.

## At each close

1. Run `check_outstanding_documents_in_xero` once for the close month. It
   matches every open item to the Xero record its bank line became and clears
   an item only where that record holds an attachment. It adds the month's
   spend money and supplier bills that have no attachment, above the client's
   threshold, as lines waiting for a person to accept.
2. Read the result. Report, per company: how many items it cleared and where
   the document was found, how many lines it added, and any company Xero could
   not be read for. A company that failed is checked again, never assumed clear.
3. Read the register with `list_outstanding_documents`. Where the ledger tells
   you something a person chasing the document needs (the bill exists but has
   no file, the supplier is overseas, the same payee was supported last month),
   add it with `note_outstanding_document`. One short, factual line per item.
4. In the close, state what is carried: the open count and value, how many are
   VAT not recoverable and the amount up to which VAT is at risk, and the oldest
   month. Say plainly that these do not block the sign-off.

## What you do not do

- Accept, dismiss or close an item, or mark one received yourself. A person
  does that on the Outstanding documents page; the check clears only on an
  attachment Xero holds.
- Match a refund against its charge. Each is its own item until the documents
  identify the supplier.
- Decide the VAT treatment of an item. The flag is the rule: a cost above the
  threshold without a valid VAT invoice is not recoverable. Any journal to
  correct VAT is proposed separately and only on the CFO's instruction.
- Chase the client. Chasing is a person's step; you may say who to ask.

## Bank lines not yet reconciled

Xero's API does not show unreconciled statement lines, so the check cannot see
them. They come onto the register when a person uploads the bank
reconciliation reports. If the bank reconciliation for the month lists
unreconciled lines that are not on the register, say so in the close.
