# Finance module - build decision log

Decisions taken while building the STZA Finance module, with the reasoning and
the consequences. Kept because this module is intended to be extractable and
potentially licensed to other fractional-FD practices: a buyer, an auditor, or
a future maintainer needs to know why it is shaped the way it is, not just what
it does.

Format: what was decided, why, what it costs, and what would change the answer.

---

## 1. Approvals live in the portal, not in Xero

**Decided:** the portal is the system of record for approval. Xero holds the
ledger entry plus a pointer back.

**Why.** Xero has no data model for an approval chain. A manual journal has a
status and nothing else: no reviewer tiers, no findings, no send-back reason,
no priority, no SLA. More importantly, most approvals never become a journal at
all. VAT submissions, HMRC correspondence, bank statement chases and
reconciliation sign-offs have no Xero representation. If Xero were the approval
system, there would be two approval systems and neither would be complete.

**Cost.** The audit trail spans two systems, so the link between them has to be
deliberate and durable rather than incidental. See decision 2.

**What would change it.** If a future ERP exposed a real approval workflow with
reviewer roles and findings, the calculus would shift for that adapter. None of
the current candidates do.

---

## 2. Every ledger write is traceable in both directions

**Decided:** an approved journal carries an approval reference in its narration,
gets a note written into Xero's History and Notes recording the approving
capacity and reference, and the returned Xero journal id is stored back in
`finance.audit_log`.

**Why.** Without this, a journal posted through the API appears in Xero
attributed to nothing - "system via API" - and an auditor working from the
ledger hits a dead end. They must be able to start at either end and reach the
other: from the Xero entry to the full approval chain, and from the portal
record to the ledger entry.

**Cost.** Two extra API calls per posted journal, and a dependency on Xero's
History and Notes endpoint supporting manual journals (it does).

**Detail.** The Xero note records the engagement capacity and a reference, not
individual names. Xero is visible to auditors, accountants and whoever else has
ledger access; the confidentiality rule inherited from the close pipeline keeps
individual staff names out of anything that widely visible. Names live in the
portal, keyed to the reference.

---

## 3. Journals are drafted in Xero, then posted on approval

**Decided:** on submission the journal is created in Xero as a draft, which has
no ledger effect. Approval in the portal flips it to posted.

**Why.** Xero's own history then records two timestamped events, so the moment
of approval is a real event in the ledger's trail rather than a single
anonymous appearance. It also means the reviewed artefact and the posted
artefact are provably the same object.

**Cost.** Draft journals sit in Xero between submission and approval, and
someone with Xero access could post one manually, bypassing the approval queue.
That is a control gap to be aware of: the portal is the intended path, not an
enforced one. Enforcing it would require restricting who holds Xero write access
directly.

**Consequence.** Journal write permission is needed from the first connection,
not deferred to a later phase.

---

## 4. Approver capacity is per client, effective dated, and snapshotted

**Decided:** `finance.client_engagement_roles` records the capacity a person
holds for a given client, with effective dates. `finance.audit_log.actor_role`
stores that capacity as at the moment of the action.

**Why.** The same person holds different capacities at different clients:
Fractional Finance Director at one, Fractional CFO at another. An audit entry
saying only "approved by <email>" does not establish in what capacity the
approval was given, which is the first thing an auditor or a court would ask.

**The important part is the snapshot.** If the audit trail joined to a current
role field, then changing a title later would silently rewrite the capacity
recorded against every historical approval. An audit trail that can be altered
by editing a lookup table is not an audit trail. So the role is copied onto the
entry at write time and never recalculated on read.

**Cost.** Client setup has to capture the engagement capacity, and it is a
required field rather than a nicety.

**Open.** The Feldspar engagement start date is not recorded anywhere in this
repo, so `effective_from` is deliberately null rather than invented. It should
be set once confirmed.

---

## 5. The portal holds its own Xero connection, separate from the close pipeline

**Decided:** the portal authorises Xero through its own app (STZA Finance) and
holds its own refresh tokens. The existing Python close pipeline keeps its own
app and tokens, untouched.

