-- 013-journal-posts-pending.sql
--
-- Adds 'pending' to finance.journal_posts.outcome.
--
-- 011 allowed only terminal outcomes, which makes the idempotency key claimable
-- only AFTER the journal has been sent to Xero. That leaves a window: two
-- concurrent requests carrying the same key both find no existing row, both
-- post, and the ledger gets the journal twice. The unique constraint would then
-- reject the second insert, so the double post would not even be recorded.
--
-- With 'pending', the key is claimed before the Xero call. The insert either
-- wins - and that request owns the post - or conflicts, and the loser can see
-- that a post with that key is already in flight and refuse rather than
-- duplicate it.
--
-- Idempotent and re-runnable.

BEGIN;

ALTER TABLE finance.journal_posts
  DROP CONSTRAINT IF EXISTS journal_posts_outcome_check;

ALTER TABLE finance.journal_posts
  ADD CONSTRAINT journal_posts_outcome_check
  CHECK (outcome IN ('pending', 'posted', 'draft', 'failed', 'dry_run'));

-- A claim that never resolved is a crash between claiming the key and recording
-- the result. The journal may or may not exist in Xero, so it needs a human to
-- look rather than an automatic retry.
COMMENT ON COLUMN finance.journal_posts.outcome IS
  'pending = claimed, not yet resolved. A row left pending means the process '
  'died between claiming the key and recording the Xero result; check Xero '
  'before retrying, because the journal may have posted.';

COMMIT;
