-- 010-stza-client.sql
--
-- Adds STZA (Sports Tech Africa Limited) as a client so the operator can use
-- the Finance module and MCP server against their own practice books.
--
-- STZA is the operator's own company, so operator_is_controller = true.
-- There is one Xero organisation: Sports Tech Africa Limited.
--
-- Idempotent, but NOT CONVERGENT. Read this before trusting a replay.
--
-- This file was applied to production on or before 31 July 2026 by
-- finance-api/run-migration.js, a one-off script that executes the SQL and does
-- not write to shared.schema_migrations. It was therefore live but unrecorded
-- until baselined on 14 August 2026, and it lived only in an untracked second
-- checkout until the same date.
--
-- Two ways the live database does not match what this file describes:
--
--   1. finance.client_finance_config.materiality_thresholds for 'stza' is {} in
--      production, not the values below. The INSERT uses ON CONFLICT DO NOTHING
--      and a config row already existed, so that clause was a no-op. Re-running
--      this file will NOT set those thresholds. Running it against a fresh
--      database WILL. The two outcomes differ.
--
--   2. The entity created here, 'stza-ltd', is not the connected one. The live
--      Xero connection belongs to a separate entity 'stza' created through the
--      portal, with config_name, legal_name and role all null. 'stza-ltd' has
--      never held a tenant_id. It is retained deliberately rather than deleted
--      (deleting it would put the file and the database back out of step) and
--      has been renamed to make it unselectable by mistake. Reconciling the two
--      rows is separate, considered work and is tracked as an open issue.
--
-- Do not assume replay reproduces production. Verify against the database.

BEGIN;

-- ── shared.clients ──────────────────────────────────────────────────────────

INSERT INTO shared.clients (
  slug, name, legal_name, jurisdiction, framework, year_end, vat_regime,
  status, folder_path
) VALUES (
  'stza',
  'STZA',
  'Sports Tech Africa Limited',
  'United Kingdom',
  'FRS 105',
  '2025-03-31',
  'UK VAT',
  'active',
  NULL
)
ON CONFLICT (slug) DO UPDATE SET
  name         = EXCLUDED.name,
  legal_name   = EXCLUDED.legal_name,
  jurisdiction = EXCLUDED.jurisdiction,
  framework    = EXCLUDED.framework,
  year_end     = EXCLUDED.year_end,
  vat_regime   = EXCLUDED.vat_regime,
  status       = EXCLUDED.status,
  updated_at   = now();

-- ── finance.client_finance_config ───────────────────────────────────────────

INSERT INTO finance.client_finance_config (
  client_id, accounting_system, close_cadence, materiality_thresholds,
  cash_floor_gbp, reporting_currency
)
SELECT id, 'xero', 'monthly',
       '{"bva_variance_flag_gbp": 500, "balance_control_threshold_gbp": 100}'::jsonb,
       NULL, 'GBP'
FROM shared.clients WHERE slug = 'stza'
ON CONFLICT (client_id) DO NOTHING;

-- ── operator_is_controller (migration 009) ──────────────────────────────────

UPDATE finance.client_finance_config cfc
   SET operator_is_controller = true,
       operator_is_controller_note = 'Operator own practice. No third-party data controller.',
       operator_is_controller_set_by = 'migration 010',
       operator_is_controller_set_at = now()
  FROM shared.clients c
 WHERE c.id = cfc.client_id AND c.slug = 'stza';

-- ── finance.entities ────────────────────────────────────────────────────────
-- Single entity for now. The Xero config_name will need to match the key used
-- when storing the OAuth secret in GCP Secret Manager.

INSERT INTO finance.entities (client_id, slug, name, legal_name, role, year_end, accounting_system_config)
SELECT c.id, 'stza-ltd', 'STZA', 'Sports Tech Africa Limited', 'Practice', '2025-03-31'::date,
       jsonb_build_object('config_name', 'stza')
FROM shared.clients c
WHERE c.slug = 'stza'
ON CONFLICT (client_id, slug) DO NOTHING;

COMMIT;
