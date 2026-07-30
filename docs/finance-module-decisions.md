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

## Open questions carried forward

- Draft journals in Xero can be posted manually, bypassing the approval queue.
  Whether to restrict direct Xero write access is a control decision, not a
  technical one.
- The Journals endpoint has moved behind Xero's Advanced plan. The close
  pipeline uses it for transaction-level detail and is unaffected on its
  existing app, but it constrains moving that work into the portal.
- No automated test suite exists yet. The duplicate-rows defect in decision 10
  is exactly the class an integration test would have caught first.
