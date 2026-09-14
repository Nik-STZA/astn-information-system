-- 017: approved account mapping and reporting categories for the pack engine.
--
-- The pack engine puts every Xero account into a reporting category (Staff
-- costs, Debtors...). Until now it proposed those by rule on every build and
-- the pack said "not yet approved". This moves the decision into the platform:
-- a person approves each account's category in the portal, and the engine uses
-- what was approved.
--
-- Two tables:
--
--   reporting_categories  the lines a pack can show. Rows with no client are
--                         the standard set; a client row with the same key
--                         overrides it (rename, reorder, switch off) and a
--                         client row with a new key adds a line for that client
--                         only, e.g. "Amortisation of development costs" for a
--                         business that capitalises development.
--   account_mappings      one row per Xero account per entity: its category,
--                         whether it is approved, and who approved it when.
--
-- Accounts are keyed by Xero AccountID, never by code or name, which repeat and
-- change. Code and name are kept as they were when the mapping was saved, so a
-- renamed account can be spotted.
--
-- finance.chart_of_accounts_mapping (001) is left untouched: it is the Master
-- Mapping import that the legacy Feldspar pipeline reads.
--
-- A category is referenced by key rather than by foreign key, because which row
-- a key means depends on the client (standard or override). finance-api
-- validates keys on write and the engine fails a build on a key it cannot find.
--
-- Idempotent.

-- Sections are the statement structure the engine renders, so they are fixed.
-- cash_flow says where a balance sheet category's movement goes on the indirect
-- cash flow; on the P&L only 'non_cash' (added back, like depreciation) means
-- anything. 'cash' and 'retained_earnings' belong to the standard categories of
-- those names only, which finance-api enforces.
CREATE TABLE IF NOT EXISTS finance.reporting_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES shared.clients (id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  label       text NOT NULL CHECK (length(trim(label)) > 0),
  statement   text NOT NULL CHECK (statement IN ('pnl', 'bs')),
  section     text NOT NULL,
  sort_order  integer NOT NULL,
  cash_flow   text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_category_section CHECK (
    (statement = 'pnl' AND section IN ('turnover', 'cost_of_sales', 'overheads', 'finance', 'taxation'))
    OR (statement = 'bs' AND section IN ('fixed_assets', 'current_assets', 'creditors_lt1y',
                                         'creditors_gt1y', 'provisions', 'equity'))
  ),
  CONSTRAINT reporting_category_cash_flow CHECK (
    (statement = 'pnl' AND (cash_flow IS NULL OR cash_flow = 'non_cash'))
    OR (statement = 'bs' AND cash_flow IN ('cash', 'working_capital', 'provisions', 'tax', 'capex',
                                           'investments', 'loans', 'equity', 'dividends',
                                           'retained_earnings'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reporting_categories_standard
  ON finance.reporting_categories (key) WHERE client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reporting_categories_client
  ON finance.reporting_categories (client_id, key) WHERE client_id IS NOT NULL;

COMMENT ON TABLE finance.reporting_categories IS
  'Pack lines. client_id NULL is the standard set; a client row with the same key overrides it, a new key adds a client-only line.';

INSERT INTO finance.reporting_categories (client_id, key, label, statement, section, sort_order, cash_flow)
VALUES
  (NULL, 'turnover',          'Turnover',                                                'pnl', 'turnover',        10, NULL),
  (NULL, 'cost_of_sales',     'Cost of sales',                                           'pnl', 'cost_of_sales',   20, NULL),
  (NULL, 'staff_costs',       'Staff costs',                                             'pnl', 'overheads',       30, NULL),
  (NULL, 'establishment',     'Establishment costs',                                     'pnl', 'overheads',       40, NULL),
  (NULL, 'professional_fees', 'Legal and professional fees',                             'pnl', 'overheads',       50, NULL),
  (NULL, 'administrative',    'Administrative expenses',                                 'pnl', 'overheads',       60, NULL),
  (NULL, 'depreciation',      'Depreciation and amortisation',                           'pnl', 'overheads',       70, 'non_cash'),
  (NULL, 'fx',                'Foreign exchange gains and losses',                       'pnl', 'overheads',       80, NULL),
  (NULL, 'other_income',      'Interest receivable and other income',                    'pnl', 'finance',         90, NULL),
  (NULL, 'interest_payable',  'Interest payable',                                        'pnl', 'finance',        100, NULL),
  (NULL, 'taxation',          'Taxation',                                                'pnl', 'taxation',       110, NULL),
  (NULL, 'intangible_assets', 'Intangible assets',                                       'bs',  'fixed_assets',   200, 'capex'),
  (NULL, 'tangible_assets',   'Tangible assets',                                         'bs',  'fixed_assets',   210, 'capex'),
  (NULL, 'investments',       'Investments',                                             'bs',  'fixed_assets',   220, 'investments'),
  (NULL, 'stock',             'Stock',                                                   'bs',  'current_assets', 300, 'working_capital'),
  (NULL, 'debtors',           'Debtors',                                                 'bs',  'current_assets', 310, 'working_capital'),
  (NULL, 'cash',              'Cash at bank and in hand',                                'bs',  'current_assets', 320, 'cash'),
  (NULL, 'creditors_lt1y',    'Creditors: amounts falling due within one year',          'bs',  'creditors_lt1y', 400, 'working_capital'),
  (NULL, 'creditors_gt1y',    'Creditors: amounts falling due after more than one year', 'bs',  'creditors_gt1y', 410, 'loans'),
  (NULL, 'provisions',        'Provisions for liabilities',                              'bs',  'provisions',     420, 'provisions'),
  (NULL, 'share_capital',     'Called up share capital',                                 'bs',  'equity',         500, 'equity'),
  (NULL, 'retained_earnings', 'Profit and loss account',                                 'bs',  'equity',         510, 'retained_earnings'),
  (NULL, 'other_reserves',    'Other reserves',                                          'bs',  'equity',         520, 'equity')
ON CONFLICT (key) WHERE client_id IS NULL DO NOTHING;


CREATE TABLE IF NOT EXISTS finance.account_mappings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id          uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  xero_account_id    text NOT NULL,
  account_code       text,
  account_name       text NOT NULL,
  account_class      text NOT NULL,
  category_key       text NOT NULL,
  -- Overrides the category's cash flow class for this one account, e.g. a
  -- director's loan inside creditors.
  cash_flow          text CHECK (cash_flow IN ('working_capital', 'provisions', 'tax', 'capex',
                                               'investments', 'loans', 'equity', 'dividends')),
  status             text NOT NULL CHECK (status IN ('proposed', 'approved')),
  source             text NOT NULL CHECK (source IN ('rule', 'manual', 'upload', 'agent')),
  reason             text,
  proposed_by_email  text NOT NULL,
  proposed_at        timestamptz NOT NULL DEFAULT now(),
  approved_by_email  text,
  -- The approver's engagement role at the time (migration 003), a snapshot.
  approved_role      text,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, xero_account_id),
  CONSTRAINT account_mapping_approval CHECK (
    (status = 'approved') = (approved_by_email IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_account_mappings_client ON finance.account_mappings (client_id);

COMMENT ON TABLE finance.account_mappings IS
  'Which reporting category each Xero account (by AccountID) belongs to, per entity, and who approved it. Every change is also written to finance.audit_log.';

DROP TRIGGER IF EXISTS set_updated_at ON finance.reporting_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.reporting_categories
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON finance.account_mappings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.account_mappings
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
