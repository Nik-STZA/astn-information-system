-- 001-finance-core.sql
--
-- Core tables for the STZA Finance module, per portal spec sections 5.1 to 5.6.
-- Every object is qualified finance.* and CI enforces that
-- (scripts/check-finance-schema.mjs). Client identity lives in shared.clients;
-- this module attaches its own config and never reads another module's tables.
--
-- Idempotent and re-runnable.

-- Keeps updated_at honest without relying on the caller.
CREATE OR REPLACE FUNCTION finance.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── Client-scoped configuration ──────────────────────────────────────────────
-- Presence of a row here is what makes a client a Finance client. There is no
-- boolean flag on shared.clients, so no module writes to another's territory.

CREATE TABLE IF NOT EXISTS finance.client_finance_config (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL UNIQUE REFERENCES shared.clients (id) ON DELETE CASCADE,
  accounting_system         text NOT NULL DEFAULT 'xero',
  close_cadence             text NOT NULL DEFAULT 'monthly',
  materiality_thresholds    jsonb NOT NULL DEFAULT '{}'::jsonb,
  cash_floor_gbp            numeric,
  reporting_currency        text NOT NULL DEFAULT 'GBP',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finance.client_finance_config IS
  'Per-client Finance settings. A row here means the client appears in the Finance module.';


-- ── Entities ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.entities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  slug                      text NOT NULL,
  name                      text NOT NULL,
  legal_name                text,
  accounting_system         text NOT NULL DEFAULT 'xero',
  accounting_system_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  role                      text,
  year_end                  date,
  folder_path               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, slug)
);

COMMENT ON COLUMN finance.entities.accounting_system_config IS
  'Adapter-specific, non-secret identifiers only. Xero: { config_name, tenant_id }. Never store secrets here; they belong in Secret Manager.';


-- ── Chart of accounts mapping ────────────────────────────────────────────────
-- Migrated from Master Mapping as at <date>.csv. Note the natural key is
-- (account_code, account_name), not account_code alone: five codes in the
-- source appear twice with different names (427, 442, 463, 666, 802), and six
-- bank rows carry no code at all.

CREATE TABLE IF NOT EXISTS finance.chart_of_accounts_mapping (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  account_code      text NOT NULL DEFAULT '',
  account_name      text NOT NULL,
  account_type      text,
  tax_code          text,
  pnl_mapping_1     text,
  pnl_mapping_2     text,
  pnl_mapping_3     text,
  bs_mapping        text,
  source_file       text,
  source_row        int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, account_code, account_name)
);

CREATE INDEX IF NOT EXISTS idx_finance_coa_code
  ON finance.chart_of_accounts_mapping (client_id, account_code);

COMMENT ON TABLE finance.chart_of_accounts_mapping IS
  'Account code to category mapping. Source of truth for what an account contains (Feldspar CLAUDE.md rule 9). Read-only in v1; edit the CSV and re-run the import.';


-- ── Diary and open items ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.diary_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  occurred_at   timestamptz,
  role          text,
  agent_name    text,
  action        text NOT NULL,
  where_path    text,
  status        text,
  notes         text,
  source_file   text NOT NULL,
  source_line   int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source_file, source_line)
);

CREATE INDEX IF NOT EXISTS idx_finance_diary_occurred
  ON finance.diary_entries (client_id, occurred_at DESC);

COMMENT ON TABLE finance.diary_entries IS
  'Mirror of diary/YYYY-MM.md. Internal audit trail, so entries MAY name individuals. Nothing here is board-facing (Feldspar CLAUDE.md rule 8).';


CREATE TABLE IF NOT EXISTS finance.open_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id     uuid REFERENCES finance.entities (id) ON DELETE SET NULL,
  title         text NOT NULL,
  category      text,
  owner_role    text,
  status        text,
  raised_at     date,
  due_at        date,
  amount_gbp    numeric,
  notes         text,
  source_file   text NOT NULL,
  source_line   int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source_file, source_line)
);


-- ── Operational tracking ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.recurring_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  task                  text NOT NULL,
  category              text,
  frequency             text,
  scope                 text,
  tier                  text,
  est_minutes           int,
  last_actual_minutes   int,
  status                text,
  last_run_at           timestamptz,
  next_due_at           timestamptz,
  notes                 text,
  source_file           text,
  source_line           int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.backlog_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  task              text NOT NULL,
  category          text,
  suggested_tier    text,
  scope             text,
  notes             text,
  added_at          timestamptz,
  source_file       text,
  source_line       int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.out_of_scope_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  task                  text NOT NULL,
  category              text,
  frequency             text,
  time_spent_minutes    int,
  status                text,
  raised_at             timestamptz,
  notes                 text,
  source_file           text,
  source_line           int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);


