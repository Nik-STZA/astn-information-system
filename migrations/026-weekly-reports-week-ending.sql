-- 026-weekly-reports-week-ending.sql
--
-- One edition per week for the AfricanSTN weekly brief.
--
-- weekly_reports had no edition date: africanstn.com used the UTC date of
-- created_at as the edition slug and kept the latest row per date. Every
-- manual re-run INSERTed another row, so the site's editions fell on any
-- weekday, some weeks carried two or three, and a re-run silently replaced
-- what was live (20 Aug 2026: a 0-item third run replaced a 2-story one).
--
-- From now on the research agent stamps week_ending = the Thursday that
-- closes a Friday-to-Thursday week, and refuses a second edition for it.
--
-- Backfill preserves the site exactly as published: the row the site shows
-- today for each date (the latest that day) gets week_ending = that date, so
-- no existing URL changes. Rows it hides keep week_ending NULL, and the site
-- now lists only rows with a week_ending.
--
-- Idempotent and re-runnable.

ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS week_ending date;

WITH shown AS (
  SELECT DISTINCT ON ((created_at AT TIME ZONE 'UTC')::date)
         id, (created_at AT TIME ZONE 'UTC')::date AS d
    FROM weekly_reports
   ORDER BY (created_at AT TIME ZONE 'UTC')::date, created_at DESC
)
UPDATE weekly_reports w
   SET week_ending = shown.d
  FROM shown
 WHERE w.id = shown.id
   AND w.week_ending IS NULL
   AND NOT EXISTS (SELECT 1 FROM weekly_reports x WHERE x.week_ending = shown.d);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_week_ending_key
  ON weekly_reports (week_ending);