**Why.** Xero refresh tokens are single use: every call rotates the token and
invalidates the previous one. Two independent holders of the same token would
silently break each other, and the loser would be whichever ran second. Since
one of those is the monthly close, that is not an acceptable failure mode. One
Xero app can hold multiple independent authorisations of the same organisation,
so separate connections cost nothing architecturally.

**Cost.** Two authorisations per entity instead of one. Xero counts connections
per app, not per developer account, so each app has its own free allowance and
this does not consume the other's.

**Consequence for scale.** The practice-level app credentials are shared across
every client; only the refresh token is per entity. Onboarding a new client
therefore requires no new Xero app, just an authorisation per entity. The free
tier allows five connections per app, so a second three-entity client would
take the STZA app to six and tip it into the paid tier.

**Note.** Xero asks accountants and corporate groups building internal-only
tooling to register with them separately. That route has not been taken yet and
may carry better terms than the app-store commercial model.

---

## 6. Secrets are never held by the application, and access is name scoped

**Decided:** Xero credentials live in Secret Manager. The service account can
create and write Xero token secrets, and can read back only secrets whose name
begins `xero-refresh-`, enforced by an IAM condition.

**Why.** The obvious shortcut, granting project-wide secret access, would have
let the Finance service read the database password, the AfricanSTN API key and
the AI provider keys. A finance service has no business being able to do that.

**Cost.** An IAM condition and a custom role to maintain.

---

## 7. Every reveal of a secret is audited, including failures

**Decided:** revealing, copying or rotating any client secret writes to
`finance.audit_log` with actor, capacity, target and timestamp. Failed attempts
are logged too. The value itself is never logged, never placed in a URL, and
never rendered into server HTML.

**Why.** For a practice holding client financial credentials, "who looked at
what and when" is the question that matters after an incident. Logging only
successes hides exactly the pattern worth seeing.

---

## 8. Module isolation is enforced mechanically, not by convention

**Decided:** `eslint-plugin-boundaries` fails CI if the Finance module imports
from another module or from the legacy application code, and a schema check
fails CI if a Finance migration creates anything outside the `finance` schema.

**Why.** Extraction-readiness stated as an intention decays. Stated as a build
failure, it does not. Both rules were verified to fail on a deliberate
violation before being relied on.

**Cost.** Some duplication, for instance the Finance module has its own API
client rather than reusing the existing one.

---

## 9. File mirrors are keyed on stable identity, not line numbers

**Decided:** diary entries are replaced wholesale per source file; open items
key on the register's own item reference.

**Why.** The first implementation keyed both on line number, which moves the
moment anyone edits above an existing entry. A re-import would have duplicated
rows and orphaned the originals.

---

## 10. Concurrent file syncs are serialised with an advisory lock

**Decided:** the sync endpoint takes a transaction-scoped advisory lock per
client and source file.

**Why.** Replace-per-file is a delete followed by an insert. Under READ
COMMITTED a second transaction cannot see the first's uncommitted inserts, so it
deletes only the pre-existing rows, inserts its own, and both commit - doubling
the file's entries. This was not theoretical: a single file restore emitted two
filesystem events far enough apart to dodge the debounce and duplicated all
eight entries of one diary month. Debouncing narrows the window but cannot close
it.

---

---

## 11. Notes are append only, enforced in the database

**Decided:** `finance.notes` refuses UPDATE and DELETE by trigger. Corrections
are further notes.

**Why.** The purpose is an audit record, not a comment thread. "Payment run
loaded, three vendors held and why" is a decision, and a decision that can be
quietly revised afterwards is not evidence. Enforcing it in the application
would rely on every future caller remembering; enforcing it in the database
means an application bug cannot rewrite history.

**Cost.** Test data written to prove the trigger cannot be removed without
disabling the control, which is itself the demonstration that it works. One
such note remains against open item 1.

**Detail.** Notes carry a kind (note, decision, hold, query) so a deliberate
hold can be told from commentary without parsing prose, and the author's
engagement capacity is snapshotted at write time.

---

## 12. The portal is where the work is driven, not a view over it

**Decided (2026-07-30):** the module's purpose is to be the surface from which
agents are run, with the audit trail as a by-product. Not a read-only mirror of
files that Cowork can already read.