-- ── Reference data ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.vendors (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id                 uuid REFERENCES finance.entities (id) ON DELETE SET NULL,
  name                      text NOT NULL,
  service                   text,
  gl_code                   text,
  last_seen_invoice_ref     text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.external_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  description   text,
  occurred_at   timestamptz,
  materiality   text,
  source        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);


-- ── Work in progress and the approval chain ──────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.wip_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id                 uuid REFERENCES finance.entities (id) ON DELETE SET NULL,
  type                      text NOT NULL,
  tier                      text,
  status                    text NOT NULL DEFAULT 'wip',
  panel                     text NOT NULL DEFAULT 'activity',
  priority                  text,
  folder_path               text NOT NULL,
  drafter_role              text,
  current_reviewer_role     text,
  title                     text NOT NULL,
  amount_total              numeric,
  due_at                    timestamptz,
  blocked_on                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, folder_path)
);

CREATE INDEX IF NOT EXISTS idx_finance_wip_panel
  ON finance.wip_items (client_id, panel, updated_at DESC);

COMMENT ON COLUMN finance.wip_items.panel IS
  'Which Approvals state panel the item renders in. Exactly one of: awaiting-decision, blocked-external, in-progress-upstream, upcoming, activity.';
COMMENT ON COLUMN finance.wip_items.folder_path IS
  'Path to the WIP folder relative to the client folder. The file system stays the source of truth.';


CREATE TABLE IF NOT EXISTS finance.wip_review_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wip_id            uuid NOT NULL REFERENCES finance.wip_items (id) ON DELETE CASCADE,
  reviewer_role     text NOT NULL,
  outcome           text NOT NULL,
  findings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes             text,
  next_step         text,
  reviewed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_review_wip
  ON finance.wip_review_log (wip_id, reviewed_at);


-- ── Audit ────────────────────────────────────────────────────────────────────
-- Records every approve, reject, send back, and every reveal, rotate or copy of
-- a sensitive field (brief section 8.3). Identity is the IAP-asserted email;
-- there is no users table because IAP is the identity provider.
--
-- Never write an unmasked secret into payload.

CREATE TABLE IF NOT EXISTS finance.audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email   text NOT NULL,
  action        text NOT NULL,
  target_type   text NOT NULL,
  target_id     text,
  client_id     uuid REFERENCES shared.clients (id) ON DELETE SET NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address    inet,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_audit_occurred
  ON finance.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_audit_actor
  ON finance.audit_log (actor_email, occurred_at DESC);


-- ── updated_at triggers ──────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_finance_config', 'entities', 'chart_of_accounts_mapping',
    'open_items', 'recurring_tasks', 'backlog_items', 'out_of_scope_items',
    'vendors', 'wip_items'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON finance.%I; '
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.%I '
      'FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();', t, t);
  END LOOP;
END $$;


-- ── Seed: make Feldspar a Finance client ─────────────────────────────────────

INSERT INTO finance.client_finance_config (
  client_id, accounting_system, close_cadence, materiality_thresholds, cash_floor_gbp
)
SELECT id, 'xero', 'monthly',
       '{"bva_variance_flag_gbp": 5000, "balance_control_threshold_gbp": 1000}'::jsonb,
       NULL
FROM shared.clients WHERE slug = 'feldspar-sport-group'
ON CONFLICT (client_id) DO NOTHING;

-- All three entities now carry a 31 December year-end. FGH moved from 30 April
-- and UDL from 31 August via transitional periods ending 31 December 2025, so
-- historical data either side of those dates spans uneven periods.
INSERT INTO finance.entities (client_id, slug, name, legal_name, role, year_end, accounting_system_config)
SELECT c.id, v.slug, v.name, v.legal_name, v.role, v.year_end::date,
       jsonb_build_object('config_name', v.config_name)
FROM shared.clients c
CROSS JOIN (VALUES
  ('ultraspeed-digital',      'UDL', 'Ultraspeed Digital Limited',        'Operating', '2025-12-31', 'ultraspeed'),
  ('feldspar-ltd',            'FSL', 'Feldspar Ltd',                      'Trading',   '2025-12-31', 'feldspar_ltd'),
  ('feldspar-group-holdings', 'FGH', 'Feldspar Group Holdings Limited',   'Holding',   '2025-12-31', 'feldspar_holdings')
) AS v(slug, name, legal_name, role, year_end, config_name)
WHERE c.slug = 'feldspar-sport-group'
ON CONFLICT (client_id, slug) DO NOTHING;
