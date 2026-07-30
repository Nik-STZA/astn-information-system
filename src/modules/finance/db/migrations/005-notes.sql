-- 005-notes.sql
--
-- Notes against a work item or an open item.
--
-- The purpose is an audit record, not a comment thread. "Payment run loaded,
-- three vendors held back and why" is a decision, and a decision that lives
-- only in someone's memory or a chat transcript is not evidence.
--
-- Append only, deliberately. There is no update and no delete: a note that can
-- be edited after the fact proves nothing, and the value of this table is that
-- it can be shown to an auditor. A correction is a further note, exactly as a
-- reversal is a further journal rather than an edit to the original.
--
-- actor_role is snapshotted at write time for the same reason it is on
-- audit_log: the capacity someone acted in must not change retrospectively
-- when their engagement role changes.
--
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS finance.notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,

  -- One table for both surfaces: the shape of a note is identical and keeping
  -- them together means one audit query rather than a union.
  target_type   text NOT NULL CHECK (target_type IN ('wip_item', 'open_item')),
  target_id     uuid NOT NULL,

  body          text NOT NULL CHECK (length(trim(body)) > 0),

  -- Lets a note record a decision rather than only a remark, so "held" can be
  -- filtered from general commentary later without parsing prose.
  kind          text NOT NULL DEFAULT 'note'
                CHECK (kind IN ('note', 'decision', 'hold', 'query')),

  actor_email   text NOT NULL,
  actor_role    text,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finance.notes IS
  'Append-only annotations on work items and open items. No update or delete: an editable record is not an audit trail. Corrections are further notes.';
COMMENT ON COLUMN finance.notes.actor_role IS
  'The capacity the author held for this client when the note was written. A snapshot, never derived on read.';
COMMENT ON COLUMN finance.notes.kind IS
  'note for commentary, decision for a choice made, hold for something deliberately not actioned, query for an open question.';

CREATE INDEX IF NOT EXISTS idx_finance_notes_target
  ON finance.notes (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_notes_client
  ON finance.notes (client_id, created_at DESC);

-- Enforce append-only in the database rather than trusting every future caller
-- to remember. An application bug should not be able to rewrite history.
CREATE OR REPLACE FUNCTION finance.notes_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finance.notes is append only. Add a correcting note instead of % ing an existing one.', lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_no_update ON finance.notes;
CREATE TRIGGER notes_no_update BEFORE UPDATE ON finance.notes
  FOR EACH ROW EXECUTE FUNCTION finance.notes_are_append_only();

DROP TRIGGER IF EXISTS notes_no_delete ON finance.notes;
CREATE TRIGGER notes_no_delete BEFORE DELETE ON finance.notes
  FOR EACH ROW EXECUTE FUNCTION finance.notes_are_append_only();
