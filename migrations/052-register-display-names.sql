-- 052: a client's own name for each asset register it keeps (CFO, 18 Nov
-- 2026). The catalogue names a grouping generically ("Developed intangible,
-- project WIP"); the client knows it as e.g. "IA Track development". Shown
-- wherever the register is named (Fixed assets page, workbook); the catalogue
-- name stays underneath. Null: the catalogue name. Set by the CFO in client
-- Settings > Financial.
ALTER TABLE finance.asset_groupings_client
  ADD COLUMN IF NOT EXISTS display_name    text CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS display_name_by text,
  ADD COLUMN IF NOT EXISTS display_name_at timestamptz;
