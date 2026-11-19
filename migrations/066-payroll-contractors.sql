-- 066-payroll-contractors.sql
--
-- Contractors in the capitalisation (19 Nov 2026). A contractor invoices the
-- payroll company, often through an umbrella company whose bills name the
-- person on the line. os.stza.io knows a contractor only by a code (C1, C2,
-- ...): the settings hold the supplier's Xero contact and a keyed fingerprint
-- of a word in the person's name (HMAC-SHA256, key in Secret Manager as
-- payroll-match-key), never the name itself. Each month the supplier's bills
-- are read from Xero and the lines whose words match are that contractor's
-- cost; the CFO's confirmed shares of it are capitalised in its own journal
-- (payroll_kind 'capdev_contractor'), with no recharge.
--
-- Needs 065. Additive and re-runnable.

SET lock_timeout = '10s';

ALTER TABLE finance.payroll_settings
  -- [{ code, contact_id, match }]: see lib/payroll-contractors.js.
  ADD COLUMN IF NOT EXISTS contractors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contractors) = 'array');

ALTER TABLE finance.payroll_runs
  -- { code: { cost, bills: [invoice number] } } as read from Xero, and when.
  ADD COLUMN IF NOT EXISTS contractor_costs jsonb CHECK (contractor_costs IS NULL OR jsonb_typeof(contractor_costs) = 'object'),
  ADD COLUMN IF NOT EXISTS contractor_costs_read_at timestamptz;

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journal_payroll_has_run;
ALTER TABLE finance.journals ADD CONSTRAINT journal_payroll_has_run
  CHECK (source <> 'payroll' OR (payroll_run_id IS NOT NULL AND payroll_kind IN ('payroll', 'contracted', 'capdev', 'capdev_other', 'capdev_contractor')));
