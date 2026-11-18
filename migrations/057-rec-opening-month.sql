-- 057: a month closed outside os.stza.io (CFO, 18 Nov 2026). A client's first
-- month in the platform was closed in its old process; its reconciliations
-- were never worked here, so the next month showed it as "still open" and
-- could not be signed. The CFO marks it as the opening month, with a note:
-- its closing is accepted as the next month's opening, and it is not worked.
--
-- Idempotent.
ALTER TABLE finance.rec_periods ADD COLUMN IF NOT EXISTS opening_month boolean NOT NULL DEFAULT false;
ALTER TABLE finance.rec_periods ADD COLUMN IF NOT EXISTS opening_note  text;
ALTER TABLE finance.rec_periods ADD COLUMN IF NOT EXISTS opening_by    text;
ALTER TABLE finance.rec_periods ADD COLUMN IF NOT EXISTS opening_at    timestamptz;

COMMENT ON COLUMN finance.rec_periods.opening_month IS
  'Closed outside os.stza.io: the next month takes this month''s closing as its opening and does not wait for its reconciliations.';