**Why.** Challenged directly: what does the portal give that a Cowork session
does not. Honest answer at the time was, for a single operator, very little.
Almost everything it displayed was derived from files readable in the session,
with a sync layer and two services to maintain. The three things that are not
redundant are the append-only audit trail, cross-client state, and anyone who
is not the practitioner.

**Consequence.** Execution stays local: a runner on the practitioner's machine
claims queued jobs, runs the agent headlessly against the client folder with
the accounting MCP available, and returns output as work for review. The portal
queues and records; it does not execute. Proven feasible: headless execution
works, and a plugin loads from its repository without installation.

**Cost.** The portal can do nothing while that machine is off. Accepted for now
because it works this week and answers whether the practitioner would drive
agents this way before anyone builds infrastructure for it.

---

## 13. Agent output is better than parsing, and the parser should stop pretending

**Observed:** asked to count active open items, the FC agent reported 17 where
the parser reported 20. The agent was right: three rows sit in the active table
with a status of DONE, two read "Partially DONE" and one is a standing review
rather than a task.

**Consequence.** The open items page has been overstating the workload since it
was built. More broadly, a parser that shreds a document into rows will keep
losing to an agent that reads it. Where interpretation is required, interpret;
do not encode a heuristic and call it data.

---

## 14. The record must not imply segregation of duties that does not exist

**Decided:** the audit record captures who actually performed each step, by
identity, and states plainly where the same person prepared and reviewed.

**Why.** The system models preparer, FM2, FC and CFO. Today every one of those
is the same person. Combining preparation and review is normal and unavoidable
in a sole practice; a record asserting four tiers of independent review is not.
This gates any use of the record to support a professional opinion.

See `finance-module-governance.md` for the full position and gap register.

---

## 15. The folder convention was already specified, and I did not read it

**What happened.** The portal was built against a WIP folder convention designed
here, and options were then put to the operator as an open design question. It
was not open: `handoff-protocol/SKILL.md` in the agents plugin already defined
the structure, and its description says so explicitly. Only the agent files that
reference it had been read, not the skill that defines it.

**Consequence.** Two incompatible layouts. The portal could not read what the
agents wrote, and the operator was asked to choose between options when a
decision already existed.

**Fix.** `handoff-protocol/SKILL.md` is authoritative and now says so, and
`docs/wip-folder-convention.md` states plainly that it is subordinate and that
the skill wins where they disagree. A change to one without the other is a bug.

**The lesson, which is the same one twice.** Before designing a convention, find
the thing that already produces the artefact. The first time this happened the
agents were the unread producer; the second time it was the skill they inherit
from.

---

## 16. Live and finished work are separated, and both attributes are in the path

**Decided:** `wip/<state>/<type>/<batch>` for live work,
`<posted|rejected>/<YYYY>/<MM>/<type>/<batch>` for finished work.

Combines the two conventions, each contributing what the other lacked.

**From the existing skill:** finished work leaves `wip/` and is archived by
month. So `wip/` means only what is outstanding, the archive never grows inside
the queue, and an item cannot appear in both. Extended to `rejected/`, which is
equally terminal.

**From the portal design:** state and type are both in the path. State because
it changes three to five times and must never be able to disagree with itself:
it IS the folder. Type because the previous convention lost it on escalation,
leaving an AP batch and a VAT return indistinguishable once both reached the FC.

Anything `posted` or `rejected` found inside `wip/` is refused rather than read,
because that would let the queue and the archive disagree about one item.

The skill also had no stable identity and no entity level. Both were added:
`wip.json` carries a `ref` that survives every move, and entity-scoped work sits
under its entity, which is where the mis-keying risk the client notes already
flag actually lives.

---

## 17. Build note: how the recurring defect in this project happens

Four defects in this build share one shape, and it is worth recording because it
will recur.

| Where | What reached production or was reported |
|---|---|
| gcloud env var | A comma split `FEATURES` into four variables, hiding three live modules |
| SQL in a template literal | `'^\s*done\M'` arrived at Postgres as `^s*doneM` and matched nothing |
| Transcript path encoding | An audit record stating an agent touched no files when it had read two |
| Parser rewrite | A change reported as applied that had not been applied at all |

Each involved editing or passing a value through a layer that consumes
backslashes or commas: a shell, a template literal, a scripted string
replacement. In every case the source looked correct.

Two rules that would have caught all four:

