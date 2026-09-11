-- 015: report runs - generated packs, starting with the management pack.
--
-- The portal queues a report; a runner on the operator's machine builds it,
-- because the management pack pipeline (XERO REPORTING/scripts/monthly_close.py)
-- still needs that machine's Xero and Google credentials. Same shape as
-- agent_runs (006): one row per run, immutable once finished, never deleted.
--
-- A run produces a DRAFT. Delivering a signed-off pack stays a person's act,
-- after the Balance Control and cash-flow checks the pipeline does not enforce.

CREATE TABLE IF NOT EXISTS finance.report_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,

  report              text NOT NULL CHECK (report IN ('management_pack')),
  period              text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  requested_by_email  text NOT NULL,
  requested_by_role   text,

  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','succeeded','failed','cancelled')),

  -- Where the runner saved each file: [{"name": ..., "path": ...}]. Paths only.
  output_files        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The end of the pipeline's own log, so a failure can be read without the machine.
  log_tail            text,
  error               text,
  duration_ms         integer,

  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz
);

COMMENT ON TABLE finance.report_runs IS
  'One row per generated report. The output is a draft saved by the operator''s runner; paths are recorded, contents are not.';

CREATE INDEX IF NOT EXISTS idx_finance_report_runs_client
  ON finance.report_runs (client_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_report_runs_status
  ON finance.report_runs (status, queued_at);

-- One build of a given report and period at a time. Two runs writing the same
-- fixed output names in the pipeline folder would copy each other's files.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_report_runs_one_in_flight
  ON finance.report_runs (client_id, report, period)
  WHERE status IN ('queued','running');

-- Same rules as agent_runs: updatable in flight, frozen once finished.
CREATE OR REPLACE FUNCTION finance.report_runs_immutable_once_finished()
RETURNS trigger AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION
      'report run % finished at % and cannot be altered. Queue a new build instead.',
      OLD.id, OLD.finished_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS report_runs_no_update_when_finished ON finance.report_runs;
CREATE TRIGGER report_runs_no_update_when_finished BEFORE UPDATE ON finance.report_runs
  FOR EACH ROW EXECUTE FUNCTION finance.report_runs_immutable_once_finished();

DROP TRIGGER IF EXISTS report_runs_no_delete ON finance.report_runs;
CREATE TRIGGER report_runs_no_delete BEFORE DELETE ON finance.report_runs
  FOR EACH ROW EXECUTE FUNCTION finance.notes_are_append_only();
