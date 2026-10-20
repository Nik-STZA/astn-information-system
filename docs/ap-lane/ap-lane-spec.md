# AP lane and supplier master - spec v0.1

**Date:** 16 October 2026
**Status:** draft for Nik's review. No code yet.
**Pilot:** Feldspar Sport Group (FGH, UDL, FSL). Designed client-neutral so STZA and later clients reuse it.

Sources this builds on, not repeated here:
- `I:\Shared drives\Clients\Feldspar Sport\CLAUDE PROJECT FOLDER\reconciliations\2026-09-15-ap-intake-and-supplier-master.md` - the supplier master evidence and the VAT determination tree
- `STZA Group\Clients\feldspar-sport-group\open-items.md` items 67-70 - the intake tests
- `stza-finance-agents\skills\ap-bill-lane\SKILL.md` v1.2.0 - the coding rules, the Round check, vendor statements

---

## 1. Decisions this spec rests on

| # | Decision | Source |
|---|---|---|
| D1 | **The Documents inbox (`xero.inbox.<token>@xerofiles.com`) is the single front door.** Nothing goes to the bills address. Each document arrives once. | Nik, 12 Oct (item 67); confirmed 16 Oct, item 70 closed |
| D2 | **The agent reads the source cold and is the single author of the bill.** Xero's own extraction is never used as a starting point. | Item 67 |
| D3 | **The lane ends at SUBMITTED.** Approval is Nik in Xero. Payments and bank matching are out of scope. | `ap-bill-lane` |
| D4 | **Rules first, the model for reading.** Code does every check that can be computed. The model (section 4) reads documents and proposes; it does not decide. | 16 Oct cost discussion |
| D5 | **The method stays on STZA servers.** Prompts, rules and the supplier determinations are never exposed to a client login or a client tenancy. | `feedback_protect_workflow_ip` |
| D6 | **The supplier master is the foundation, and it covers identity, not only coding.** Name, address, country, VAT and company numbers are kept right so the data serves VAT returns, ONS surveys and statutory reporting later. | Nik, 16 Oct |
| D7 | **Portal and laptop are one engine.** The laptop MCP and the portal call the same finance-api; they cannot drift. | Nik, 16 Oct |
| D8 | **Every client can be offboarded cleanly.** The client keeps its data; STZA keeps its method (section 8). | Nik, 16 Oct |

---

## 2. Supplier master

### 2.1 Why first

On 15 Sep, 3 of 287 suppliers carried a default VAT treatment and 7 had a country. Ten suppliers carried more than one VAT treatment, including about £100k of likely missed reverse charge. The one foreign software supplier with a default set (Anthropic, 423 / REVERSECHARGES) was the only one coded correctly every time. Without a master, every bill is a fresh judgement, and no amount of AI makes that consistent.

### 2.2 Where it lives

- **Source of truth: `finance.suppliers` in Cloud SQL.** It holds the determination, the evidence behind it, and who approved it. Xero has no field for any of those.
- **Xero contacts are written FROM the master**, after approval, through finance-api. Any later edit made directly in Xero is detected on sync and shown as a difference. It is never silently overwritten either way.
- **One group-level supplier, with per-entity settings.** A supplier billing several entities (Dragon Argent, Xero, Tim Godfrey, Pitch) is one identity with a default account and treatment per entity.

### 2.3 Fields

**Identity and reporting** (mostly mechanical, verifiable without a model):

| Field | Xero contact field | Verified against |
|---|---|---|
| Trading name | `Name` | invoice |
| Legal name | (master only) | Companies House / VIES / invoice |
| Company number | `CompanyNumber` | Companies House API (UK) |
| VAT number | `TaxNumber` | HMRC "Check a UK VAT number" API; EU VIES |
| Registered and billing address, **with country** | `Addresses` (STREET / POBOX) | Companies House / invoice |
| **Country of establishment** | (master only) | determination - not the billing address, not the currency |
| Email for remittances | `EmailAddress` | invoice |
| Default currency | `DefaultCurrency` | invoice |
| Payment terms | `PaymentTerms.Bills` | invoice / contract |
| Supplier type | (master only) | company / sole trader / individual / public body |
| Related party | (master only) | Nik; drives the related-party note |
| Service category | (master only) | optional; mapped from account; filled when an ONS return (e.g. ITIS) requires it |
| Status | `ContactStatus` | active / dormant (dormant = no bill in 12 months; archive only on approval) |

