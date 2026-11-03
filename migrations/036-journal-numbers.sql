-- 036-journal-numbers.sql
--
-- A short number for every journal, so a person and an agent can name the same
-- one: JNL-7. Numbered per client, once, across both registers (a rec's own
-- journals in finance.rec_journals and the Journals page's finance.journals),
-- so JNL-7 means one journal for that client wherever it shows. A number is
-- never reused: a rejected or superseded journal keeps its number.
--
--   finance.journal_numbers        the last number given, per client
--   finance.journals.jnl_no        set on insert by a trigger
--   finance.rec_journals.jnl_no    the same counter
--
-- Existing journals are numbered in the order they were made.
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads jnl_no.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.journal_numbers (
  client_id  uuid PRIMARY KEY REFERENCES shared.clients (id) ON DELETE CASCADE,
  last_no    integer NOT NULL CHECK (last_no >= 0)
);

ALTER TABLE finance.journals     ADD COLUMN IF NOT EXISTS jnl_no integer;
ALTER TABLE finance.rec_journals ADD COLUMN IF NOT EXISTS jnl_no integer;

-- Number what is already there, oldest first, per client and across both
-- tables, carrying on from anything numbered by an earlier run of this file.
DROP TABLE IF EXISTS pg_temp.jnl_backfill;
CREATE TEMP TABLE jnl_backfill AS
WITH unnumbered AS (
  SELECT 'j' AS t, id, client_id, created_at FROM finance.journals WHERE jnl_no IS NULL
  UNION ALL
  SELECT 'r', id, client_id, created_at FROM finance.rec_journals WHERE jnl_no IS NULL
), base AS (
  SELECT client_id, max(n) AS n FROM (
    SELECT client_id, jnl_no AS n FROM finance.journals WHERE jnl_no IS NOT NULL
    UNION ALL
    SELECT client_id, jnl_no FROM finance.rec_journals WHERE jnl_no IS NOT NULL
  ) x GROUP BY client_id
)
SELECT u.t, u.id,
       COALESCE(b.n, 0) + row_number() OVER (PARTITION BY u.client_id ORDER BY u.created_at, u.t, u.id) AS n
  FROM unnumbered u LEFT JOIN base b ON b.client_id = u.client_id;

UPDATE finance.journals j SET jnl_no = b.n FROM jnl_backfill b WHERE b.t = 'j' AND j.id = b.id;
UPDATE finance.rec_journals r SET jnl_no = b.n FROM jnl_backfill b WHERE b.t = 'r' AND r.id = b.id;
DROP TABLE jnl_backfill;

-- The counter starts after the highest number given.
INSERT INTO finance.journal_numbers (client_id, last_no)
SELECT client_id, max(n) FROM (
  SELECT client_id, jnl_no AS n FROM finance.journals
  UNION ALL
  SELECT client_id, jnl_no FROM finance.rec_journals
) x WHERE n IS NOT NULL GROUP BY client_id
ON CONFLICT (client_id) DO UPDATE SET last_no = GREATEST(finance.journal_numbers.last_no, EXCLUDED.last_no);

-- Each new journal takes the next number. The counter row is locked for the
-- rest of the inserting transaction, so two at once cannot take the same one.
CREATE OR REPLACE FUNCTION finance.assign_jnl_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.jnl_no IS NULL THEN
    INSERT INTO finance.journal_numbers AS c (client_id, last_no) VALUES (NEW.client_id, 1)
    ON CONFLICT (client_id) DO UPDATE SET last_no = c.last_no + 1
    RETURNING last_no INTO NEW.jnl_no;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS journals_jnl_no ON finance.journals;
CREATE TRIGGER journals_jnl_no BEFORE INSERT ON finance.journals
  FOR EACH ROW EXECUTE FUNCTION finance.assign_jnl_no();

DROP TRIGGER IF EXISTS rec_journals_jnl_no ON finance.rec_journals;
CREATE TRIGGER rec_journals_jnl_no BEFORE INSERT ON finance.rec_journals
  FOR EACH ROW EXECUTE FUNCTION finance.assign_jnl_no();

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_jnl_no     ON finance.journals (client_id, jnl_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_rec_journals_jnl_no ON finance.rec_journals (client_id, jnl_no);

-- Every row is numbered now, and the trigger numbers every new one.
ALTER TABLE finance.journals     ALTER COLUMN jnl_no SET NOT NULL;
ALTER TABLE finance.rec_journals ALTER COLUMN jnl_no SET NOT NULL;

COMMENT ON COLUMN finance.journals.jnl_no IS
  'Shown as JNL-n. Per client, shared with finance.rec_journals, never reused. Set by trigger from finance.journal_numbers.';
COMMENT ON COLUMN finance.rec_journals.jnl_no IS
  'Shown as JNL-n. Per client, shared with finance.journals, never reused. Set by trigger from finance.journal_numbers.';

-- The app inserts journals, so it takes numbers.
GRANT SELECT, INSERT, UPDATE ON finance.journal_numbers TO africastn_app;
