-- Migration 022: AI-generated, dual-model-verified resolutions (side table)
-- Date: 25 July 2026
-- Purpose: Add the "Resolution" layer beside each remediation item's action — the
--          concrete, document-specific fix produced by the dual-model engine
--          (Gemini + Claude reading the client's actual clause), cross-checked.
--          Turns "Finding -> Action" into "Finding -> Action -> Resolution".
--
-- Implemented as a 1:1 side table (not ALTER remediation_items — that table is
-- owned by postgres from migration 009 and the app user cannot alter it).
-- Integrity is app-enforced (resolutions created against existing items via the
-- backend); no hard FK, to avoid a REFERENCES-privilege issue on the parent.
--
-- resolution        = the concrete fix (redraft language / steps), Nik-editable.
-- status            = draft | needs_review | confirmed | applied
-- agreement         = agreed | flagged   (dual-model cross-check outcome)
-- models            = raw per-model verdicts (audit / transparency)
--
-- Idempotent. Run against Cloud SQL (africastn_os) as africastn_app.

BEGIN;

CREATE TABLE IF NOT EXISTS remediation_resolutions (
    id                    SERIAL PRIMARY KEY,
    remediation_item_id   INTEGER NOT NULL UNIQUE,
    resolution            TEXT,
    status                TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','needs_review','confirmed','applied')),
    agreement             TEXT
        CHECK (agreement IN ('agreed','flagged')),
    models                JSONB,
    generated_at          TIMESTAMPTZ,
    reviewed_by           TEXT,
    reviewed_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remediation_resolutions_item
    ON remediation_resolutions(remediation_item_id);

COMMIT;
