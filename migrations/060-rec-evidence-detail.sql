-- 060: what lies behind a fetched evidence figure (CFO, 19 Nov 2026).
--
-- The asset reconciliations show the register itself, asset by asset, not
-- only its total: Xero's fixed asset register (number, name, purchase date,
-- cost, depreciation, book value) or the os.stza.io register signed for the
-- month. Kept with the evidence row as fetched, so a signed rec shows the
-- register as it was signed.
--
-- Idempotent.

ALTER TABLE finance.rec_evidence ADD COLUMN IF NOT EXISTS detail jsonb;
