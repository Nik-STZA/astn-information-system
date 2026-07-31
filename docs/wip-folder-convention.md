# WIP folder convention

**The authoritative definition is `handoff-protocol/SKILL.md` in the
stza-finance-agents plugin.** The agents read that; the portal reads this. Where
the two disagree, the skill wins and this file is wrong.

This file records what the portal expects and why, so a change here without a
matching change there is a bug. That is not hypothetical: the portal was built
against a convention invented here while the skill already specified a different
one, and the two produced folder layouts that could not both be read.

How work in progress is held on disk, how it moves through review, and what the
portal reads. Created for a client automatically at onboarding; see
`scripts/onboard-client.mjs`.

The file system remains the source of truth. Agents read and write these
folders; the portal mirrors them and acts on them. Nothing here requires the
portal to be running.

## Shape

```
clients/<client-slug>/
  wip/                                  LIVE work only, group-scoped
    drafting/<type>/<batch>/
    pending-fm/<type>/<batch>/
    pending-fc/<type>/<batch>/
    pending-cfo/<type>/<batch>/
      month-end/2026-07-31-pack-sign-off/
        wip.json
        review.md
        artefacts/
    sent-back/<type>/<batch>/
  posted/<YYYY>/<MM>/<type>/<batch>/    finished, out of the queue
  rejected/<YYYY>/<MM>/<type>/<batch>/
  entities/
    <entity-slug>/                      same shape again, entity-scoped
      wip/<state>/<type>/<batch>/
      posted/<YYYY>/<MM>/<type>/<batch>/
      rejected/<YYYY>/<MM>/<type>/<batch>/
```

Live work is `wip/<state>/<type>/<batch>`. Finished work leaves `wip/`
entirely.

**Both attributes are in the path, deliberately.** They behave differently and
each is there for its own reason.

**State** is where an item sits in the review chain, and it changes three to
five times. It is in the path because a state that is a field can be stale,
wrong, or edited without the folder moving. Here it cannot disagree with itself:
the state IS the location, correct by construction and visible in Explorer
without the portal.

**Type** is what kind of work it is, and it never changes. It is in the path
because the previous convention lost it. Work was created at `wip/ap/<batch>`
but escalated to `wip/pending-fc/`, at which point an AP batch and a VAT return
became indistinguishable by path.

**State comes first** because the question asked most often is "what needs me",
which is then one directory listing with type as natural grouping inside it.

**Only the state level is created at onboarding.** Every type under every state
would be 49 empty directories per entity before any work exists. A type folder
appears when work of that type first does.

**Finished work leaves `wip/`.** `posted/` and `rejected/` sit at the client
root, archived by month. So `wip/` holds only what is outstanding, the archive
never grows inside the queue, and an item cannot appear in both. Anything
`posted` or `rejected` found inside `wip/` is refused rather than read, because
that would let the queue and the archive disagree about the same item.

**The tier a sent-back item went to is not in the path.** It is a property of
the last review rather than a place, `review.md` already records it, and adding
it would make the tree four deep.

Entity-scoped work sits under the entity it belongs to. Group-scoped work
(intercompany reconciliation, consolidation, the management pack) sits at the
client root. Filing cross-entity work under one company would misstate whose
approval record it is, and the path is what makes an item's entity unambiguous.

That matters because the client CLAUDE.md already records the risk: three
entities with similar names and a high chance of mis-keying. The convention
should make that mistake hard, not merely visible.

## Batch folder naming

```
<YYYY-MM-DD>-<short-slug>
```

Date first so a directory listing sorts chronologically. The type is already
the parent directory and is not repeated here.

Types are `ap`, `ar`, `vat`, `month-end`, `reconciliation`, `tax`, `fpa`.

The name is for humans. It is never identity: see below.

## wip.json

Written once when the folder is created, and not rewritten as it moves.

```json
{
  "ref": "b2b0c7e4-...",
  "type": "vat",
  "entityScope": "entity",
  "entity": "ultraspeed-digital",
  "title": "VAT return, quarter ended 30 June 2026",
  "amountTotal": "18420.50",
  "currency": "GBP",
  "drafterRole": "FM2",
  "draftedAt": "2026-07-31T09:14:00Z"
}
```

`ref` is the identity. Everything else is descriptive.

`entity` and `type` in the manifest must agree with the path, and a folder where
they disagree is refused rather than silently resolved either way. The path is
what an operator can see, and a disagreement is a copy-paste.

**Why the folder path cannot be the identity.** The lifecycle of a WIP item is
moving its folder between state directories. Keying on the path means the key
changes on every transition, the existing row orphans and a new one appears, so
the approval history detaches from the item at the moment it is approved. The
first version of the schema made exactly that mistake, mirroring an earlier one
where the markdown mirror was keyed on line numbers.

## review.md

Append only. One block per review, oldest first. Nothing is ever edited or
removed; a reversal is a new entry.

```markdown
## 2026-07-31 14:02 — FC

**Outcome:** Sent back
**Findings:**
- Box 6 excludes the July credit note
**Next step:** FM2 to re-run and resubmit
```

The portal parses this into `finance.wip_review_log` and renders it as the
review chain on the approval detail.

## States

| Folder | Meaning | Approvals panel |
|---|---|---|
| `drafting/` | Being prepared, not yet submitted | In progress upstream |
| `pending-fm/` | With FM1 or FM2 | In progress upstream |
| `pending-fc/` | With the FC | In progress upstream |
| `pending-cfo/` | Awaiting the CFO. **The only approval gate.** | Awaiting decision |
| `sent-back/` | Returned to a tier with findings, tier recorded in review.md | In progress upstream |
| `posted/<YYYY>/<MM>/` | Approved and written to the ledger. Outside `wip/`. | Activity |
| `rejected/<YYYY>/<MM>/` | Declined, no ledger effect. Outside `wip/`. | Activity |

Routing follows the tiers already recorded in the client CLAUDE.md: `FM1 → FC →
CFO` for month-end work, `clerk → FM2 → FC → CFO` for AP, AR and VAT. The CFO
is the only approval gate.

A folder is in exactly one state directory. State is the folder it sits in, not
a field, so it is correct by construction and visible in Explorer without the
portal.

## Approval and the ledger

On approval the portal moves the folder to `posted/` and, for journal-bearing
types, writes to Xero as described in `finance-module-decisions.md`: the journal
is created as a draft on submission and flipped to posted on approval, carrying
the approval reference in its narration and a note in Xero's History and Notes.

`wip.json` `ref` is that approval reference, which is what lets an auditor move
between the ledger entry and the full review chain in either direction.

## What onboarding creates

`scripts/onboard-client.mjs` creates, for a new client:

- the folder tree above, cloned from `Clients/_template`
- one `entities/<slug>/` per entity with its own WIP tree
- `shared.clients`, `finance.client_finance_config` and `finance.entities` rows
- the engagement capacity in `finance.client_engagement_roles`, which is
  required rather than optional because an approval must record the capacity it
  was given in

It is idempotent: running it against an existing client adds anything missing
and changes nothing that is already there.
