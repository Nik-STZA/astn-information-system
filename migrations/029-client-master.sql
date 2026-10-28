-- 029-client-master.sql
--
-- The client master (Nik, 28 Oct 2026): one record per client, shared by every
-- service, that decides where the client sits (prospect, engaged, former,
-- internal) and which services it takes. The sidebar shows a client's sections
-- from its active services; a completed service moves to Past.
--
-- shared.clients (migration 025) is the identity record. This adds:
--   - lifecycle columns on shared.clients;
--   - shared.client_services, one row per client and service that has started;
--   - shared.client_events, the append-only history of master changes;
--   - shared.clients.compliance_client_id, linking a client to its data
--     protection / commercial record (public.compliance_clients). Feldspar's
--     two rows share an id; STZA's do not, so a link rather than a re-key. It
--     lives on our side because the app's database user does not own
--     compliance_clients (28 Oct 2026: adding a column there was refused).
--
-- Additive and re-runnable. It links no data protection rows and creates no
-- clients: that is scripts/link-clients, run separately with sign-off.

-- ── Lifecycle on the client ─────────────────────────────────────────────────

ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS pipeline_stage text;
ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS lead_email text;
ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS ended_reason text;

-- 025 defaulted status to 'active'; the master's words are below.
UPDATE shared.clients SET status = 'engaged' WHERE status = 'active';
ALTER TABLE shared.clients ALTER COLUMN status SET DEFAULT 'engaged';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_status_check' AND conrelid = 'shared.clients'::regclass) THEN
    ALTER TABLE shared.clients ADD CONSTRAINT clients_status_check
      CHECK (status IN ('prospect', 'engaged', 'former', 'internal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_pipeline_stage_check' AND conrelid = 'shared.clients'::regclass) THEN
    ALTER TABLE shared.clients ADD CONSTRAINT clients_pipeline_stage_check
      CHECK (pipeline_stage IS NULL OR pipeline_stage IN ('lead', 'discussion', 'proposal', 'agreed'));
  END IF;
END $$;

COMMENT ON COLUMN shared.clients.status IS
  'prospect (in the pipeline), engaged (a client), former (ended or not taken up), internal (STZA itself, test clients).';
COMMENT ON COLUMN shared.clients.pipeline_stage IS
  'For a prospect only: lead, discussion, proposal, agreed.';

-- ── Services ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared.client_services (
  client_id     uuid NOT NULL REFERENCES shared.clients(id) ON DELETE CASCADE,
  service       text NOT NULL CHECK (service IN ('finance', 'data_protection', 'consulting')),
  state         text NOT NULL CHECK (state IN ('active', 'completed')),
  started_on    date,
  ended_on      date,
  closing_note  text,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, service),
  CHECK (state = 'completed' OR ended_on IS NULL)
);

COMMENT ON TABLE shared.client_services IS
  'Which services a client takes. No row: not taken. Active: its sections show under the client. Completed: they move to Past, read-only; nothing is deleted.';

-- ── History ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared.client_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES shared.clients(id) ON DELETE CASCADE,
  action       text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_email  text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_events_client ON shared.client_events (client_id, at DESC);

CREATE OR REPLACE FUNCTION shared.client_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shared.client_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_events_no_update ON shared.client_events;
CREATE TRIGGER client_events_no_update BEFORE UPDATE OR DELETE ON shared.client_events
  FOR EACH ROW EXECUTE FUNCTION shared.client_events_append_only();

-- ── Link to the data protection / commercial record ─────────────────────────
-- A plain value, no foreign key: a key would need privileges on a table the
-- app does not own. One master client per record, so unique.

ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS compliance_client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS clients_compliance_client_id_key
  ON shared.clients (compliance_client_id) WHERE compliance_client_id IS NOT NULL;
COMMENT ON COLUMN shared.clients.compliance_client_id IS
  'The public.compliance_clients record (data protection / commercial) for this client, if any.';

-- ── Finance as a service ────────────────────────────────────────────────────
-- Every client with a finance config already takes Finance.

INSERT INTO shared.client_services (client_id, service, state, updated_by)
SELECT client_id, 'finance', 'active', 'migration 029'
FROM finance.client_finance_config
ON CONFLICT (client_id, service) DO NOTHING;
