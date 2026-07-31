-- Which clients are the operator's own business rather than a third party.
--
-- The runner refuses an ungoverned processing path, and until now the only
-- exemption was a hardcoded sandbox slug. That was the wrong distinction. What
-- matters is not whether the data is synthetic; it is WHOSE data it is.
--
-- For a third party's ledger, a confidentiality duty is owed to someone who has
-- not consented and there is no data processing agreement on the consumer path.
-- The runner should refuse, and does.
--
-- For the operator's own company, there is no third party to protect and no
-- consent to obtain. What remains is a terms question between the operator and
-- the provider, which is the operator's decision on the operator's own account
-- and not something for a runner to enforce.
--
-- Default false. Setting it is a deliberate act, recorded, with a reason and a
-- date, so the file shows who decided rather than a constant in a script.

BEGIN;

ALTER TABLE finance.client_finance_config
  ADD COLUMN IF NOT EXISTS operator_is_controller      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operator_is_controller_note text,
  ADD COLUMN IF NOT EXISTS operator_is_controller_set_by    text,
  ADD COLUMN IF NOT EXISTS operator_is_controller_set_at    timestamptz;

COMMENT ON COLUMN finance.client_finance_config.operator_is_controller IS
  'True where the operator is both data controller and client for this engagement, so no third party carries the risk. Permits an ungoverned processing path; every run is still recorded as ungoverned. Never true for a third-party client.';

-- The sandbox is synthetic data and qualifies on the same reasoning.
UPDATE finance.client_finance_config cfc
   SET operator_is_controller = true,
       operator_is_controller_note = 'Synthetic data. No real client, no third party.',
       operator_is_controller_set_by = 'migration 009',
       operator_is_controller_set_at = now()
  FROM shared.clients c
 WHERE c.id = cfc.client_id AND c.slug = 'sandbox-test-group';

COMMIT;
