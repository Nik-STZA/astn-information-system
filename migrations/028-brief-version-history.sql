-- Migration 028: Brief version history
-- Stores a snapshot of the brief markdown on each save, with a diff summary.

CREATE TABLE IF NOT EXISTS brief_versions (
  id            SERIAL PRIMARY KEY,
  brief_id      UUID NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL DEFAULT 1,
  report_markdown TEXT NOT NULL,
  saved_by      TEXT,              -- email of the operator
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_summary TEXT,             -- optional: auto-generated summary of what changed
  word_count    INTEGER,
  story_count   INTEGER,

  UNIQUE (brief_id, version_num)
);

CREATE INDEX idx_brief_versions_brief_id ON brief_versions(brief_id);

COMMENT ON TABLE brief_versions IS 'Snapshot of brief markdown on each save, providing full version history.';
