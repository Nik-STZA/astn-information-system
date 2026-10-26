# AP lane phase 3 - queue, approve, write to SUBMITTED

**Date:** 26 October 2026
**Status:** design note for Nik's review. No code yet.
**Builds on:** `ap-lane-spec.md` sections 3 (flow), 3.3 (what goes to Nik), 6 (screens) and 7 (phase 3 acceptance: one live week of Feldspar AP run end to end from the portal, Nik approving in Xero).

---

## 1. What phase 3 adds

Phases 1 and 2 built the parts: the supplier master, the extraction (one model call per file) and the computed checks. All of it runs today from scripts against bills someone else has already keyed. Phase 3 joins the parts into the spec's flow (3.1, steps 1-9). The engine becomes the single author of the bill (D2), and Nik works from one screen:

```
Documents inbox file -> intake -> extract -> build the bill -> check -> queue
                                                                      |
                     Nik in the portal: approve / edit / reject ------+
                                                                      |
           write: create bill + attach file + history note -> SUBMITTED -> Nik approves in Xero
```

Nothing reaches Xero until Nik approves the item in the portal. The lane still ends at SUBMITTED (D3).

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
| `POST .../ap/items/:id/decision` | Approve, approve with edits, or reject (reason required). Writes the row and an audit line | No |
| `POST .../ap/items/:id/write` | An approved item only: create the bill SUBMITTED through the existing `upsert_invoice` gate, associate the inbox file, add a history note. Dry run first, as every write is | Yes, draft tier |

**Building the bill** is code, not the model (D4). The contact comes from the supplier master by VAT number, then by name. Lines come from the extraction. Account and tax type come from the master's defaults. The due date comes from the supplier's terms. Amounts come from the lines, never from the model's total (the 12 Oct lesson).

**What goes to the exceptions panel** follows spec 3.3:
- any failed check
- a new or always-discuss supplier
- mixed treatment
- changed address or bank details
- a statement, report or other non-purchase document
- a receipt that matches an invoice already in the queue: attach it, don't bill it (the Pitch pair, the open phase 2 item)

### 2.3 The screen (portal)

The AP queue lives at `/finance/clients/<slug>/ap`, inside the client as the nav rule requires.

- Tabs: **Clean / Exceptions / Submitted**, filtered by entity.
- Selecting an item shows the **document on the left** and the **proposed bill on the right**, with each flag in plain words beside the field it concerns.
- Actions: approve one, approve the selected, or approve all clean. Edit a line before approving. Reject with a reason.
- After approving, **Write to Xero** runs the dry run, shows the result, then writes. Each item gets its own approval: a bundled "go" never covers items Nik has not seen.
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

1. **Source.** Is the Documents inbox (D1) receiving Feldspar's documents yet, now that inbox filtering has been fixed (Q5)? If not, should phase 3 start from bills already keyed as drafts in Xero and move to the inbox later?
2. **Styling.** The spec says the screens come after the UX/UI design tokens. Build the queue now in the current portal style and restyle later, or wait?
3. **Vertex quota.** Should a quota increase be requested now? A week's intake runs at one file per call until it is raised.
