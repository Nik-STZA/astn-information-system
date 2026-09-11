-- 016: where a pack build's change check started from.
--
-- Before a build, the platform asks Xero, per entity, for every ledger document
-- (invoices and bills, credit notes, bank transactions, manual journals,
-- payments, bank transfers) modified since the previous successful build began.
-- The dates those documents post to say which periods changed and therefore
-- which years the build must re-pull; see finance-api/lib/ledger-changes.js.
-- Xero's /Journals feed would be more direct, but the platform's Xero app cannot
-- be granted accounting.journals.read.
--
-- Recording the watermark on the run itself keeps it with the pack it
-- describes, so no separate state table can drift from the builds it tracks.
-- It is the build's start time, not its end, so changes made while the build
-- runs are picked up by the next one rather than skipped.

ALTER TABLE finance.report_runs
  ADD COLUMN IF NOT EXISTS watermarks jsonb;

COMMENT ON COLUMN finance.report_runs.watermarks IS
  'Per entity slug, the ISO timestamp this build''s change check ran at, e.g. {"ultraspeed-digital": "2026-09-11T15:30:00.000Z"}. The next build asks Xero for everything modified since the latest succeeded run''s value.';
