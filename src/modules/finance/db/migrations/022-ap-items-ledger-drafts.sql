-- 022: AP queue items from drafts the ledger keyed itself.
--
-- A document emailed to an entity's Xero bills address arrives as a DRAFT bill
-- with the document attached, and never reaches the Documents inbox (FSL, 27 Oct
-- 2026). Intake now reads those drafts too. Sending one updates the draft in
-- place instead of creating a second bill.
--
-- Named ledger_*, not xero_*: nothing here is particular to Xero (a QuickBooks
-- or other ledger connection would fill the same columns).
--
--   source                files_inbox (the Documents inbox, as before) or ledger_draft
--   ledger_draft_id       the draft bill's id in the ledger
--   ledger_draft_version  its last-changed stamp when read: a draft edited after
--                         that is read again, and the older row superseded
--   ledger_attachment_id  the attachment read
--   ledger_draft          the draft as the ledger keyed it, for the CFO to compare
--
-- For a ledger_draft row, xero_file_id holds draft:<id>:<version>, so the
-- once-per-document constraint holds per version of the draft.
--
-- Idempotent.

ALTER TABLE finance.ap_items
  ADD COLUMN IF NOT EXISTS source               text NOT NULL DEFAULT 'files_inbox',
  ADD COLUMN IF NOT EXISTS ledger_draft_id      text,
  ADD COLUMN IF NOT EXISTS ledger_draft_version text,
  ADD COLUMN IF NOT EXISTS ledger_attachment_id text,
  ADD COLUMN IF NOT EXISTS ledger_draft         jsonb;

ALTER TABLE finance.ap_items DROP CONSTRAINT IF EXISTS ap_item_source;
ALTER TABLE finance.ap_items ADD CONSTRAINT ap_item_source CHECK (source IN ('files_inbox', 'ledger_draft'));

ALTER TABLE finance.ap_items DROP CONSTRAINT IF EXISTS ap_item_ledger_draft;
ALTER TABLE finance.ap_items ADD CONSTRAINT ap_item_ledger_draft
  CHECK (source <> 'ledger_draft' OR (ledger_draft_id IS NOT NULL AND ledger_draft_version IS NOT NULL));

CREATE INDEX IF NOT EXISTS ap_items_ledger_draft_idx ON finance.ap_items (entity_id, ledger_draft_id) WHERE ledger_draft_id IS NOT NULL;
