-- 037-wip-close.sql
--
-- An Approvals folder item can be closed off in os.stza.io, the way a Work task
-- is: each live item has a Work task, and marking that task done closes the
-- item. The folder on disk is not moved, so the close is recorded here, and the
-- folder import (scripts/import-wip.mjs) leaves these columns alone.
--
--   closed_at    when it was closed; NULL while it is live
--   closed_by    who closed it
--   closed_note  why, or what was done
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads closed_at.

SET lock_timeout = '10s';

ALTER TABLE finance.wip_items ADD COLUMN IF NOT EXISTS closed_at   timestamptz;
ALTER TABLE finance.wip_items ADD COLUMN IF NOT EXISTS closed_by   text;
ALTER TABLE finance.wip_items ADD COLUMN IF NOT EXISTS closed_note text;

-- Items whose Work task a person already marked done (before this, that did
-- not close the item, so it stayed in Review). Closed as of that task.
UPDATE finance.wip_items w
   SET closed_at = t.closed_at,
       closed_by = COALESCE((SELECT e.actor FROM finance.task_events e
                              WHERE e.task_id = t.id AND e.action = 'status' AND e.actor <> 'automatic'
                              ORDER BY e.at DESC LIMIT 1), 'unknown'),
       closed_note = 'Its Work task was marked done before closing an item was possible'
  FROM finance.tasks t
 WHERE t.client_id = w.client_id AND t.source = 'approval' AND t.source_ref = w.id::text
   AND t.status = 'done' AND t.deleted_at IS NULL AND t.closed_at IS NOT NULL
   AND w.closed_at IS NULL
   AND w.panel IN ('awaiting-decision', 'in-progress-upstream', 'blocked-external')
   AND EXISTS (SELECT 1 FROM finance.task_events e WHERE e.task_id = t.id AND e.action = 'status' AND e.actor <> 'automatic');

COMMENT ON COLUMN finance.wip_items.closed_at IS
  'Closed off in os.stza.io (its Work task marked done). The folder import does not change it.';

-- The app closes items, so it updates them.
GRANT SELECT, UPDATE ON finance.wip_items TO africastn_app;
