-- 034-monthly-releases.sql
--
-- Monthly release journals from a reconciliation's schedule.
--
-- Xero's API cannot create or read a repeating manual journal, so os.stza.io
-- does the repeating itself. Releases are switched on once for an account, by
-- the CFO, on its reconciliation. From then on, each time a month's checks run,
-- finance-api proposes that month's release journal for each company on the
-- Journals page, for the items Xero does not already show as released. The
-- CFO approves it there and it is created in Xero as a DRAFT, as any other
-- journal on the page.
--
--   finance.rec_accounts   releases_on, and who switched it and when
--   finance.journals       source 'schedule', and the account and rec it came
--                          from. One live release per account, company and month.
--
-- Additive and re-runnable.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_accounts
  ADD COLUMN IF NOT EXISTS releases_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS releases_by text,
  ADD COLUMN IF NOT EXISTS releases_at timestamptz;

COMMENT ON COLUMN finance.rec_accounts.releases_on IS
  'os.stza.io proposes the monthly release journal from the schedule when the month''s checks run. Set by the CFO on the reconciliation.';

ALTER TABLE finance.journals
  ADD COLUMN IF NOT EXISTS rec_account_id uuid REFERENCES finance.rec_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rec_id uuid REFERENCES finance.recs (id) ON DELETE SET NULL;

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journals_source_check;
ALTER TABLE finance.journals ADD CONSTRAINT journals_source_check CHECK (source IN ('person', 'agent', 'schedule'));

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journal_schedule_has_account;
ALTER TABLE finance.journals ADD CONSTRAINT journal_schedule_has_account CHECK (source <> 'schedule' OR rec_account_id IS NOT NULL);

-- One release per account, company and month that is waiting, going to Xero,
-- or in Xero. A rejected one leaves room for the next.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_release
  ON finance.journals (rec_account_id, entity_id, period)
  WHERE source = 'schedule' AND state IN ('proposed', 'approved', 'draft_created', 'posted');

GRANT SELECT, INSERT, UPDATE ON finance.journals TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.rec_accounts TO africastn_app;
