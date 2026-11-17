-- 050-people-and-threads.sql
--
-- Two foundations the Fixed assets page stands on, and every page after it
-- (CFO, 18 Nov 2026):
--
-- 1. finance.people: who a person is on the platform, so every decision,
--    signature and thread entry shows their initials (with name and role on
--    hover) rather than an email. One row per email; agents are listed too, so
--    an entry an agent writes shows "FM1, for NM". No credentials are held.
--
-- 2. finance.thread_entries: one thread per thing the work is about (an
--    account at a month end, an asset, a cost line, a reconciliation, a
--    register month), shown on every page where that thing appears, and read
--    by the agents as context. Append only, like finance.notes: a correction
--    is a further entry, a decision is an entry that answers an open one.
--
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS finance.people (
  email         text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email LIKE '%@%'),
  kind          text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'agent')),
  display_name  text NOT NULL CHECK (length(btrim(display_name)) > 0),
  initials      text NOT NULL CHECK (initials ~ '^[A-Z0-9]{1,4}$'),
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finance.people IS
  'Who a person or agent is on the platform: display name and initials for the audit trail. The capacity they act in for a client stays in client_engagement_roles.';
COMMENT ON COLUMN finance.people.email IS
  'Lower case. For an agent, a stable pseudo-address such as fm1@agents.stza.io, never a real mailbox.';

-- The finance agents, so their entries carry initials from the first day.
INSERT INTO finance.people (email, kind, display_name, initials, title) VALUES
  ('ap-clerk@agents.stza.io', 'agent', 'AP Clerk', 'AP', 'Accounts payable agent'),
  ('ar-clerk@agents.stza.io', 'agent', 'AR Clerk', 'AR', 'Accounts receivable agent'),
  ('fm1@agents.stza.io', 'agent', 'FM1', 'FM1', 'Month-end agent'),
  ('fm2@agents.stza.io', 'agent', 'FM2', 'FM2', 'Review agent'),
  ('fc@agents.stza.io', 'agent', 'Financial Controller', 'FC', 'Financial Controller agent'),
  ('fpa@agents.stza.io', 'agent', 'FP&A', 'FPA', 'FP&A agent')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance.thread_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,

  -- What the work is about. subject_key is stable and readable:
  --   account          <entity uuid>:<account code>      (period says which month end)
  --   asset            <asset uuid>
  --   cost_line        <cost line uuid>
  --   reconciliation   <rec uuid>
  --   register_month   <grouping>                         (period says which month)
  subject_kind   text NOT NULL CHECK (subject_kind IN ('account', 'asset', 'cost_line', 'reconciliation', 'register_month')),
  subject_key    text NOT NULL CHECK (length(btrim(subject_key)) > 0),
  period         text CHECK (period IS NULL OR period ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- A reply answers another entry in the same thread.
  parent_id      uuid REFERENCES finance.thread_entries (id) ON DELETE RESTRICT,

  kind           text NOT NULL CHECK (kind IN ('note', 'question', 'hold', 'decision', 'finding')),
  -- An entry that waits on a person: open until a decision replies to it.
  needs_decision boolean NOT NULL DEFAULT false,
  body           text NOT NULL CHECK (length(btrim(body)) > 0),

  -- The person who wrote it, or for whom an agent wrote it; the agent and its
  -- run when one did. actor_role is a snapshot, as on finance.notes.
  author_email   text NOT NULL,
  actor_role     text,
  via_agent      text,
  via_run_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT thread_reply_is_not_open CHECK (parent_id IS NULL OR NOT needs_decision),
  CONSTRAINT thread_via_run CHECK ((via_agent IS NULL) = (via_run_id IS NULL))
);

COMMENT ON TABLE finance.thread_entries IS
  'Append-only threads about an account at a month end, an asset, a cost line, a reconciliation or a register month. Shown wherever the subject appears; read by agents as context. Corrections are further entries.';
COMMENT ON COLUMN finance.thread_entries.needs_decision IS
  'True when the entry waits on a person; it stays open until a reply of kind decision answers it.';

CREATE INDEX IF NOT EXISTS idx_finance_thread_subject ON finance.thread_entries (client_id, subject_kind, subject_key, created_at);
CREATE INDEX IF NOT EXISTS idx_finance_thread_period ON finance.thread_entries (client_id, period, created_at);
CREATE INDEX IF NOT EXISTS idx_finance_thread_parent ON finance.thread_entries (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_thread_open ON finance.thread_entries (client_id) WHERE needs_decision;

CREATE OR REPLACE FUNCTION finance.thread_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finance.thread_entries is append only. Add a further entry instead of % ing one.', lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thread_entries_append_only ON finance.thread_entries;
CREATE TRIGGER thread_entries_append_only BEFORE UPDATE OR DELETE ON finance.thread_entries
  FOR EACH ROW EXECUTE FUNCTION finance.thread_entries_append_only();

-- A reply stays in its parent's thread.
CREATE OR REPLACE FUNCTION finance.thread_reply_same_subject() RETURNS trigger AS $$
DECLARE p record;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT client_id, subject_kind, subject_key INTO p FROM finance.thread_entries WHERE id = NEW.parent_id;
  IF p.client_id <> NEW.client_id OR p.subject_kind <> NEW.subject_kind OR p.subject_key <> NEW.subject_key THEN
    RAISE EXCEPTION 'a reply belongs to the same thread as the entry it answers' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thread_reply_same_subject ON finance.thread_entries;
CREATE TRIGGER thread_reply_same_subject BEFORE INSERT ON finance.thread_entries
  FOR EACH ROW EXECUTE FUNCTION finance.thread_reply_same_subject();

-- The application role reads and appends; it never updates or deletes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'africastn_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finance.people TO africastn_app;
    GRANT SELECT, INSERT ON finance.thread_entries TO africastn_app;
  END IF;
END $$;
