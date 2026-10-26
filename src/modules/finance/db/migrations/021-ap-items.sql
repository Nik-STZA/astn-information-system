-- 021: the AP queue (docs/ap-lane/phase3-design.md, 2.1).
--
-- One row per document found in a Documents-inbox file. A file holding several
-- invoices gives several rows. A file that is not a document at all (an email
-- signature logo, a text file) gives one 'skipped' row, so it is not listed
-- again on the next intake.
--
-- The row holds results, never method (spec D5): what was read, the bill the
-- engine proposes, the checks against it, and the CFO's decision. The prompts
-- and rules stay in finance-api.
--
-- States:
--   skipped     not a document; state_reason says why
--   clean       every check passed; can be approved with the batch
--   exception   for the CFO (spec 3.3); review.reasons says why
--   approved    the CFO approved it in the portal (edits, if any, in edits)
--   written     the bill is in Xero at SUBMITTED (xero_invoice_id)
--   rejected    the CFO rejected it (decision_note says why)
--   superseded  replaced by a later read of the same file
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS finance.ap_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id           uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- The file in Xero Files, and which document in it this row is.
  xero_file_id        text NOT NULL,
  file_name           text NOT NULL,
  mime_type           text,
  file_sha256         text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_received_at    timestamptz,
  document_index      integer NOT NULL DEFAULT 0 CHECK (document_index >= 0),
  -- The intake run, and what was read.
  run_id              uuid NOT NULL,
  model               text,
  model_location      text,
  extraction          jsonb,
  usage               jsonb,
  -- The supplier matched, the bill proposed, and the checks against it.
  supplier_entity_id  uuid REFERENCES finance.supplier_entities (id) ON DELETE SET NULL,
  matched_by          text,
  proposed_bill       jsonb,
  review              jsonb,
  state               text NOT NULL
                        CHECK (state IN ('skipped', 'clean', 'exception', 'approved', 'written', 'rejected', 'superseded')),
  state_reason        text,
  -- The CFO's decision.
  decided_by_email    text,
  decided_at          timestamptz,
  decision_note       text,
  edits               jsonb,
  -- The write to Xero.
  xero_invoice_id     text,
  written_at          timestamptz,
  write_error         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_item_once UNIQUE (entity_id, xero_file_id, document_index),
  CONSTRAINT ap_item_skip_reason CHECK (state <> 'skipped' OR state_reason IS NOT NULL),
  CONSTRAINT ap_item_decided CHECK (
    state NOT IN ('approved', 'rejected', 'written') OR (decided_by_email IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT ap_item_rejected_reason CHECK (state <> 'rejected' OR decision_note IS NOT NULL),
  CONSTRAINT ap_item_written CHECK (state <> 'written' OR (xero_invoice_id IS NOT NULL AND written_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ap_items_queue_idx ON finance.ap_items (entity_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS ap_items_client_idx ON finance.ap_items (client_id, state);

DROP TRIGGER IF EXISTS set_updated_at ON finance.ap_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.ap_items
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
