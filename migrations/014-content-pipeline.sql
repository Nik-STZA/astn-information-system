-- Migration 014: Content Pipeline
-- Date: 30 July 2026
-- Purpose: Create the content ingestion pipeline tables to replace the
--          Supabase classified_items table and add a managed source registry.
--
-- This migration creates:
--   content_sources       — RSS/website source registry (seeded from Google Sheet)
--   classified_items      — Ingested and classified content items
--   ingestion_runs        — Audit trail of pipeline executions
--
-- Run against Cloud SQL (africastn-research) as postgres user:
--   psql "host=<IP> dbname=africastn_os user=postgres" -f 014-content-pipeline.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTENT SOURCES — the editorial source registry
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_sources (
    id              SERIAL PRIMARY KEY,
    url             TEXT NOT NULL,
    source_name     TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    source_type     TEXT NOT NULL DEFAULT 'rss'
                    CHECK (source_type IN ('rss', 'website', 'scrape', 'api')),
    languages       TEXT DEFAULT 'en',
    active          BOOLEAN NOT NULL DEFAULT true,
    priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('high', 'medium', 'low')),
    region_focus    TEXT DEFAULT 'Pan-Africa',
    agents          TEXT,                       -- comma-separated agent codes: ASE, FD, GST, SBM
    outputs         TEXT,                       -- comma-separated output types
    notes           TEXT,
    registries      TEXT,                       -- comma-separated registry targets
    last_fetched_at TIMESTAMPTZ,
    last_item_count INTEGER DEFAULT 0,          -- items found on last fetch
    fetch_errors    INTEGER DEFAULT 0,          -- consecutive error count
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (url)
);

CREATE INDEX idx_content_sources_active ON content_sources (active) WHERE active = true;
CREATE INDEX idx_content_sources_type ON content_sources (source_type);
CREATE INDEX idx_content_sources_priority ON content_sources (priority);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLASSIFIED ITEMS — ingested content awaiting editorial review
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS classified_items (
    id              SERIAL PRIMARY KEY,
    source_id       INTEGER REFERENCES content_sources(id) ON DELETE SET NULL,
    source_name     TEXT NOT NULL,               -- denormalised for display
    source_url      TEXT,                        -- URL of the original article
    title           TEXT NOT NULL,
    summary         TEXT,                        -- AI-generated or RSS description
    content_hash    TEXT NOT NULL,               -- SHA-256 of (source_url + title) for dedup
    category        TEXT,                        -- inherited from source or AI-classified
    verticals       TEXT[] DEFAULT '{}',         -- AfricanSTN vertical tags
    relevance_score NUMERIC(3,2) DEFAULT 0.0,   -- 0.00-1.00 relevance to African sports tech
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'published')),
    original_language TEXT DEFAULT 'en',
    region          TEXT,                        -- geographic relevance
    published_at    TIMESTAMPTZ,                 -- when the source article was published
    classified_at   TIMESTAMPTZ DEFAULT now(),   -- when our pipeline processed it
    reviewed_at     TIMESTAMPTZ,                 -- when editorially approved/rejected
    reviewed_by     TEXT,                        -- email of reviewer
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (content_hash)
);

CREATE INDEX idx_classified_items_status ON classified_items (status);
CREATE INDEX idx_classified_items_created ON classified_items (created_at DESC);
CREATE INDEX idx_classified_items_source ON classified_items (source_id);
CREATE INDEX idx_classified_items_category ON classified_items (category);
CREATE INDEX idx_classified_items_relevance ON classified_items (relevance_score DESC);
CREATE INDEX idx_classified_items_week ON classified_items (created_at)
    WHERE created_at > (now() - interval '7 days');

-- ═══════════════════════════════════════════════════════════════════════════════
-- INGESTION RUNS — audit trail for pipeline executions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id              SERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed')),
    sources_checked INTEGER DEFAULT 0,
    items_fetched   INTEGER DEFAULT 0,
    items_new       INTEGER DEFAULT 0,           -- after dedup
    items_skipped   INTEGER DEFAULT 0,           -- duplicates
    errors          JSONB DEFAULT '[]',          -- array of {source_id, error}
    trigger_type    TEXT DEFAULT 'manual'
                    CHECK (trigger_type IN ('manual', 'scheduled', 'api')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Update summary endpoint — add classified_items count to queries
-- (This is a reminder; the actual change is in server-listing-routes.js)
-- ═══════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE content_sources IS 'Editorial source registry for the AfricanSTN content pipeline. Seeded from the Google Sheet source registry.';
COMMENT ON TABLE classified_items IS 'Ingested and classified content items awaiting editorial review. Replaces the Supabase classified_items table.';
COMMENT ON TABLE ingestion_runs IS 'Audit trail for content ingestion pipeline runs.';

COMMIT;
