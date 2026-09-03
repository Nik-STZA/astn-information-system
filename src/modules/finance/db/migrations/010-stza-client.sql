-- 010-stza-client.sql
--
-- Adds STZA (Sports Tech Africa Limited) as a client so the operator can use
-- the Finance module and MCP server against their own practice books.
--
-- STZA is the operator's own company, so operator_is_controller = true.
-- There is one Xero organisation: Sports Tech Africa Limited.
--
-- Idempotent and re-runnable.

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
