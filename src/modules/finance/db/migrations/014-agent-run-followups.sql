-- 014: follow-ups on agent runs.
--
-- A finished run is immutable (006), so replying to one cannot extend it. A
-- follow-up is a new run that names the run it replies to, and the chain of
-- parent_run_id links is the conversation.
--
-- Deliberately no transcript column. What a follow-up needs from the earlier
-- turns is the question asked and the answer given, and both are already
-- recorded in instruction and output. Storing the raw tool results as well
-- would put full ledger extracts in this table, which 006 set out to avoid
-- ("paths only, never contents"). If the agent needs that detail again, it asks
-- Xero again.

ALTER TABLE finance.agent_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES finance.agent_runs (id);

COMMENT ON COLUMN finance.agent_runs.parent_run_id IS
  'The run this one follows up; null for a new conversation. The parent must belong to the same client and be finished before it can be replied to.';

CREATE INDEX IF NOT EXISTS idx_finance_agent_runs_parent
  ON finance.agent_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;
