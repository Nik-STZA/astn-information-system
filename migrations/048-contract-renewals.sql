-- 048-contract-renewals.sql
--
-- Contracts, monitored (Nik, 15 Nov 2026: "a list, and to monitor contracts to
-- avoid unnecessary renewals"; it also feeds budgeting and forecasting):
--
--   cost_amount, billing_frequency   what the contract costs or earns per
--                                    period, so the register can show the
--                                    annual value, what is renewing soon, and
--                                    a month-by-month forward view
--   document_url                     a link to the signed contract where it
--                                    lives (the client's Drive); the platform
--                                    keeps no copy
--   renewal_decision ...             the decision on the coming renewal: keep,
--                                    cancel or renegotiate, with why, who and
--                                    for which end date (a moved end date asks
--                                    again)
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it.

SET lock_timeout = '10s';

ALTER TABLE finance.contracts
  ADD COLUMN IF NOT EXISTS cost_amount numeric(14,2) CHECK (cost_amount IS NULL OR cost_amount >= 0),
  ADD COLUMN IF NOT EXISTS billing_frequency text CHECK (billing_frequency IS NULL OR billing_frequency IN ('monthly', 'quarterly', 'annual', 'one_off')),
  ADD COLUMN IF NOT EXISTS document_url text CHECK (document_url IS NULL OR document_url ~ '^https://'),
  ADD COLUMN IF NOT EXISTS renewal_decision text CHECK (renewal_decision IS NULL OR renewal_decision IN ('keep', 'cancel', 'renegotiate')),
  ADD COLUMN IF NOT EXISTS renewal_decision_note text,
  ADD COLUMN IF NOT EXISTS renewal_decision_for date,
  ADD COLUMN IF NOT EXISTS renewal_decided_by text,
  ADD COLUMN IF NOT EXISTS renewal_decided_at timestamptz;

COMMENT ON COLUMN finance.contracts.cost_amount IS 'Amount per billing period (cost for a supplier contract, income for a customer one), for the annual value and the forward view.';
COMMENT ON COLUMN finance.contracts.renewal_decision_for IS 'The end date the renewal decision was made for; when the end date moves, the decision no longer applies.';
