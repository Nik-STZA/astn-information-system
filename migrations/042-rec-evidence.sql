-- 042-rec-evidence.sql
--
-- Balance sheet reconciliations proved by evidence (10 Nov 2026). Until now
-- only Prepayments could be prepared, from its schedule. Every placed account
-- proved by outside evidence or a ledger review now is, from
-- finance.rec_evidence (migration 032): an amount per company with its source
-- and document, keyed by a person or FM1, or fetched by the platform.
--
--   finance.rec_evidence.method            how an entry was fetched (ageing_ar,
--                                           ageing_ap, counterpart, carry_forward),
--                                           null when keyed. A fetch replaces only
--                                           fetched entries.
--   finance.rec_accounts.counterpart_account_id
--                                           an intercompany account's twin in the
--                                           other company, chosen by a person, kept
--                                           for every month like its placing.
--
-- Also corrects accounts the matrix misfiled before this change: a bank
-- account whose name holds the letters v-a-t (Innovation) was placed on the
-- VAT line. Bank accounts are keyed bank:<id>, so they move to cash, on the
-- account and on every month not yet signed off. Signed months keep what was
-- signed.
--
-- Additive and re-runnable. Apply BEFORE merging the code that uses it.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_evidence ADD COLUMN IF NOT EXISTS method text
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward'));

ALTER TABLE finance.rec_accounts ADD COLUMN IF NOT EXISTS counterpart_account_id uuid
  REFERENCES finance.rec_accounts (id) ON DELETE SET NULL;

COMMENT ON COLUMN finance.rec_evidence.method IS
  'How the entry was fetched by the platform; null when a person or FM1 keyed it. A fetch replaces fetched entries only.';
COMMENT ON COLUMN finance.rec_accounts.counterpart_account_id IS
  'For an intercompany account: its twin in the other company, chosen by a person. Its closing, reversed, is the evidence.';

-- Bank accounts misfiled as VAT, placed by the matrix rather than a person.
UPDATE finance.rec_accounts
   SET line_key = 'cash', proof = 'outside_evidence'
 WHERE account_key LIKE 'bank:%' AND line_key = 'vat' AND placed_by IS NULL;

UPDATE finance.recs r
   SET line_key = 'cash', proof = 'outside_evidence', owner = 'FM2', challenge = NULL, class = 'M',
       artefact = 'Bank reconciliation per account', updated_at = now()
  FROM finance.rec_accounts a
 WHERE a.id = r.rec_account_id AND a.account_key LIKE 'bank:%' AND r.line_key = 'vat'
   AND r.status <> 'signed_off' AND a.placed_by IS NULL;
