-- 024: Work (redesign step 3, 27 Oct 2026).
--
-- One task system for everything in flight for a client: tasks and sub-tasks,
-- what blocks them, and the full history of each, so "where are we" can be
-- answered at any moment (Nik's brief). Approvals, open items and month-end
-- close move into it in later steps.
--
--   finance.tasks          a task, or a sub-task (parent_id)
--   finance.task_blockers  what holds a task up: another task, a Bills item, or
--                          someone outside (a client, supplier, HMRC). A task
--                          or Bills blocker clears itself when that task is done
--                          or that bill is decided; an outside one is cleared
--                          by a person.
--   finance.task_events    append-only history: every create, change, block,
--                          unblock and close, with who and when.
--
-- A task's shown status is computed: an open task with an unresolved task or
-- Bills blocker shows Blocked, one waiting only on an outside party shows
-- Waiting (lib/work.js). The stored status is what a person set.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS finance.tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id     uuid REFERENCES finance.entities (id) ON DELETE SET NULL,
  parent_id     uuid REFERENCES finance.tasks (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  notes         text,
  status        text NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority      text CHECK (priority IN ('P1', 'P2', 'P3')),
  -- A person (an email) or an agent (ap-clerk, fm1, fc...).
  owner_kind    text CHECK (owner_kind IN ('person', 'agent')),
  owner         text,
  start_on      date,
  due_on        date,
  position      integer NOT NULL DEFAULT 0,
  -- Where it came from: manual, template, bills, agent, claude, open_item, approval.
  source        text NOT NULL DEFAULT 'manual',
  source_ref    text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  -- Deleting hides a task but keeps it and its history (the record of where
  -- things stood must survive a delete).
  deleted_at    timestamptz,
  deleted_by    text,
  CONSTRAINT task_owner CHECK ((owner_kind IS NULL) = (owner IS NULL)),
  CONSTRAINT task_dates CHECK (start_on IS NULL OR due_on IS NULL OR start_on <= due_on),
  CONSTRAINT task_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS tasks_client_idx ON finance.tasks (client_id, status, due_on);
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON finance.tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_once ON finance.tasks (client_id, source, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance.task_blockers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES finance.tasks (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('task', 'ap_item', 'external')),
  blocking_task_id  uuid REFERENCES finance.tasks (id) ON DELETE CASCADE,
  ap_item_id        uuid REFERENCES finance.ap_items (id) ON DELETE SET NULL,
  -- For an outside party: who (client, supplier, HMRC, bank...) and what for.
  party             text,
  description       text,
  since             timestamptz NOT NULL DEFAULT now(),
  chase_on          date,
  resolved_at       timestamptz,
  resolved_by       text,
  created_by        text NOT NULL,
  CONSTRAINT blocker_shape CHECK (
    (kind = 'task' AND blocking_task_id IS NOT NULL) OR
    (kind = 'ap_item' AND ap_item_id IS NOT NULL) OR
    (kind = 'external' AND party IS NOT NULL)
  ),
  CONSTRAINT blocker_not_self CHECK (blocking_task_id IS NULL OR blocking_task_id <> task_id)
);
CREATE INDEX IF NOT EXISTS task_blockers_task_idx ON finance.task_blockers (task_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS task_blockers_blocking_idx ON finance.task_blockers (blocking_task_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS task_blockers_ap_idx ON finance.task_blockers (ap_item_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS finance.task_events (
  id        bigserial PRIMARY KEY,
  task_id   uuid NOT NULL REFERENCES finance.tasks (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL,
  -- created, changed, status, blocked, unblocked, deleted_subtask, comment
  action    text NOT NULL,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON finance.task_events (task_id, at DESC);
CREATE INDEX IF NOT EXISTS task_events_client_idx ON finance.task_events (client_id, at DESC);

-- History is append-only.
CREATE OR REPLACE FUNCTION finance.task_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finance.task_events is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_events_no_update ON finance.task_events;
CREATE TRIGGER task_events_no_update BEFORE UPDATE ON finance.task_events
  FOR EACH ROW EXECUTE FUNCTION finance.task_events_append_only();

DROP TRIGGER IF EXISTS set_updated_at ON finance.tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.tasks
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
