-- Migration 015: Add content pipeline columns to classified_items
-- Date: 31 July 2026
-- Purpose: The existing classified_items table (created by the Supabase/agent
--          pipeline) is missing columns that server-content-routes.js needs for
--          the RSS ingestion pipeline. Migration 014 used IF NOT EXISTS so the
--          CREATE was skipped when the table already existed.
--
-- Adds:
--   content_hash  TEXT UNIQUE   — SHA-256 of (url + title) for dedup
--   source_id     INTEGER       — FK to content_sources
--   published_at  TIMESTAMPTZ   — when the source article was published
--
-- Also adds the url column if missing (some rows only have source_url).
--
-- Run against Cloud SQL (africastn-research):
--   node scripts/run-migration.js migrations/015-classified-items-content-pipeline-columns.sql

BEGIN;

-- ── Add content_hash for dedup (NULL for legacy rows — UNIQUE allows multiple NULLs) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'content_hash'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN content_hash TEXT;
    -- Regular UNIQUE index (not partial). PostgreSQL allows multiple NULLs in
    -- a unique column, so legacy rows without content_hash won't conflict.
    -- ON CONFLICT (content_hash) DO NOTHING needs a non-partial unique index.
    CREATE UNIQUE INDEX idx_classified_items_content_hash
      ON classified_items (content_hash);
  END IF;
END $$;

-- ── Add source_id FK to content_sources ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'source_id'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN source_id INTEGER
      REFERENCES content_sources(id) ON DELETE SET NULL;
    CREATE INDEX idx_classified_items_source_id ON classified_items (source_id);
  END IF;
END $$;

-- ── Add published_at (when the source article was published) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'published_at'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN published_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── Add url column if missing (legacy rows might only have source_url) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'url'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN url TEXT;
  END IF;
END $$;

-- ── Add reviewed_at / reviewed_by if missing ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'reviewed_at'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN reviewed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'reviewed_by'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN reviewed_by TEXT;
  END IF;
END $$;

-- ── Add updated_at if missing ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classified_items' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE classified_items ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

COMMIT;