**Coding, per entity** (Nik's determination, once per supplier):

| Field | Xero contact field |
|---|---|
| Default purchase account | `PurchasesDefaultAccountCode` |
| Default AP tax type | `AccountsPayableTaxType` |
| Basis of the VAT treatment | (master only) - the branch of the 15 Sep determination tree, e.g. "non-UK, B2B services, s7A, reverse charge" |
| Mixed-treatment flag | (master only) - e.g. Venture Proof: no default VAT, every bill to review |
| Always discuss | (master only) - intangibles, capital items, intercompany. Bills from these suppliers always go to Nik as a question |

**Evidence and audit - held on the Xero contact itself (Nik, 16 Oct):**
- **A history note on the contact** for each determination, in one line: VAT treatment, its basis, default account, the source document, date, and who approved it. For example: `VAT: REVERSECHARGES - non-UK (SI), B2B services, general rule. Default 423. Source: invoice 2026-09803. Approved N. M, 16 Oct 2026.` Notes are append-only, so a change of treatment adds a new note and the old one stays: the contact carries its own audit trail.
- **The source document attached to the contact**, the invoice the determination was based on.
- The master in Cloud SQL keeps the same fields for the checks; Xero is where the client sees them.

So the client's VAT evidence lives in their own Xero from the day it is decided. There is nothing to export at offboarding.

**Never stored:** supplier bank details. Payments stay Nik's.

**Personal data:** sole traders and individuals (Warren Jones, Mathew Cole and others) are personal data. Hold only what reporting needs: name, address, country, VAT number if any. The master inherits the finance module's data protection position.

### 2.4 The cleanup (phase 1)

1. **Scope.** Live suppliers only: about 40 across the three entities (a bill in the last 12 months). The other ~247 are listed as dormant and left alone unless Nik chooses to archive them.
2. **Mechanical pass (no model).** For each live supplier: ledger history (accounts and tax types used, currencies, volumes), Companies House and VAT number checks where a number is known, address country from Xero.
3. **Proposal pass (the model, once per supplier).** Read the most recent invoice PDF and propose legal name, address, country of establishment, VAT number, determination branch, default account and tax type. Every field cites the document it came from.
4. **Nik reviews in the portal.** One row per supplier, with differences from Xero highlighted. Approve, edit, or mark "always discuss". The ten mixed-treatment suppliers and the two large open questions (STZA into UDL £50.6k; Asian Capital Partners into FSL £40.1k) are listed first.
5. **Write to Xero.** Approved rows are written to the contact in each entity, with the determination history note and the source document attached: dry run first, then audit-logged, in the same pattern as journals.

Historic mis-coding found in the cleanup (the ~£100k reverse charge) is **reported, not corrected**, by this lane. Correcting filed VAT periods is a separate decision for Nik.

### 2.5 Keeping it right

- A **new supplier** (no master record) always goes to Nik with a proposed determination before its first bill is submitted.
- **A bill that disagrees with its supplier's default is an exception**, never auto-corrected. It means either a coding error or a stale default ("the default is a prior, not an answer", 15 Sep note).
- A monthly sync flags master-versus-Xero differences, VAT numbers that no longer validate, and suppliers turning dormant.

### 2.6 Change control on supplier details (Nik, 20 Oct)

**Rule: nothing changes a supplier's address, remittance email or bank details automatically. Every difference is compared, shown to Nik, and only written after he approves it.** The commonest AP fraud is a "we have changed our bank details" invoice or email (payment diversion). A lane that copied details off each new invoice onto the contact would be the attack's delivery route.

- **What is watched**, per supplier per entity: street and postal address (each line and the country), remittance and accounts email, phone, `BankAccountDetails` on the Xero contact, the bank details printed on each invoice, and the legal name, company number and VAT number.
- **Baseline.** When Nik approves a supplier (2.4 step 4), the master records the approved address and contact details, plus a fingerprint of the bank details: a hash and the last four digits, never the full details, keeping the "never stored" rule above.
- **Three places a change can show up, all compared, none auto-applied:**
  1. **On a new invoice.** The extraction reads the address and bank details on the document and compares them with the master. Any difference makes the bill an exception (3.3), shown with the old and new values side by side. It is never a clean bill, and the contact is not touched.
  2. **In Xero directly.** The sync (2.5) compares each contact with the master. An address, email or bank edit made in Xero, whether by a person, Hubdoc, the Xero OCR or a bank feed rule, is reported with who and when, taken from the contact's history. It is never overwritten silently in either direction.
  3. **On the master.** A change proposed in the portal goes through the same approval as a new determination and is written to Xero with a history note (old value, new value, the evidence, the approver).
- **Bank details: report, never write.** The lane never writes `BankAccountDetails`. A changed bank detail is always flagged **"verify independently before paying"**: Nik confirms by phone on a number already on file, not one from the invoice or email that announced the change. The lane does not decide that a change is genuine.
- **First run.** The cleanup (2.4) captures today's Xero values as "unapproved baseline". Differences between the invoice PDF and the Xero contact found in the proposal pass are listed for Nik, not corrected.

---

## 3. The AP lane

### 3.1 Flow

```
Supplier emails document -> Documents inbox (one address per entity, via Google Group)
   |
1. Intake      finance-api lists new Documents items (files API); records file ID + hash
2. Extract     ONE model call per file -> structured fields (all pages; several documents per file)
3. Classify    code: invoice / credit note / receipt / statement / other
4. Match       code: supplier master lookup (VAT no., name, email domain)
5. Build       code: lines from extraction + supplier defaults
6. Check       code: every check in 3.2
7. Queue       portal: clean bills batched; exceptions shown with the PDF beside them
8. Approve     Nik approves in the portal (one, selected, or all clean)
9. Write       finance-api: create bill -> associate_file -> SUBMITTED -> Round check
10. Learn      approved corrections update the supplier master (with Nik's approval)
```

Statements never become bills. They are reconciled against the ledger (the `ap-bill-lane` vendor statement procedure), and a difference that ties to an advance is a finding for Nik.

Receipts are matched to their invoice and attached to it, never made into a bill.

### 3.2 Computed checks (no model)

Every failure the tests produced, mapped to the check that catches it:

| Check | Catches (from the tests) |
|---|---|
| Extracted total = net + VAT, and lines sum to net | page-1-only reads; blank line repeating the total |
| Page count read = page count of the PDF | two-page Amazon invoices read as one page (12 Oct) |
| Currency on document = bill currency; FX rate from Xero on the invoice date | HK$ read as £ (12 Oct) |
| VAT on bill = VAT shown on document | £876.79 of VAT on no document (12 Oct) |
| VAT treatment = supplier default, else exception | Figma at 20% instead of reverse charge; Vidzflow No VAT |
| Date sanity: invoice date not in future, not after FX footnote date, not after receipt | Vidzflow read a month out (12 Oct) |
| Due date from supplier terms; never blank | bills without due dates could not be submitted |
| Duplicate: supplier + normalised number; supplier + amount + date (rules as already tuned in `check_bill`) | timesheet and receipt as separate bills |
| Document type is invoice or credit note | screenshot of a Xero report made into two bills |
| Account exists in the chart; matches supplier default | DV3 on the wrong account |
| Entity-not-VAT-registered rule (`PaysTax=false` -> one gross line, NONE) | STZA rule |
| Attachment present on the bill before SUBMITTED | missing evidence |
| Address, email and bank details on the document = supplier master (2.6) | changed-bank-details fraud; never auto-applied |
| Round overwrite check after submit | Round edits |

The check that `check_bill` could never do (`lines_vs_pdf`) becomes computable, because the extraction is structured data rather than something read by eye.

### 3.3 What goes to Nik, not the queue

- New supplier, or a supplier marked "always discuss"
- Any change to a supplier's address, email or bank details (2.6), on the invoice or in Xero
- Any check failed
- Intangibles, capital items, intercompany, mixed-treatment suppliers
- A statement difference
- Anything the extraction marks low-confidence

---

## 4. Where a model is used, and what it costs

**Decided 20 Oct 2026 (Nik): Gemini 3.5 Flash on Vertex AI, London region (`europe-west2`).** Processing stays in the UK, under STZA's existing Google Cloud terms and bill (project `africanstn-research`). Requests go to the regional endpoint, never `global`, which does not pin where data is processed.

| Step | Model | Calls | Notes |
|---|---|---|---|
| Extract a document | `gemini-3.5-flash` @ `europe-west2` | 1 per file | Structured output (JSON schema). File in, a LIST of documents out: one file can hold several invoices. No conversation, no tools. |
| Propose a supplier determination | `gemini-3.5-flash` @ `europe-west2`, to be confirmed by its own test | 1 per new supplier | Cleanup: ~40 once. Then only new suppliers. No Pro model is offered in London. |
| Explain an exception | same | only on request | Nik asks "why" in the queue. |
| Everything else | none | - | Code. |

**Evidence (20 Oct).** Replay of the 12 Oct UDL batch, 11 unique files, scored against `reconciliations/2026-10-12-ap-intake-udl.md`:

| Model | Region | Score | Misses |
|---|---|---|---|
| gemini-3.5-flash | europe-west2 | **11/11** | none |
| gemini-2.5-flash | europe-west2 | 8/11 | screenshot read as a statement; Amazon credit line dropped on both SSD invoices |
| gemini-2.5-flash-lite | europe-west1 | 8/11 | the same |

Newer models (3.8 Flash, 3.1 Pro) are not offered in the UK or EU regions. One run per model: re-run before go-live and add a second batch from another entity.

**What the model is NOT trusted with**, learned in the same replay:
- **The bill amount.** On two identical Amazon invoices the model netted the "Funded by Amazon" credit off the total on one and not the other, with every line right on both. The bill is built from the lines by code (3.2), applying the CFO's 12 Oct ruling: invoice value, the credit left to bank reconciliation.
- **The VAT treatment.** Google Cloud EMEA invoices print no reverse-charge wording, only the two VAT numbers and 0%. The model reads the facts; the treatment comes from the supplier master and the rules.

**Cost, measured:** about 2.4 US cents per file (about 2k tokens in, 2.3k out including thinking), so roughly £1.20 a month for Feldspar at ~65 files. Per-call tokens are recorded on every run.

**Operational:** the project's Vertex quota is new and returns frequent 429s; calls back off and retry, and a quota increase is requested before go-live. Batching is a later option; at this volume immediacy is worth more.

The extraction prompt and the determination prompt live in finance-api, not in a client-visible skill (D5). The `ap-bill-lane` skill stays as the human-readable procedure for STZA staff.

---

## 5. Prerequisites

### 5.1 Xero app scopes

The portal app currently has `accounting.contacts.read` and `accounting.invoices.read` only, and no files access. The lane needs:

- `accounting.contacts` (write) - supplier master to Xero
- `accounting.invoices` (write) - create and submit bills
- `accounting.attachments` - check and list attachments
- `files` - Documents inbox, content, associations

**Test each against the authorize URL before deploying** (one invalid scope rejects the whole grant, see `server.js` comment). Every entity then reconnects once.

### 5.2 Portal and laptop always in sync (Nik, 16 Oct)

**Requirement:** the portal must do everything the laptop `stza-xero` MCP does, the same way, and the two must not drift.

Today they are two implementations on **one Xero app** (STZA Finance, since 16 Sep), with separate grants: `xero-server.py` (laptop, Python, 23 scopes, 74 tools) and `finance-api` (portal, Node, 13 scopes, reads and reports plus manual journals only). Neither can read `/Journals`: Xero refuses that scope to apps created after 2 March 2026. Full comparison: `xero-capability-register.md`. Every rule fixed in one (`associate_file`, `check_bill`, the Round check, the write tiers) has to be re-done in the other, and has not been.

**Design: one engine, two front ends.**
- **finance-api becomes the only thing that talks to Xero** and the only holder of Xero tokens. Write tiers, dry runs, confirmation, idempotency and the audit log live there once.
- **The laptop MCP becomes a thin client of finance-api**, as `finance-api/mcp-server` already is. Cowork keeps every tool it has today; each tool calls the same endpoint the portal uses.
- **One Xero app is already done; one grant is the goal.** Two grants mean two refresh-token chains to keep alive and two places a token can leak. Once the laptop calls finance-api, the laptop's own grant is revoked.
- **Parity check in CI:** a test lists the laptop tool set and fails if any tool has no finance-api endpoint behind it.

This is a phase 0 prerequisite, because the AP lane is built once, in finance-api, and both front ends get it.

### 5.3 Intake addresses

- One address per entity, as a Google Group forwarding to that entity's `xero.inbox.` address (needs Feldspar's IT)
- Restricted to known senders, with SPF/DKIM/DMARC enforcement and Vault retention (15 Sep spec items)
- The original-sender forward test, which has never been run
- JAX auto-match off for AP, or the overwrite check added
- Hubdoc: confirm which suppliers are on supplier fetch, run in parallel for a month, export the archive, then cancel

