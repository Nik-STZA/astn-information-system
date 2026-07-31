-- Which commercial arrangement each agent run was processed under.
--
-- A run record that cannot say how the client's data was processed is not an
-- audit trail. This is the column a client, an insurer or a regulator would ask
-- about first, and it cannot be reconstructed after the fact.
--
-- 'ungoverned' means no commercial agreement covered the run. It exists so the
-- record can say so honestly rather than the runner refusing and leaving no
-- trace, and it must never appear against real client data.

BEGIN;

ALTER TABLE finance.agent_runs
  ADD COLUMN IF NOT EXISTS processing_path       text,
  ADD COLUMN IF NOT EXISTS processing_path_label text;

ALTER TABLE finance.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_processing_path_check;

ALTER TABLE finance.agent_runs
  ADD CONSTRAINT agent_runs_processing_path_check
  CHECK (processing_path IS NULL
      OR processing_path IN ('vertex', 'bedrock', 'anthropic-api', 'ungoverned'));

COMMENT ON COLUMN finance.agent_runs.processing_path IS
  'Commercial arrangement the run was processed under. ungoverned means none, and must not appear against real client data.';

CREATE INDEX IF NOT EXISTS agent_runs_ungoverned_idx
  ON finance.agent_runs (client_id, finished_at)
  WHERE processing_path = 'ungoverned';

COMMIT;
