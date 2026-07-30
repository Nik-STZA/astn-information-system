-- 004-wip-stable-identity.sql
--
-- Keys a WIP item on an identifier that survives its own lifecycle.
--
-- Migration 001 made wip_items unique on (client_id, folder_path). But the
-- lifecycle of a WIP item IS moving its folder between states: drafting to
-- pending-fc to pending-cfo to posted. Every one of those moves changes the
-- path, so the key changes, the existing row orphans and a new one appears.
-- The approval history would detach from the item at the exact moment the item
-- was approved.
--
-- This is the same mistake as keying the markdown mirror on line numbers, made
-- again in a place where it costs more.
--
-- Each WIP folder now carries a wip.json holding a uuid assigned once, at
-- creation, and never rewritten. That is the key. folder_path becomes mutable
-- metadata recording where the item currently sits.
--
-- Idempotent and re-runnable.

ALTER TABLE finance.wip_items
  DROP CONSTRAINT IF EXISTS wip_items_client_id_folder_path_key;

ALTER TABLE finance.wip_items
  ADD COLUMN IF NOT EXISTS ref           text,
  ADD COLUMN IF NOT EXISTS entity_scope  text NOT NULL DEFAULT 'entity',
  ADD COLUMN IF NOT EXISTS state_path    text,
  ADD COLUMN IF NOT EXISTS drafted_at    timestamptz;

-- Nothing has been created under the convention yet, so there is nothing to
-- backfill. This exists so a re-run against a populated table cannot fail.
UPDATE finance.wip_items SET ref = id::text WHERE ref IS NULL;
ALTER TABLE finance.wip_items ALTER COLUMN ref SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wip_items_client_ref_key') THEN
    ALTER TABLE finance.wip_items
      ADD CONSTRAINT wip_items_client_ref_key UNIQUE (client_id, ref);
  END IF;
END $$;

COMMENT ON COLUMN finance.wip_items.ref IS
  'Stable uuid from the folder''s wip.json. Assigned once at creation and never rewritten, because the folder moves between state directories throughout its life.';
COMMENT ON COLUMN finance.wip_items.folder_path IS
  'Where the item currently sits, relative to the client folder. Mutable: it changes on every state transition. Never use it as identity.';
COMMENT ON COLUMN finance.wip_items.entity_scope IS
  'entity for work belonging to one company, group for cross-entity work such as intercompany reconciliation or the consolidated pack.';

-- An entity-scoped item must name its entity. A group-scoped one must not,
-- because filing intercompany work under one company misstates whose approval
-- record it is.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wip_items_scope_entity_check') THEN
    ALTER TABLE finance.wip_items
      ADD CONSTRAINT wip_items_scope_entity_check CHECK (
        (entity_scope = 'entity' AND entity_id IS NOT NULL) OR
        (entity_scope = 'group'  AND entity_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_finance_wip_state
  ON finance.wip_items (client_id, status, updated_at DESC);
