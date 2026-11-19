-- 067: reconciling items carry forward, and the VAT and accruals evidence sources (CFO, 19 Nov 2026). An item that
-- explains a difference at one month end and is still open (a late VAT claim
-- held for the next return, an amount waiting to be written off) is still
-- there at the next: when the month's balances are refreshed, each open item
-- on the month before's reconciliation of the same account comes onto this
-- month's as source 'carried', naming the item it came from, until a person
-- clears it with a note. Statement and ageing items are found again each month
-- from their own source, so they are not carried.
--
-- Also: the evidence sources the VAT returns (058) and the accruals schedule
-- (062) feed were never added to rec_evidence's list, so every fetch on a VAT
-- or Accruals rec failed on the constraint, and the VAT evidence was keyed by
-- hand (found 19 Nov 2026).
--
-- Needs 043, 053 and 056. Idempotent.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_evidence DROP CONSTRAINT IF EXISTS rec_evidence_method_check;
ALTER TABLE finance.rec_evidence ADD CONSTRAINT rec_evidence_method_check
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward', 'statement', 'contracts', 'asset_register', 'vat_return', 'accrual_schedule'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rec_reconciling_items_source_check2') THEN
    ALTER TABLE finance.rec_reconciling_items DROP CONSTRAINT rec_reconciling_items_source_check2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rec_reconciling_items_source_check3') THEN
    ALTER TABLE finance.rec_reconciling_items ADD CONSTRAINT rec_reconciling_items_source_check3
      CHECK (source IN ('statement', 'keyed', 'ageing', 'carried'));
  END IF;
END $$;

ALTER TABLE finance.rec_reconciling_items
  ADD COLUMN IF NOT EXISTS carried_from uuid REFERENCES finance.rec_reconciling_items (id) ON DELETE SET NULL;

-- Carried once into each month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_items_carried_once
  ON finance.rec_reconciling_items (rec_id, carried_from) WHERE carried_from IS NOT NULL;