---

## 6. Portal screens

Built after the UX/UI design tokens land, in the new style.

- **Suppliers** - master list per client; filters "needs determination", "differs from Xero", "dormant"; supplier detail with evidence and history
- **AP queue** - clean / exceptions / submitted, per entity; PDF viewer beside the proposed bill; approve one, selected, or all clean
- **Client login** sees none of this (D5)

---

## 7. Build phases and acceptance

| Phase | Scope | Accepted when |
|---|---|---|
| 0 | One engine: one Xero app, finance-api as sole token holder, laptop MCP as a thin client, parity test in CI | Every laptop tool works through finance-api on all three Feldspar entities; `files` and contacts write work |
| 1 | Supplier master: table, mechanical pass, proposal pass, portal review, write to Xero | ~40 live suppliers approved by Nik and written to Xero; ten mixed-treatment suppliers resolved or marked "always discuss" |
| 2 | Extraction + computed checks, read-only | **Replaying the 12 Oct UDL batch flags all five known errors** (page 1 only x2, HK$, phantom VAT, screenshot); the 24 Sep Pitch invoice/receipt pair is matched, not duplicated |
| 3 | Queue + approve + write to SUBMITTED | One live week of Feldspar AP run end to end from the portal; Nik approves in Xero |
| 4 | Learn loop, monthly sync, vendor statements | First month-end with master-versus-Xero differences reported |

