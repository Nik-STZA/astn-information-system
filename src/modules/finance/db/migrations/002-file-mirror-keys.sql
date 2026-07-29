-- 002-file-mirror-keys.sql
--
-- Fixes how the markdown mirror keys its rows, and adds the open-items fields
-- the register actually carries.
--
-- Why the change. Migration 001 keyed both tables on (client_id, source_file,
-- source_line). Line numbers move the moment anyone edits a file above an
-- existing entry, so a re-import would insert duplicates and orphan the old
-- rows. Line number is useful provenance, not identity.
--
--   diary_entries  is a pure mirror with nothing acting on it, so the importer
--                  replaces every row for a file in one transaction. No
--                  natural key needed, and deletions propagate correctly.
--
--   open_items     will gain actions later, so rows need stable identity. The
--                  register numbers its items (1, 2b, C12) and those refs are
--                  stable across edits, so (client_id, source_file, ref) is
--                  the key. The importer deletes refs that have disappeared.
--
-- Idempotent and re-runnable.

-- ── diary_entries ────────────────────────────────────────────────────────────

ALTER TABLE finance.diary_entries
  DROP CONSTRAINT IF EXISTS diary_entries_client_id_source_file_source_line_key;

ALTER TABLE finance.diary_entries
  ADD COLUMN IF NOT EXISTS heading text,
  ADD COLUMN IF NOT EXISTS occurred_precision text NOT NULL DEFAULT 'day';

COMMENT ON COLUMN finance.diary_entries.occurred_precision IS
  'How precise occurred_at is: minute, day or month. Some entries are headed with a month only (for example "2026-04 - PEAK Las Vegas").';
COMMENT ON COLUMN finance.diary_entries.heading IS
  'The raw heading line, kept so the parser can be audited against the source.';

CREATE INDEX IF NOT EXISTS idx_finance_diary_source
  ON finance.diary_entries (client_id, source_file);


-- ── open_items ───────────────────────────────────────────────────────────────

ALTER TABLE finance.open_items
  DROP CONSTRAINT IF EXISTS open_items_client_id_source_file_source_line_key;

ALTER TABLE finance.open_items
  ADD COLUMN IF NOT EXISTS ref             text,
  ADD COLUMN IF NOT EXISTS priority        text,
  ADD COLUMN IF NOT EXISTS owner_label     text,
  ADD COLUMN IF NOT EXISTS last_update_at  date,
  ADD COLUMN IF NOT EXISTS closed_at       date,
  ADD COLUMN IF NOT EXISTS resolution      text,
  ADD COLUMN IF NOT EXISTS is_closed       boolean NOT NULL DEFAULT false;

-- Backfill before the constraint goes on, so a re-run against a populated
-- table cannot fail. There is nothing to backfill on a first run.
UPDATE finance.open_items SET ref = id::text WHERE ref IS NULL;

ALTER TABLE finance.open_items ALTER COLUMN ref SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'open_items_client_source_ref_key'
  ) THEN
    ALTER TABLE finance.open_items
      ADD CONSTRAINT open_items_client_source_ref_key
      UNIQUE (client_id, source_file, ref);
  END IF;
END $$;

COMMENT ON COLUMN finance.open_items.ref IS
  'The register item number (1, 2b, C12). Stable across edits, unlike line number.';
COMMENT ON COLUMN finance.open_items.owner_label IS
  'Owner exactly as written, which may name individuals. Internal only. Never render this in board or exec-visible output (Feldspar CLAUDE.md rule 8).';

CREATE INDEX IF NOT EXISTS idx_finance_open_items_active
  ON finance.open_items (client_id, is_closed, priority);
