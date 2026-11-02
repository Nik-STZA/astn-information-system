-- 035-release-per-item.sql
--
-- Monthly releases (migration 034), one journal per schedule item rather than
-- one per company, so one supplier's release can be reversed in Xero without
-- touching the others.
--
--   finance.journals.schedule_item_id   the item a monthly release is for
--
-- One live release per item and month replaces one per account, company and
-- month. A whole-company release still waiting is withdrawn, so the next
-- checks propose it again item by item and nothing is released twice. One
-- already approved or in Xero is kept: the checks then see it in Xero and
-- leave its items out. The item rule binds new rows only (NOT VALID), as an
-- older release has no item.
--
-- Additive and re-runnable.

SET lock_timeout = '10s';

ALTER TABLE finance.journals
  ADD COLUMN IF NOT EXISTS schedule_item_id uuid REFERENCES finance.rec_schedule_items (id);

UPDATE finance.journals SET state = 'superseded', updated_at = now()
 WHERE source = 'schedule' AND schedule_item_id IS NULL AND state = 'proposed';

DROP INDEX IF EXISTS finance.idx_finance_journals_release;

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_release_item
  ON finance.journals (schedule_item_id, period)
  WHERE source = 'schedule' AND state IN ('proposed', 'approved', 'draft_created', 'posted');

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journal_schedule_has_account;
ALTER TABLE finance.journals ADD CONSTRAINT journal_schedule_has_account
  CHECK (source <> 'schedule' OR (rec_account_id IS NOT NULL AND schedule_item_id IS NOT NULL)) NOT VALID;
