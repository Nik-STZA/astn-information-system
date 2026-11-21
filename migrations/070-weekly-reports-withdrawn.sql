-- Migration 070: weekly_reports gains a 'withdrawn' status
-- Date: 20 November 2026
-- Branch: feature/brief-pipeline. NOT APPLIED. Apply only after Nik approves.
--
-- A withdrawn brief is taken off africanstn.com (the public feed,
-- GET /api/content/briefs?full=1, returns status = 'published' only) but
-- keeps its row, text and item_ids, so the record is never lost and its
-- items stay claimed. redirect_to names the brief its old URL should point
-- to; the website's redirects file mirrors it. Reversible: set status back
-- to 'published' and clear the three columns.

BEGIN;

ALTER TABLE weekly_reports DROP CONSTRAINT IF EXISTS weekly_reports_status_check;
ALTER TABLE weekly_reports
  ADD CONSTRAINT weekly_reports_status_check CHECK (status IN ('draft', 'published', 'withdrawn'));

ALTER TABLE weekly_reports
  ADD COLUMN IF NOT EXISTS withdrawn_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT,
  ADD COLUMN IF NOT EXISTS redirect_to      DATE;

COMMENT ON COLUMN weekly_reports.redirect_to IS
  'For a withdrawn brief: the week_ending (UK date) of the brief its public URL redirects to.';

COMMIT;
