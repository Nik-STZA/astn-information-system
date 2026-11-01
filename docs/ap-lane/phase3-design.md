# AP lane phase 3 - queue, approve, write to SUBMITTED

**Date:** 26 October 2026
**Status:** design note for Nik's review. No code yet.
**Builds on:** `ap-lane-spec.md` sections 3 (flow), 3.3 (what goes to Nik), 6 (screens) and 7 (phase 3 acceptance: one live week of Feldspar AP run end to end from the portal, Nik approving in Xero).

---

## 1. What phase 3 adds

Phases 1 and 2 built the parts: the supplier master, the extraction (one model call per file) and the computed checks. All of it runs today from scripts against bills someone else has already keyed. Phase 3 joins the parts into the spec's flow (3.1, steps 1-9). The engine becomes the single author of the bill (D2), and Nik works from one screen:

```
Documents inbox file -> intake -> extract -> build the bill -> check -> clean | exception
                                                                         |        |
                                       Nik in the portal: decide (edit / reject) -+
                                                                         |
           write: create bill + attach file + history note -> SUBMITTED -> Nik approves in Xero
```

**One approval per bill (Nik, 26 Oct 2026).** A clean bill goes to Xero at SUBMITTED without a portal approval, and Nik approves it once, in Xero, as now. Only an exception needs a portal decision first. Approving the same bill twice, in the portal and again in Xero, would duplicate effort. The two approvals are different acts: the portal decision says "this bill is right", and Xero's approval says "this can be paid". Xero's approval stays the payment control, and the lane still ends at SUBMITTED (D3).

The alternative, kept open: approve once in the portal and have the engine authorise in Xero. That would move the payment control into the portal and change D3, so it is a setting for later, not the design now.

## 2. The pieces

### 2.1 Storage: one row per document (migration 021)

`finance.ap_items` holds one row per document found in a file:

- **Source:** the Xero Files id, sha256 and file name. A file with several invoices gives several rows.
- **What was read:** the extraction, stored. A document is read once, never again on page refresh.
- **The proposed bill:** contact, lines, account, tax type, reference, date and due date.
- **The review:** the phase 2 flags, run against the *proposed* bill.
- **State:** `clean | exception | approved | written | rejected | superseded`.
- **Approval:** who approved, when, and any edits made.
- **The write:** the Xero InvoiceID, when it was written, and any errors.

The prompts, rules and determinations stay in finance-api (D5). The row stores results, never method.

### 2.2 API (finance-api)

| Route | Does | Writes to Xero? |
|---|---|---|
| `POST .../xero/:entity/ap/intake` | Lists new Documents-inbox files (Files API), reads each, builds and checks the bill, stores the rows. Processes a capped number of files per call with backoff, so it stays inside the Cloud Run timeout and the Vertex quota | No |
| `GET .../ap/items?state=` | The queue | No |
| `GET .../ap/items/:id` (+ `/file`) | One item with its flags, and the file bytes for the viewer | No |
| `POST .../ap/items/:id/decision` | For an exception: approve, approve with edits, or reject (reason required). Writes the row and an audit line | No |
| `POST .../ap/items/:id/write` | A clean item, or an exception the CFO approved: create the bill SUBMITTED through the existing `upsert_invoice` gate, associate the inbox file, add a history note. Dry run first, as every write is | Yes, draft tier |

**Building the bill** is code, not the model (D4). The contact comes from the supplier master by VAT number, then by name. Lines come from the extraction. Account and tax type come from the master's defaults. The due date comes from the supplier's terms. Amounts come from the lines, never from the model's total (the 12 Oct lesson).

**What goes to the exceptions panel** follows spec 3.3:
- any failed check
- a new or always-discuss supplier
- mixed treatment
- changed address or bank details
- a statement, report or other non-purchase document
- a receipt that matches an invoice already in the queue: attach it, don't bill it

### 2.3 The screen (portal)

The AP queue lives at `/finance/clients/<slug>/ap`, inside the client as the nav rule requires.

- **Mobile first (Nik, 26 Oct 2026).** Designed for a phone and widened for a laptop. On a phone, the list is one column and an item shows the bill, its flags and the actions, with the document a tap away. On a laptop, the document sits beside the bill.
- Tabs: **Clean / Exceptions / Submitted**, filtered by entity.
- Each flag is shown in plain words beside the field it concerns.
- Clean: **Send to Xero** for one, the selected, or all clean. Each send runs the dry run, shows the result, then writes. Nik approves the bills in Xero.
- Exceptions: edit a line, approve, or reject with a reason; an approved exception is then sent the same way. A bundled "go" never covers items Nik has not seen.
- A **Fetch new documents** button runs intake. A daily schedule can follow later (spec Q5).

## 3. Not in phase 3

- Round overwrite check after submit (phase 4 with the learn loop)
- Vendor statements and the learn loop (phase 4)
- Payments, approval in Xero, bank matching (out of scope, D3)
- The supplier-proposal review screen. It would be the same pattern and could follow straight after, since the scripts do that job now.

## 4. Build order

1. Migration, plus intake/build/check API, read-only. Tested on the 12 Oct replay and a live UDL inbox run.
2. The queue screen, read-only.
3. Decisions and the write. First live write on the **STZA org** (drafts, labelled), then Feldspar.
4. The live week: one week of Feldspar AP from the portal (the acceptance test).

Each step is its own PR.

## 5. Decisions needed from Nik

1. **Source. Answered by Nik, 26 Oct:** documents arrive at Feldspar's accounts Gmail, and Nik forwards them by hand. Filters and auto-forwarding follow once the new email addresses are set up. **So phase 3 builds on the Documents inbox as designed (D1).** It is fed by hand for now, and automation does not change the engine. Intake runs from the "Fetch new documents" button until forwarding is automatic; the daily schedule comes after that.
2. **Styling. Answered by Nik, 26 Oct:** build now, mobile first. That applies to every portal screen from here on, not only this one.
3. **Vertex quota. Answered 26 Oct:** no request for now. The whole UDL inbox (31 files) went through in about 6 minutes at 3 files per call. The newer Gemini models appear to run on Google's shared capacity rather than a per-project quota, so there may be no number to raise. This is unconfirmed: the Cloud Quotas API is not enabled on the project.
4. **Approvals. Answered by Nik, 26 Oct:** one approval per bill, in Xero (section 1).