1. **Do not use scripted string replacement on files containing backslashes.**
   Use the editor directly. Three of the four came from this.
2. **Verify the result, not the tool's success message.** A replacement that
   matched nothing still reports success. A deploy that went green still needs
   the deployed behaviour checked. The fourth defect was reported as working
   because the test count went up, when the tests were old ones passing against
   old code.

## 18. Approval routing is derived, never declared

Whether an item reaches the CFO individually or inside a batch is computed at
import from the client's `configs/routing.json`, and a `wip.json` that carries a
routing field is **refused** the same way one disagreeing with its own path is.

The drafting agent writes `wip.json`. If it could also write the field deciding
how closely its own work is read, the only approval gate in the system would have
a self-service bypass. This is the same principle as posting tools being
physically absent below the CFO rather than forbidden by instruction: make it
impossible, do not rely on the instruction.

Every path returning "mechanical" is written to be defensible alone. Unknown
type, unstated amount, absent config and unusable config all return judgement, so
**an absent config costs attention, never control**. Threshold comparison goes
through BigInt, because a float rounding error at the boundary would decide
whether a human reads the item.

Onboarding writes the config with thresholds **unset**. Materiality is a
judgement made at engagement start, and a default invented by a script becomes a
real number nobody decided.

## 19. The processing path is established before a run, and recorded on it

Claude Code authenticates against either a consumer subscription or a commercial
endpoint, and the difference is not a preference. The consumer terms say the
service is not for business or professional purposes, carry no confidentiality
clause, and no DPA applies — on that route the provider is a controller in its
own right, so **there is no DPA to obtain**. A client ledger must not travel that
way.

The runner resolves the path once at startup and refuses without one. A
half-configured commercial path is refused too, because that is the dangerous
case: it looks deliberate and silently uses the subscription. Migration 008
records the path on every run. It is the column a client, an insurer or a
regulator asks about first and it cannot be reconstructed later.

`STZA_ALLOW_UNGOVERNED_PATH` exists so the runner can be exercised on synthetic
data, and it **refuses any client except the sandbox**. A convention saying so
would have been worth less: the flag gets set for a reason one afternoon and is
still set the morning someone runs a real close.

## 20. Scripts compute, agents interpret

Grouping a trial balance to matrix lines, or summing a rolling twelve months
against a VAT threshold, is deterministic work. A script does it reproducibly,
testably, for nothing, and identically every month. An agent doing that
arithmetic would be slower, cost tokens, and could be wrong in ways nothing
catches. Most agentic finance designs get this backwards.

What the agent adds is on either side of the computation: whether a line is
material, whether it needs a register, whether two balances that look odd
actually are. That is the same principle the module already uses one level down —
agents post from registers rather than memory — restated as **agents reason over
computed facts rather than computing them**.

This was not designed. It emerged from `vat-monitor.mjs` and
`compose-matrix.mjs` being written to unblock work that had been parked behind a
Vertex quota grant for no better reason than adjacency, after the CFO asked why.

## 21. Refusing to guess and refusing to store are different things

The Xero callback refused to map an organisation it could not identify, which
was correct and was written after a near-miss that nearly mapped one client's
entity to another's ledger. It also **discarded the refresh token**, and the
organisation picker built to resolve exactly that ambiguity needs a stored token
to list organisations.

So the picker could never be reached, and no new client could be connected at
all. Every new client hits it, because Xero returns no `authentication_event_id`
for organisations the app has already seen.

The lesson is not about Xero. **A control added in response to an incident is
still a change, and still needs someone to ask what it broke.** The refusal
closed the hole it was written for and removed the only recovery path, and
nothing in the review process noticed for months.

## 22. Build note: what the first day of the defect register showed

Nine rows on the day it opened.

Three came from review — a four-model round table across four position papers,
all of them design errors in documents. Four came from **running the thing**, two
within minutes of code being used and two found by the CFO on his first attempt
to onboard a real client. Two were the analyst's own judgement errors on a real
client's accounts, one caught by opening a source document and the other by the
CFO pushing back.

Every one of the last six had survived the round table, the settled list of
controls, and every review to date.

The practical conclusion, on one day's evidence: **more design review will not
find the next one.** Using the system will. That is an argument against the
instinct this project has followed for most of its life, and it is why the
register moved to the front of the build order rather than the end.

