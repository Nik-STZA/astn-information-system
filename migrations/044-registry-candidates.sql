-- 044-registry-candidates.sql
--
-- Registry candidates (15 Nov 2026). Nik submits organisations he thinks belong
-- in the AfricanSTN registry from os.stza.io (Registry > Candidates). Each
-- submission queues the registry reviewer agent (finance-api runner.js,
-- lib/registry-reviewer.js) on the AfricanSTN client's agent queue, which
-- checks for duplicates, researches the organisation on the web and records a
-- proposed registry row with its evidence.
--
-- The agent only proposes. Nothing reaches public.organizations until a person
-- approves the candidate in os.stza.io; the approval writes the row, a
-- research_log entry, and links the candidate to the organisation it became.
--
--   queued      submitted, waiting for the reviewer
--   reviewing   the reviewer has picked it up
--   proposed    the reviewer has recorded a proposal and verdict
--   failed      the reviewer finished without a proposal (re-run it)
--   approved    a person added it to the registry (organization_id is set)
--   rejected    a person declined it
--
-- Additive and re-runnable. Apply BEFORE merging the code that uses it; until
-- then the Candidates page says the table is missing and submits answer 503.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.registry_candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was submitted, as typed. Only the name is required.
  submitted_name     text NOT NULL CHECK (length(trim(submitted_name)) > 0),
  submitted_website  text,
  submitted_country  text,
  submitted_sport    text,
  submitted_note     text,
  submitted_by       text NOT NULL,
  submitted_at       timestamptz NOT NULL DEFAULT now(),

  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'reviewing', 'proposed', 'failed', 'approved', 'rejected')),

  -- The reviewer's work. verdict is its recommendation, not a decision.
  agent_run_id       uuid,
  verdict            text CHECK (verdict IS NULL OR verdict IN ('add', 'duplicate', 'reject')),
  verdict_reason     text,
  proposal           jsonb,              -- the proposed organizations row
  evidence           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, finding}]
  duplicates         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{organization_id, astn_id, organization_name, why}]
  reviewed_at        timestamptz,

  -- The person's decision.
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text,
  organization_id    uuid REFERENCES public.organizations (id),

  CHECK (status <> 'approved' OR organization_id IS NOT NULL),
  CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

COMMENT ON TABLE public.registry_candidates IS
  'Organisations submitted for the AfricanSTN registry. The registry reviewer agent proposes; only a person''s approval writes public.organizations.';

CREATE INDEX IF NOT EXISTS idx_registry_candidates_status
  ON public.registry_candidates (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_candidates_run
  ON public.registry_candidates (agent_run_id) WHERE agent_run_id IS NOT NULL;
