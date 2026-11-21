-- Migration 074: newsletter_drafts
-- Date: 21 November 2026
-- Branch: feature/brief-pipeline. NOT APPLIED. Apply only after Nik approves.
--
-- One row per newsletter drafted from a published brief
-- (scripts/newsletter-job.js). The draft, its subject and preview, the
-- review result and findings. Nik approves and sends; nothing here sends.

BEGIN;

CREATE TABLE IF NOT EXISTS newsletter_drafts (
    id              BIGSERIAL PRIMARY KEY,
    brief_id        UUID NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
    subject         TEXT NOT NULL,
    preview         TEXT NOT NULL,
    markdown        TEXT NOT NULL,
    note_is_draft   BOOLEAN NOT NULL,          -- true when the brief had no approved editor's note
    figure_name     TEXT,                      -- published_figures.figure_name used
    review_result   TEXT NOT NULL CHECK (review_result IN ('pass', 'fail')),
    review_findings JSONB NOT NULL DEFAULT '[]',
    review_summary  TEXT,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'superseded')),
    model           TEXT,
    version         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_newsletter_drafts_brief ON newsletter_drafts (brief_id, created_at DESC);

COMMENT ON TABLE newsletter_drafts IS
  'Newsletters drafted from published briefs, with their review. Approval and sending stay with Nik.';

COMMIT;