---

## 8. Offboarding a client

If STZA leaves, the client must be able to carry on with its own records, and STZA's method leaves with STZA. The split:

| The client keeps (their data) | STZA keeps (the method) |
|---|---|
| Everything in Xero: bills, attachments, Documents, contacts | Prompts, extraction schema, rules engine, checks code |
| The supplier master as written to Xero contacts: names, addresses, VAT numbers, defaults, **and the determination note and source document on each contact** (their VAT evidence, already in their Xero) | The determination tree and how it is applied |
| | Skills, plugins, agent configuration, repos |
| A high-level AP procedure: addresses, who approves, what a bill needs before approval | The detailed lane, its checks and its tuning |

**Offboarding run (one command, per client):**
1. Freeze: stop intake, finish or hand back anything in the queue (listed in the handover).
2. Hand over open exceptions. Supplier evidence needs no export: it is already on each Xero contact. An audit log extract is provided only if the engagement letter requires it.
3. Revoke the Xero connection for each entity (`DELETE /connections`), and confirm the client can see it gone.
4. Hand back the intake: the Google Groups and filters belong to the client's Workspace; STZA is removed from them.
5. Delete or retain client data in Cloud SQL per the engagement letter: working data deleted; the audit log and evidence kept for the professional retention period, then deleted.
6. Successor: answer a professional clearance request with the handover pack, not with system access.

