# Finance module - governance note

**Owner:** Nik Mladenovic, CA(SA), Sports Tech Africa Ltd T/A STZA
**Scope:** the STZA Finance module in os.stza.io, the local agent runner, and the
Claude-based agents used to prepare client finance work
**Status:** working document. Several controls below are NOT yet in place and are
marked as such.

This note exists because the module is intended to move from internal tooling to
a client-facing offering, and possibly to be licensed. A buyer, an insurer, a
client's auditor or a professional indemnity underwriter will ask these
questions. It is cheaper to keep this current than to reconstruct it later.

It is written to the standard a large firm would apply to a technology-enabled
advisory offering, not to the standard a sole practitioner could defend. Where
the practice does not meet that standard today, the gap is stated rather than
softened. A governance note that claims controls it does not have is worse than
no note at all.

---

## 1. What the system does

The Finance module presents and records client finance work. It does not perform
the work: that is done by Claude-based agents, which run on the practitioner's
machine against the client's own files and the client's accounting system.

Three planes:

- **Agent plane.** Client artefacts on local disk. Agents read and write these.
- **Record plane.** Cloud SQL, holding a mirror of that state plus records the
  file system cannot hold: audit entries, notes, approval history, job records.
- **Control plane.** The web application, from which work is reviewed, annotated
  and approved.

No agent posts to a client accounting system. Every ledger write passes through
an explicit approval by the practitioner.

---

## 2. Data protection

### 2.1 Sub-processors

Client financial data is processed by third parties. As at the date of this note
the position is:

| Processor | Purpose | Status |
|---|---|---|
| Anthropic | Agent execution over client data | **NOT DISCLOSED. Gap.** |
| Google Cloud (europe-west1) | Database, application hosting, secrets | Disclosed, EEA |
| Xero | Source accounting system, client's own contract | Client's processor |

**Gap.** Anthropic is a sub-processor and is not currently disclosed in
engagement letters, recorded in the processing register, or covered by a data
processing agreement. Article 28 requires all three. This must be closed before
further client data is processed through agents.

Closing it requires a commercial arrangement with Anthropic that carries a DPA
and a no-training commitment. Consumer tiers do not. This has a practical cost:
commercial terms constrain usage in a way that affects development pace. That
tension is real and is accepted: processing client financial data without a DPA
is not an option that trades off against convenience.

### 2.2 Data residency

Application, database and secrets are in Google Cloud europe-west1 (Belgium).
Agent execution is on the practitioner's machine in the United Kingdom, with
model inference by Anthropic. **The inference processing location must be
established and recorded** as part of closing the gap above.

### 2.3 Model training

No client data may be used to train, fine-tune, adapt or enhance any AI model.
This is a condition of the Xero developer terms as well as a client expectation.

Consequence: any AI provider used against client data must be on terms that
exclude training. Free consumer tiers of some providers reserve the right to use
inputs for product improvement and are therefore prohibited for this work,
regardless of cost.

### 2.4 Retention and legal hold

**Partially in place.**

| Data | Retention | Status |
|---|---|---|
| Cloud SQL records | Daily backup, 7 retained, point-in-time recovery to the minute | In place |
| Client artefacts | Mirrored and dated snapshots to the shared drive | In place |
| Agent session transcripts | Indefinite, on local disk | **No policy. Gap.** |

**Gap.** Session transcripts accumulate without limit. As at the date of this
note there are 24 on the practitioner's machine totalling 58 MB, of which 10
contain monetary amounts, 8 contain supplier or bank names and 4 name client
entities.

Required: a stated retention period applied consistently, and the ability to
suspend deletion for a specific engagement under dispute or investigation.
Deletion on a timer with no hold capability is worse than retaining everything,
because it destroys evidence precisely when it is needed.

### 2.5 Data minimisation

The audit record is a **structured extract**, not a raw transcript: who asked, in
what capacity, which agent, the instruction given, tools called, file paths
touched, accounting-system calls made, and the output. This answers "what did it
do" while holding mostly actions and paths rather than client content.

Full transcripts are retained only where forensic depth is justified, are
encrypted at rest, and are **not** placed on the shared drive. The shared drive
has a broader access list than the practitioner's machine and includes other
clients' material.

Pseudonymising the client identifier is deliberately **not** relied on as a
control. A record containing amounts, supplier names and entity names identifies
the engagement whatever the header says, and a file labelled with a client code
invites being treated as safe to move.

