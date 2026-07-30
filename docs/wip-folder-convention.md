# WIP folder convention

How work in progress is held on disk, how it moves through review, and what the
portal reads. Created for a client automatically at onboarding; see
`scripts/onboard-client.mjs`.

The file system remains the source of truth. Agents read and write these
folders; the portal mirrors them and acts on them. Nothing here requires the
portal to be running.

## Shape

```
clients/<client-slug>/
  wip/                                  group-scoped work
    pending-cfo/
      2026-07-31-month-end-group-pack/
        wip.json
        review.md
        artefacts/
  entities/
    <entity-slug>/
      wip/                              entity-scoped work
        drafting/
        pending-fm/
        pending-fc/
        pending-cfo/
        sent-back/
          fm1/
          fm2/
          fc/
          clerk/
        posted/
        rejected/
```

Entity-scoped work sits under the entity it belongs to. Group-scoped work
(intercompany reconciliation, consolidation, the management pack) sits at the
client root. Filing cross-entity work under one company would misstate whose
approval record it is, and the path is what makes an item's entity unambiguous.

That matters because the client CLAUDE.md already records the risk: three
entities with similar names and a high chance of mis-keying. The convention
should make that mistake hard, not merely visible.

## Batch folder naming

```
<YYYY-MM-DD>-<type>-<short-slug>
```

Date first so a directory listing sorts chronologically. Type from the set in
the data model: `ap`, `ar`, `vat`, `month-end`, `reconciliation`, `tax`, `fpa`.

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
| `sent-back/<tier>/` | Returned to a tier with findings | In progress upstream |
| `posted/` | Approved and written to the ledger | Activity |
| `rejected/` | Declined, no ledger effect | Activity |

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
