-- 053: the asset reconciliations take their evidence from the asset register
-- (CFO, 18 Nov 2026): the month's signed os.stza.io register, or Xero's own
-- fixed asset register for the accounts Xero keeps. finance.rec_evidence.method
-- gains 'asset_register' (047 set the list).
SET lock_timeout = '10s';

ALTER TABLE finance.rec_evidence DROP CONSTRAINT IF EXISTS rec_evidence_method_check;
ALTER TABLE finance.rec_evidence ADD CONSTRAINT rec_evidence_method_check
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward', 'statement', 'contracts', 'asset_register'));