## Parked for later: AP through Hubdoc and Xero

Discussed 31 July 2026 and deliberately not built. Recorded in enough detail that
picking it up does not mean deriving it again.

**Do not rebuild ingestion.** Hubdoc already ingests the PDF, OCRs it, creates the
draft bill in Xero and **attaches the source document to it**. A PDF → Markdown →
CSV import pipeline redoes all four, worse, and *creates* the attachment problem
it appears to solve: CSV import produces records with no document, so the PDF then
has to be attached and matched by hand. Hubdoc's route never has that problem.

**The attachment is not a blocker either way.** Xero's Attachments API
(`PUT /Invoices/{id}/Attachments/{filename}`) can push a document onto a record.
It needs the `accounting.attachments` scope, which is not currently requested.

**Where the errors actually are.** Hubdoc is good at supplier, date, amounts and
VAT figures. It is weak on account coding — especially policy-driven judgements
like capitalise versus expense — VAT treatment and place of supply, duplicates
against the existing ledger, and cut-off. Those are exactly what the benchmark
cases test, and they are the agent's job. **Hubdoc ingests and attaches; the agent
reviews and codes.**

Three shapes, in increasing scope:

- **A, findings only.** Agent reads draft bills and their attachments, produces
  findings, the CFO applies and approves in Xero. Works with roughly the current
  scopes. No writes.
- **B, agent recodes the draft.** Needs `accounting.transactions` write. The agent
  corrects coding on the **draft**; approval stays a CFO keystroke. One narrow
  write path, at the draft stage, never at approval. **The version to aim at.**
- **C, import route.** Needs attachment and transaction writes, discards Hubdoc's
  OCR, reintroduces document matching. Rejected.

**State ownership is the subtle part.** The WIP folder convention was designed for
work agents *create*, which has no existence until written, so the folder can
safely be its state. Hubdoc bills already exist in Xero with their own lifecycle.
Copying them into WIP folders gives two state machines over the same objects and
they will diverge. **The WIP item should be the review — one item covering many
bill IDs — with the bills and their documents staying in Xero.**

**On token cost.** Converting a PDF to text is a real saving, not a marginal one:
a PDF page reaches a model largely as an image at roughly 1,500 to 3,000 tokens,
against 200 to 500 for the same invoice as text, and a bill is read more than once
as it moves up the chain. That matters once execution is metered on Vertex rather
than flat on a subscription.

But an extraction is a **summary**, and `fc.md` requires findings to be recorded
from a source. An agent reading extracted text cannot catch an extraction error,
because the extraction is its input. Resolution is the same shape as the
mechanical-versus-judgement split: cheap text for the bulk pass — coding,
duplicates, dates, arithmetic — and fetch the PDF for anything flagged or where
the amount or VAT treatment is itself the question.

For Hubdoc bills specifically the cheap input already exists: Hubdoc has parsed
the invoice into structured fields on the Xero record, so the agent reads a small
JSON object. Conversion is only worth building for documents that never went
through Hubdoc.

**A browser-driving agent was considered and rejected.** An agent in a logged-in
Hubdoc session has every capability the session has, and a browser cannot have a
capability removed. That destroys decision 1 — posting tools physically absent
below the CFO — which is the only claim in this architecture that survives an
adversarial reading. It also degrades the audit trail from API records to
screenshots, and collapses drafter, reviewer and approver into one act.
Read-only browser use is fine; looking is not posting.

**Blocked on:** a scope decision. `accounting.attachments`, `accounting.transactions`
write, `accounting.reports.read` and `accounting.journals.read` are all absent, and
widening any of them means reconnecting every entity. Worth doing once,
deliberately, rather than several times.

## Open questions carried forward

- Draft journals in Xero can be posted manually, bypassing the approval queue.
  Whether to restrict direct Xero write access is a control decision, not a
  technical one.
- The Journals endpoint has moved behind Xero's Advanced plan. The close
  pipeline uses it for transaction-level detail and is unaffected on its
  existing app, but it constrains moving that work into the portal.
- No automated test suite exists yet. The duplicate-rows defect in decision 10
  is exactly the class an integration test would have caught first.
