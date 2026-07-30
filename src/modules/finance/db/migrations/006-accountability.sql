-- 006-accountability.sql
--
-- Two changes, both about making the record say what actually happened.
--
-- 1. Who performed each step, by identity rather than by role label.
--
-- The system models preparer, FM2, FC and CFO. Today all four are the same
-- person. Combining preparation and review is normal and unavoidable in a sole
-- practice; a record asserting four tiers of independent review is not. So the
-- record captures identity, and independence becomes something derived and
-- stated rather than implied by a job title.
--
-- Agent-performed work is a third case and is recorded as such: an agent acting
-- under a named person's instruction is not an independent reviewer, but it is
-- different from that person preparing the work by hand, and the record should
-- distinguish them.
--
-- 2. What an agent was told, not only what it returned.
--
-- A working paper has to be reviewable by someone who was not there. That needs
-- the instruction, so a reviewer can judge whether the question was sound rather
-- than only whether the answer was internally consistent.
--
-- Idempotent and re-runnable.

-- ── Who prepared, and who reviewed ───────────────────────────────────────────

ALTER TABLE finance.wip_items
  ADD COLUMN IF NOT EXISTS drafter_email  text,
  ADD COLUMN IF NOT EXISTS drafter_agent  text;

COMMENT ON COLUMN finance.wip_items.drafter_email IS
  'The person accountable for preparing this item. Where an agent did the work, this is the person who instructed it, not the agent.';
COMMENT ON COLUMN finance.wip_items.drafter_agent IS
  'The agent that prepared the work, if any. Null means a person prepared it directly.';

ALTER TABLE finance.wip_review_log
  ADD COLUMN IF NOT EXISTS reviewer_email text,
  ADD COLUMN IF NOT EXISTS reviewer_agent text;

COMMENT ON COLUMN finance.wip_review_log.reviewer_email IS
  'The person accountable for this review step. Compare against wip_items.drafter_email to establish whether the review was independent.';

CREATE INDEX IF NOT EXISTS idx_finance_review_reviewer
  ON finance.wip_review_log (reviewer_email);

-- Derived, never stored: independence is a fact about the identities on the
-- record, and storing it would let it drift from them.
--
-- Returns true only where some review step was performed by a different person
-- from the one accountable for preparing the work. Unknown identities count as
-- not independent: absence of evidence is not evidence of independence.
CREATE OR REPLACE FUNCTION finance.has_independent_review(p_wip_id uuid)
RETURNS boolean AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM finance.wip_review_log r
      JOIN finance.wip_items w ON w.id = r.wip_id
      WHERE r.wip_id = p_wip_id
        AND r.reviewer_email IS NOT NULL
        AND w.drafter_email IS NOT NULL
        AND r.reviewer_email <> w.drafter_email
    ),
    false
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION finance.has_independent_review IS
  'True only where a review step was performed by someone other than the person accountable for preparation. Unknown identities return false: absence of evidence is not evidence of independence.';


-- ── What the agent was told ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.agent_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,

  requested_by_email  text NOT NULL,
  requested_by_role   text,
  agent               text,

  -- The working paper depends on this. Not nullable.
  instruction         text NOT NULL CHECK (length(trim(instruction)) > 0),

  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','succeeded','failed','cancelled')),

  -- Links to the full session transcript on the machine that ran it.
  session_id          text,
  output              text,
  error               text,

  -- The forensic extract: what it called and what it touched, not what it read.
  tools_used          jsonb NOT NULL DEFAULT '[]'::jsonb,
  files_touched       jsonb NOT NULL DEFAULT '[]'::jsonb,

  duration_ms         integer,
  cost_usd            numeric,

  -- Set where a run produced work needing approval.
  wip_ref             text,

  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz
);

COMMENT ON TABLE finance.agent_runs IS
  'One row per agent execution, whether or not it produced work to approve. A run that only answered a question still read client data and is still recorded.';
COMMENT ON COLUMN finance.agent_runs.instruction IS
  'What the agent was told. Required, because a reviewer must be able to judge the question and not only the answer.';
COMMENT ON COLUMN finance.agent_runs.files_touched IS
  'Paths only, never contents. The extract answers what was done while holding little client detail.';

CREATE INDEX IF NOT EXISTS idx_finance_agent_runs_client
  ON finance.agent_runs (client_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_agent_runs_status
  ON finance.agent_runs (status, queued_at);

-- A run in flight must be updatable; a finished one must not. Otherwise the
-- record of what an agent did could be rewritten after the fact, which is the
-- same failure the notes table exists to prevent.
CREATE OR REPLACE FUNCTION finance.agent_runs_immutable_once_finished()
RETURNS trigger AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION
      'agent run % finished at % and cannot be altered. Record a correction against it instead.',
      OLD.id, OLD.finished_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_runs_no_update_when_finished ON finance.agent_runs;
CREATE TRIGGER agent_runs_no_update_when_finished BEFORE UPDATE ON finance.agent_runs
  FOR EACH ROW EXECUTE FUNCTION finance.agent_runs_immutable_once_finished();

DROP TRIGGER IF EXISTS agent_runs_no_delete ON finance.agent_runs;
CREATE TRIGGER agent_runs_no_delete BEFORE DELETE ON finance.agent_runs
  FOR EACH ROW EXECUTE FUNCTION finance.notes_are_append_only();
