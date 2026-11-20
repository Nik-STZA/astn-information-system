-- Migration 069: brief pipeline, rule screen
-- Date: 20 November 2026
-- Branch: feature/brief-pipeline. NOT APPLIED. Apply only after Nik approves.
--
-- 1. content_sources.lens: what each source is for, so the screen can treat a
--    specialist Africa sport-business outlet differently from a broad feed.
-- 2. item_screen_decisions: one structured record per item per pipeline step
--    (rule screen now; scope check and importance later). Steps pass records,
--    not transcripts. Archiving is reversible: the item keeps its row and the
--    decision says why it was archived.

BEGIN;

ALTER TABLE content_sources
  ADD COLUMN IF NOT EXISTS lens TEXT
    CHECK (lens IN ('africa-sport-business', 'africa-sport', 'africa-tech', 'global-sport-business'));

COMMENT ON COLUMN content_sources.lens IS
  'Editorial lens of the source. africa-sport-business items skip the keyword rules and go straight to the scope check.';

UPDATE content_sources SET lens = 'africa-sport-business'
 WHERE source_name IN ('Business of Sports Africa', 'Esports Africa News') AND lens IS NULL;

CREATE TABLE IF NOT EXISTS item_screen_decisions (
    id              BIGSERIAL PRIMARY KEY,
    item_id         UUID NOT NULL REFERENCES classified_items(id) ON DELETE CASCADE,
    step            TEXT NOT NULL CHECK (step IN ('rule_screen', 'scope_check', 'importance')),
    decision        TEXT NOT NULL CHECK (decision IN ('keep', 'archive')),
    rule            TEXT,               -- which rule kept it, or NULL when archived
    reason          TEXT NOT NULL,      -- one line, human-readable
    detail          JSONB DEFAULT '{}', -- matched terms, model answers, etc.
    source_url      TEXT,
    version         TEXT NOT NULL,      -- screen version, so results can be compared over time
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_screen_decisions_item ON item_screen_decisions (item_id);
CREATE INDEX IF NOT EXISTS idx_item_screen_decisions_step ON item_screen_decisions (step, decision, created_at DESC);

COMMENT ON TABLE item_screen_decisions IS
  'One record per item per pipeline step (rule screen, scope check, importance): decision, reason, source link, timestamp.';

COMMIT;