**Design rule that makes this possible:** nothing the client needs is held only in STZA's systems. Anything the client must keep is written to Xero or included in the export. Anything only STZA holds is method.

Engagement letters should say this in advance (section 2.2 data, D5 method). Wording for a lawyer.

---

## 9. Answers and open questions

**Answered by Nik, 16 Oct 2026:**
- **Q1.** Portal and laptop work the same and stay in sync: section 5.2.
- **Q2.** No ONS returns at present, but expected in other roles. Country of establishment is captured from day one (VAT needs it anyway); service category is an optional field, filled when a return requires it.
- **Q3.** Dormant suppliers: revisit after the cleanup.
- **Q4a.** STZA is not VAT registered. UDL's coding of STZA invoices is therefore NONE, not EXEMPTINPUT, from now on. The £13,600 already on EXEMPTINPUT (INV-0003, INV-0004) is **not** recoded (Nik, 20 Oct). **Also in the cleanup:** the UDL contact is named "Sports Tech South Africa Ltd T/A STZA", which may not match the legal name. The master should carry the registered name.
- **Q4b.** Asian Capital Partners is Hong Kong based, so no UK VAT is charged.
- **Q5.** Intake runs daily, once Nik has fixed the filtering on the Feldspar accounts inbox. Until then, run on request.

**Still open:**
1. **Q4b follow-up.** "No VAT charged" settles the supplier side. The question left is FSL's side: a non-UK B2B general-rule service is reverse-charged by the UK recipient if FSL is VAT registered, unless the service is exempt (e.g. arranging securities issues). Which applies decides whether the default is NONE or REVERSECHARGES.
2. ~~Which app is kept~~ - already one app (STZA Finance, 16 Sep). Corrected 16 Oct.
