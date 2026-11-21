-- Migration 073: brief_checks, the reviewer's result per brief version
-- Date: 20 November 2026
-- Branch: feature/brief-pipeline. NOT APPLIED. Apply only after Nik approves.
--
-- One row each time a brief is checked. markdown_hash is md5 of the exact
-- report_markdown that was reviewed, so the publish gate (PUBLISH_GATES=on)
-- can require a pass for the text as it stands: any edit after the review
-- changes the hash and the brief must be reviewed again.

BEGIN;

CREATE TABLE IF NOT EXISTS brief_checks (
    id              BIGSERIAL PRIMARY KEY,
    brief_id        UUID NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
    markdown_hash   TEXT NOT NULL,          -- md5(report_markdown) as reviewed
    step            TEXT NOT NULL CHECK (step IN ('editor', 'reviewer')),
    result          TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
    checklist       JSONB NOT NULL DEFAULT '[]',  -- africanstn-editorial section 7, line by line
    findings        JSONB NOT NULL DEFAULT '[]',  -- location, rule, text, fix, severity
    summary         TEXT,
    model           TEXT,
    version         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brief_checks_brief ON brief_checks (brief_id, step, created_at DESC);

COMMENT ON TABLE brief_checks IS
  'Editor and reviewer results per brief version (markdown_hash); the publish gate needs a reviewer pass for the current text.';

COMMIT;
