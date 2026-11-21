-- Migration 072: item_sources, the source text the verifier read
-- Date: 20 November 2026
-- Branch: feature/brief-pipeline. NOT APPLIED. Needs migration 069.
--
-- One row per fetch of an item's source article: what came back, the
-- publication date the page states and where that date was found, and the
-- readable text with its hash. The verifier's decision (item_screen_decisions,
-- step 'verify') stores the same hash, so any check can be repeated against
-- exactly the text that was read, and the reviewer can read the same text.

BEGIN;

CREATE TABLE IF NOT EXISTS item_sources (
    id              BIGSERIAL PRIMARY KEY,
    item_id         UUID NOT NULL REFERENCES classified_items(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    final_url       TEXT,
    http_status     INTEGER,
    ok              BOOLEAN NOT NULL,
    failure_reason  TEXT,
    page_title      TEXT,
    published_at    TIMESTAMPTZ,       -- as the page states it
    published_from  TEXT,              -- e.g. 'meta article:published_time', 'url path'
    text            TEXT,
    text_hash       TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_sources_item ON item_sources (item_id, fetched_at DESC);

COMMENT ON TABLE item_sources IS
  'Source articles as fetched by the verifier: status, stated publication date, readable text and hash.';

COMMIT;
