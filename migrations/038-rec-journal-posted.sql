-- 038-rec-journal-posted.sql
--
-- A journal approved on a reconciliation goes to Xero as a draft, and a person
-- posts it there. Until now os.stza.io never looked again, so a rec's journal
-- showed "Draft in Xero" for good. The Journals page's Xero check now reads
-- these too, the way it reads its own (finance.journals, migration 033):
--
--   state            gains 'posted'
--   xero_status      Xero's status at the last look (DRAFT, POSTED, VOIDED, DELETED)
--   xero_checked_at  when that was
--
-- Additive and re-runnable. Apply BEFORE merging the code that writes them.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_journals ADD COLUMN IF NOT EXISTS xero_status     text;
ALTER TABLE finance.rec_journals ADD COLUMN IF NOT EXISTS xero_checked_at timestamptz;

-- The old check on state, whatever it was named, goes; otherwise it would still
-- refuse 'posted' beside the new one.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'finance.rec_journals'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%state%'
  LOOP
    EXECUTE format('ALTER TABLE finance.rec_journals DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE finance.rec_journals ADD CONSTRAINT rec_journals_state_check
  CHECK (state IN ('proposed', 'approved', 'draft_created', 'posted', 'rejected', 'superseded'));
