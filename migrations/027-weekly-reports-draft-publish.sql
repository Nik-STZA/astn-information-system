-- 027-weekly-reports-draft-publish.sql
--
-- Draft -> approve -> publish for the AfricanSTN weekly brief.
--
-- Until now a brief went live on africanstn.com the moment the research agent
-- stored it, before anyone had read it, and the LinkedIn post was approved
-- separately - so the site and the post could carry different stories.
--
-- Now the agent writes the week's edition as a DRAFT. Re-running in the same
-- week regenerates that same row (the unique week_ending from 026 still
-- holds). Approving the week's LinkedIn post in the OS is the single publish
-- action: it stores the final post, flips the edition to 'published', marks
-- the classified_items it used as 'reported' (via item_ids), and triggers the
-- site rebuild. A published edition is locked.
--
-- Existing rows are already public, so they backfill as 'published'.
--
-- Idempotent and re-runnable. weekly_reports is owned by app_user.

ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS item_ids uuid[];

UPDATE weekly_reports
   SET published_at = created_at
 WHERE status = 'published' AND published_at IS NULL;

-- New rows are drafts unless the writer says otherwise.
ALTER TABLE weekly_reports ALTER COLUMN status SET DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reports_status_check'
  ) THEN
    ALTER TABLE weekly_reports
      ADD CONSTRAINT weekly_reports_status_check CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

-- linkedin_drafts.status gains 'superseded': a draft replaced by a re-run of
-- the same week. Values are free text (no constraint), so nothing to alter.
