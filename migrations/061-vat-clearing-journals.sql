-- 061: VAT group clearing journals (VAT build spec 17 Nov 2026, step 4).
--
-- Recording a group return as submitted proposes one clearing journal per
-- company (lib/vat-clearing.js), source 'vat' (058), on the Journals page for
-- the CFO to approve. Each is tied to its return, so a return is cleared once
-- and its page shows where its journals are.
--
-- Idempotent.

ALTER TABLE finance.journals ADD COLUMN IF NOT EXISTS vat_return_id uuid REFERENCES finance.vat_returns (id);
CREATE INDEX IF NOT EXISTS journals_vat_return ON finance.journals (vat_return_id) WHERE vat_return_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_vat_has_return') THEN
    ALTER TABLE finance.journals ADD CONSTRAINT journal_vat_has_return CHECK (source <> 'vat' OR vat_return_id IS NOT NULL);
  END IF;
END $$;
