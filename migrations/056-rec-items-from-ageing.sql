-- 056: reconciling items found by the ageing (CFO, 18 Nov 2026). An
-- Accounts Payable or Receivable reconciliation is the ageing at the month end
-- against the control account; a payment made by the month end on an invoice
-- dated after it is in the ledger but not in the ageing, so it is a timing item
-- between them, written by each evidence fetch (source 'ageing').
--
-- Idempotent.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'finance.rec_reconciling_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%source%';
  IF c IS NOT NULL AND c <> 'rec_reconciling_items_source_check2' THEN
    EXECUTE format('ALTER TABLE finance.rec_reconciling_items DROP CONSTRAINT %I', c);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rec_reconciling_items_source_check2') THEN
    ALTER TABLE finance.rec_reconciling_items ADD CONSTRAINT rec_reconciling_items_source_check2
      CHECK (source IN ('statement', 'keyed', 'ageing'));
  END IF;
END $$;
