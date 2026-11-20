-- 068: the capitalised development account reconciled from payroll (CFO, 20 Nov 2026).
--
-- Software WIP (a client's capitalised development account) is staff and contractor time capitalised by
-- project each month, worked out in os.stza.io's payroll (065, 066). The asset
-- register cannot prove it while the Software grouping is paused, so the rec's
-- evidence is the roll-forward: last month's signed figure, plus this month's
-- capitalisation from payroll. Anything else on the account is a difference
-- to explain.
--
-- An account's evidence source is normally worked out from its balance sheet
-- line (lib/recs.js autoMethod). evidence_method sets it for one account where
-- the line alone does not say: here, the payroll's capitalisation account in
-- the payroll company. Existing clients with payroll set up are backfilled.
--
-- Needs 032, 065 and 067. Idempotent.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_accounts ADD COLUMN IF NOT EXISTS evidence_method text;
ALTER TABLE finance.rec_accounts DROP CONSTRAINT IF EXISTS rec_accounts_evidence_method_check;
ALTER TABLE finance.rec_accounts ADD CONSTRAINT rec_accounts_evidence_method_check
  CHECK (evidence_method IS NULL OR evidence_method IN ('payroll_capitalisation'));

ALTER TABLE finance.rec_evidence DROP CONSTRAINT IF EXISTS rec_evidence_method_check;
ALTER TABLE finance.rec_evidence ADD CONSTRAINT rec_evidence_method_check
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward', 'statement', 'contracts', 'asset_register', 'vat_return', 'accrual_schedule',
                                      'payroll_capitalisation'));

UPDATE finance.rec_accounts a
   SET evidence_method = 'payroll_capitalisation'
  FROM finance.payroll_settings s
 WHERE a.client_id = s.client_id
   AND a.evidence_method IS NULL
   AND coalesce(s.accounts->'capdev'->>'capdev', '') <> ''
   AND EXISTS (SELECT 1 FROM finance.recs r JOIN finance.rec_balances b ON b.rec_id = r.id
                WHERE r.rec_account_id = a.id AND b.entity_id = s.payroll_entity_id
                  AND b.account_code = s.accounts->'capdev'->>'capdev');