---

## 3. Professional standards

### 3.1 Segregation of duties

**Gap, and the most material one.**

The system models a review chain: preparer, then FM2, then Financial Controller,
then CFO approval. In the practice as it stands today, every one of those roles
is the same person.

A record showing four review tiers asserts an independence that does not exist.
That is not a criticism of a sole practice, where combining preparation and
review is unavoidable and normal. It is a statement that **the record must not
imply otherwise.**

Required:

- the audit record captures who actually performed each step, by identity, not
  only by role label
- where the same person prepared and reviewed, that fact is recorded explicitly
  rather than left to inference
- any output supporting a professional opinion carries that disclosure

Until this is implemented, the review chain in the system should be treated as a
workflow aid, not as evidence of independent review.

### 3.2 Human review of AI output

No output produced by an agent reaches a client, a board or a ledger without
review by the practitioner. The approval gate is a control, not a convention.

The system enforces this structurally: only work in the CFO-pending state can
reach the posted state, agents are barred from writing to client accounting
systems, and the state of an item is the directory it occupies rather than a
field that can be set.

### 3.3 Working papers

An audit record must be capable of review by someone who was not present. That
requires the **instruction** given to an agent, not only its output, so a
reviewer can judge whether the question was sound rather than only whether the
answer was internally consistent.

### 3.4 Client confidentiality

Individual staff names, remuneration and package detail must not appear in any
output that could reach a board, an executive audience, an auditor or an
investor. The client diary and internal notes may name individuals where context
requires; pack-facing output may not. Anonymisation occurs at the point of pack
generation.

---

## 4. Access and credentials

| Control | Position |
|---|---|
| Application access | Google Cloud Identity-Aware Proxy, IAM-enforced allowlist |
| Database | No public access; application reaches it via an authenticated service |
| Accounting system credentials | Secret Manager only, never in code or repositories |
| Secret read access | Scoped by name condition; the Finance service cannot read unrelated secrets |
| Local credentials | Practitioner's machine, full-disk encryption enabled |
| Credential access logging | Every reveal, copy and rotation recorded with actor, capacity, target and time, including failed attempts |

Verified: accounting system credentials have never been committed to any
repository, on any branch, in any commit.

**Open:** no periodic access review, because there is currently one user. This
becomes required on the first joiner.

---

## 5. Change management

**Gap for a client-facing offering. Acceptable for internal tooling.**

There is a single environment. Changes merge to the main branch and deploy to
production automatically. Continuous integration enforces module boundaries,
schema isolation, type checking and tests before deploy.

During this build a configuration error reached production and hid three modules
from the navigation for several minutes. It was detected by verification after
deploy, not by a gate before it.

Required before client-facing use: a separate non-production environment,
release records, and a documented rollback path.

---

## 6. Continuity and key person

Agent execution depends on the practitioner's machine being available. The
application and its records do not, but nothing can be *done* while that machine
is off.

One person holds every credential and performs every role.

Mitigations in place: code in remote repositories, database backed up with
point-in-time recovery, client artefacts mirrored to the shared drive, secrets in
managed storage.

Not mitigated: execution availability, and key person dependency generally.
Moving execution to an always-on machine addresses the first and not the second.

---

## 7. Gap register

| # | Gap | Severity | Owner | Status |
|---|---|---|---|---|
| 1 | Anthropic not disclosed as sub-processor; no DPA | High | Practice | Open |
| 2 | Inference data residency not established | High | Practice | Open |
| 3 | Audit record implies segregation of duties that does not exist | High | Build | Open |
| 4 | Instruction given to an agent not captured in the record | Medium | Build | Open |
| 5 | No retention period or legal hold for transcripts | Medium | Both | Open |
| 6 | No non-production environment or release record | Medium | Build | Open, deferred until client-facing |
| 7 | Execution depends on a single machine | Medium | Practice | Accepted for now |
| 8 | No periodic access review | Low | Practice | Not yet applicable |

Items 1 and 2 gate further processing of client data through agents. Item 3 gates
any use of the record to support a professional opinion.

---

## 8. Review

This note is reviewed when any of the following changes: the AI provider or its
terms, the set of processors, the number of people with access, the number of
clients, or the move from internal use to a client-facing or licensed offering.

Related: `finance-module-decisions.md` for the reasoning behind individual build
decisions, and `wip-folder-convention.md` for how work is held and moved.
