-- 049-asset-register.sql
--
-- The asset register (docs/asset-register-spec.md, CFO decisions of 16 Nov
-- 2026): a client-neutral register that follows an asset from WIP cost
-- through its whole life, proved against the ledger every month, replacing
-- hand-rolled Excel registers. Groupings (kinds of asset, each proved its own
-- way) are defined in code (finance-api/lib/asset-groupings.js) and switched on
-- per client by the CFO.
--
--   finance.asset_groupings_client  a grouping switched on (or paused) for a client
--   finance.asset_account_map       which ledger accounts a grouping uses, per
--                                   company, by Xero AccountID, dated, and who
--                                   amortises them (the register or Xero's own
--                                   fixed asset register). An account may serve
--                                   more than one grouping (a shared WIP account)
--   finance.asset_policies          the rules an asset follows, per grouping,
--                                   framework and basis, effective dated
--   finance.assets                  the register: one row per asset or sub-asset
--   finance.asset_cost_lines        every slice of every invoice or journal line
--                                   that builds up an asset, with its treatment
--                                   and reason, stored as an amount
--   finance.asset_approvals         every change of state of a cost line, policy,
--                                   grouping or signed month (append only)
--   finance.asset_events            what happens to an asset: transfer to
--                                   available for use, amortisation, impairment,
--                                   reclass, catch-up, disposal (append only)
--   finance.asset_register_periods  a grouping's month: open, prepared, signed,
--                                   with the figures at sign-off
--   finance.asset_planned_lines     forecast cost, kept apart from actual cost
--                                   (CFO, 16 Nov 2026); settled by a cost line
--
-- Not here, by CFO decision (16 Nov 2026): the journals changes (source
-- 'asset' and its link) wait for the migration that ships the first register
-- journal, and the rec_evidence method 'asset_register' waits for the rec hook.
--
-- Rows are never deleted: no DELETE grant, and client and company keys are ON
-- DELETE RESTRICT, so a client that holds asset history cannot be removed with
-- it. Events and approvals are append only by trigger (as 029's
-- shared.client_events). A signed month refuses new or changed cost lines and
-- events dated in it, here as well as in finance-api.
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it; until
-- then finance-api answers its routes with migration_missing.

SET lock_timeout = '10s';

-- ── Groupings switched on per client ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_groupings_client (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  -- A key of the catalogue in finance-api/lib/asset-groupings.js.
  grouping      text NOT NULL CHECK (grouping ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled       boolean NOT NULL DEFAULT false,
  enabled_by    text,
  enabled_at    timestamptz,
  -- Paused (CFO, 16 Nov 2026): data kept, no intake,
  -- no proposals, its rec shown as paused rather than failing.
  paused        boolean NOT NULL DEFAULT false,
  paused_by     text,
  paused_at     timestamptz,
  paused_reason text,
  -- Numbering scheme, e.g. {ENTITY}-TMK-{0000}, {ENTITY}-PSA-{00000}.
  numbering     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Suppliers to watch at intake: [{ name, contact_id }].
  suppliers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Export folder pattern and branding, as pack profiles hold them.
  export        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, grouping),
  CONSTRAINT asset_grouping_enabled_by CHECK (NOT enabled OR (enabled_by IS NOT NULL AND enabled_at IS NOT NULL)),
  CONSTRAINT asset_grouping_paused_reason CHECK (NOT paused OR length(btrim(coalesce(paused_reason, ''))) >= 3)
);

-- ── Ledger accounts a grouping uses ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_account_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  entity_id       uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  grouping        text NOT NULL,
  -- What the account is to the grouping.
  role            text NOT NULL CHECK (role IN ('cost', 'wip', 'accumulated', 'charge', 'impairment', 'capitalisation_credit')),
  -- Xero's AccountID, so a renumbered chart does not break the map. The code
  -- is kept as it was when mapped, for people to read.
  xero_account_id text NOT NULL CHECK (xero_account_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  account_code    text,
  -- Who runs amortisation on the account (CFO decision 9, 16 Nov 2026): the
  -- register (os.stza.io journals) or Xero's own fixed asset register.
  amortised_by    text NOT NULL CHECK (amortised_by IN ('register', 'xero')),
  effective_from  date NOT NULL,
  effective_to    date,
  set_by          text NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  -- A mapping ends by date, never by deletion.
  ended_by        text,
  ended_at        timestamptz,
  note            text,
  CONSTRAINT asset_account_map_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (entity_id, grouping, role, xero_account_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_finance_asset_account_map_account
  ON finance.asset_account_map (entity_id, xero_account_id, effective_from);

-- ── Policies ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  grouping          text NOT NULL,
  -- e.g. dev_wip_track, patent, trade_mark, domain, performance_surface.
  class_key         text NOT NULL CHECK (class_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  class_name        text NOT NULL,
  -- The template it came from ('FRS 102' or 'IFRS'), read from the company's
  -- finance.entities.reporting_framework, never chosen here.
  framework         text NOT NULL CHECK (framework IN ('FRS 102', 'IFRS')),
  -- The basis it is measured under. One basis in v1; dual basis is additive.
  basis             text NOT NULL CHECK (basis IN ('FRS 102', 'IFRS')),
  -- e.g. ["FRS 102 s18.8H", "capitalisation-policy.md s9"].
  standard_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
  life_kind         text NOT NULL DEFAULT 'finite' CHECK (life_kind IN ('finite', 'indefinite')),
  life_months       integer CHECK (life_months IS NULL OR (life_months > 0 AND life_months <= 1200)),
  method            text NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line')),
  residual_value    numeric(14,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  start_convention  text NOT NULL CHECK (start_convention IN ('month_following', 'same_month')),
  start_trigger     text NOT NULL CHECK (start_trigger IN ('available_for_use', 'registration', 'grant')),
  -- What may be capitalised: [{ code, treatment, reason, ref }].
  eligibility       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- An open policy conflict, shown on every asset that uses it (Flag 3).
  conflict_note     text,
  effective_from    date NOT NULL,
  effective_to      date,
  approved_by       text,
  approved_at       timestamptz,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  superseded_by     uuid REFERENCES finance.asset_policies (id),
  CONSTRAINT asset_policy_life CHECK ((life_kind = 'finite' AND life_months IS NOT NULL) OR (life_kind = 'indefinite' AND life_months IS NULL)),
  -- FRS 102 never allows an indefinite life (s18.19).
  CONSTRAINT asset_policy_frs_finite CHECK (basis <> 'FRS 102' OR life_kind = 'finite'),
  CONSTRAINT asset_policy_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (client_id, grouping, class_key, basis, effective_from)
);

-- ── The register ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  entity_id         uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  grouping          text NOT NULL,
  -- The client's existing numbering, e.g. ABC-TMK-0001.
  asset_no          text NOT NULL CHECK (length(btrim(asset_no)) > 0),
  name              text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Sub-assets (ABC-TMK-0008-CA-R) and an engineering component split. A
  -- parent can hold cost not yet split to its components.
  parent_asset_id   uuid REFERENCES finance.assets (id),
  policy_id         uuid REFERENCES finance.asset_policies (id),
  status            text NOT NULL CHECK (status IN ('research', 'wip', 'pending', 'available', 'registered', 'impaired', 'disposed', 'lapsed')),
  -- Xero AccountIDs, resolved per company through asset_account_map.
  cost_account_id   text,
  accum_account_id  text,
  charge_account_id text,
  filing_date       date,
  registration_date date,
  expiry_date       date,
  renewal_date      date,
  completion_date   date,
  -- A copy of the signed transfer event (asset_events), written only with it.
  -- The only thing that starts actual amortisation.
  available_for_use_date date,
  available_event_id uuid,
  -- IP fields.
  registration_no   text,
  jurisdiction      text,
  ip_owner          text,
  ipo_url           text,
  wipo_url          text,
  ip_category       text,
  -- Tangible fields (quantity and location, for a surplus split).
  location          text,
  quantity          numeric(14,3) CHECK (quantity IS NULL OR quantity >= 0),
  -- Forecast fields (spec 11). The expected date drives forecast
  -- amortisation only, never actual.
  expected_live_date date,
  expected_confidence text CHECK (expected_confidence IS NULL OR expected_confidence IN ('high', 'medium', 'low')),
  expected_evidence text,
  line_code         text,
  raise_bucket      text,
  fields            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Where it came from: { file, tab, row, modified, sha256 } for migrated rows.
  source_ref        jsonb,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, entity_id, asset_no),
  CONSTRAINT asset_not_own_parent CHECK (parent_asset_id IS NULL OR parent_asset_id <> id),
  CONSTRAINT asset_available_from_event CHECK ((available_for_use_date IS NULL) = (available_event_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_finance_assets_grouping ON finance.assets (client_id, grouping, entity_id);
CREATE INDEX IF NOT EXISTS idx_finance_assets_parent ON finance.assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;

-- ── Forecast cost (before cost lines, which settle it) ──────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_planned_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  grouping         text NOT NULL,
  asset_id         uuid REFERENCES finance.assets (id),
  scenario         text NOT NULL DEFAULT 'base' CHECK (length(btrim(scenario)) > 0),
  forecast_version text NOT NULL CHECK (length(btrim(forecast_version)) > 0),
  supplier         text,
  expected_date    date NOT NULL,
  amount           numeric(14,2) NOT NULL,
  vat              numeric(14,2),
  payment_days     integer CHECK (payment_days IS NULL OR (payment_days >= 0 AND payment_days <= 365)),
  -- What it comes from: proposal and phase, contract, purchase order.
  commitment       jsonb NOT NULL DEFAULT '{}'::jsonb,
  treatment        text,
  line_code        text,
  raise_bucket     text,
  state            text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'settled', 'withdrawn')),
  note             text,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  withdrawn_by     text,
  withdrawn_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_finance_asset_planned ON finance.asset_planned_lines (client_id, forecast_version, scenario, expected_date);

-- ── Cost lines: the invoice ledger ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_cost_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  grouping            text NOT NULL,
  -- Source. invoice / manual_journal / bank_transaction carry their Xero ids;
  -- workbook is a row migrated from a register workbook whose Xero id is not
  -- known, and must carry source_ref instead.
  source_type         text NOT NULL CHECK (source_type IN ('invoice', 'manual_journal', 'bank_transaction', 'workbook')),
  xero_source_id      text,
  xero_line_id        text,
  -- The company that was billed, and the company that owns the asset (a
  -- parent may be billed for a subsidiary's trade marks, or settle group invoices).
  billed_entity_id    uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  owning_entity_id    uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  supplier            text,
  invoice_no          text,
  -- The date Xero posts it to the ledger: the month it is an addition in.
  line_date           date NOT NULL,
  -- The source line's base-currency net (a manual journal line: its amount,
  -- debit positive, no VAT). Every slice of one source line carries it.
  source_net          numeric(14,2) NOT NULL,
  source_vat          numeric(14,2),
  source_gross        numeric(14,2),
  currency            text NOT NULL DEFAULT 'GBP' CHECK (currency ~ '^[A-Z]{3}$'),
  original_amount     numeric(14,2),
  fx_rate             numeric(18,8),
  document_link       text,
  -- Description: every field the workbook tabs hold.
  proposal_no         text,
  phase               text,
  phase_name          text,
  work_description    text,
  item                text,
  item_type           text,
  jurisdiction        text,
  cost_per_country    numeric(14,2),
  rd_milestone        text,
  ipo_status          text,
  fields              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Allocation. The amount is stored; a percentage is information only (a
  -- supplier's rounded percentages put GBP 4.00 into a register).
  asset_id            uuid REFERENCES finance.assets (id),
  amount              numeric(14,2) NOT NULL,
  percent_info        numeric(9,6),
  -- Treatment and why.
  treatment           text CHECK (treatment IS NULL OR treatment IN
                        ('capitalise', 'expense_research', 'expense_admin', 'training', 'marketing', 'inventory', 'other_register')),
  reason_ref          text,
  reason_text         text,
  -- Where it should sit against where Xero has it, by AccountID.
  expected_account_id text,
  posted_account_id   text,
  posted_account_code text,
  fix_route           text CHECK (fix_route IS NULL OR fix_route IN ('edit_bill', 'journal')),
  -- Approval: the current state; history is in asset_approvals.
  state               text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected', 'withdrawn', 'superseded')),
  settles_planned_id  uuid REFERENCES finance.asset_planned_lines (id),
  superseded_by       uuid REFERENCES finance.asset_cost_lines (id),
  source_ref          jsonb,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_cost_line_xero_source CHECK (source_type = 'workbook' OR xero_source_id IS NOT NULL),
  CONSTRAINT asset_cost_line_workbook_ref CHECK (source_type <> 'workbook' OR source_ref IS NOT NULL),
  -- Capitalised cost always belongs to an asset.
  CONSTRAINT asset_cost_line_capitalised_has_asset CHECK (treatment IS DISTINCT FROM 'capitalise' OR asset_id IS NOT NULL),
  CONSTRAINT asset_cost_line_approved_has_treatment CHECK (state <> 'approved' OR (treatment IS NOT NULL AND length(btrim(coalesce(reason_text, ''))) >= 3))
);

CREATE INDEX IF NOT EXISTS idx_finance_asset_cost_lines_source ON finance.asset_cost_lines (client_id, source_type, xero_source_id, xero_line_id);
CREATE INDEX IF NOT EXISTS idx_finance_asset_cost_lines_asset ON finance.asset_cost_lines (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_asset_cost_lines_month ON finance.asset_cost_lines (client_id, grouping, line_date);

-- ── Approvals (append only) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_approvals (
  id            bigserial PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  subject_kind  text NOT NULL CHECK (subject_kind IN ('cost_line', 'policy', 'grouping', 'account_map', 'period')),
  subject_id    uuid NOT NULL,
  from_state    text,
  to_state      text NOT NULL,
  actor         text NOT NULL,
  role          text,
  reason        text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_asset_approvals_subject ON finance.asset_approvals (subject_kind, subject_id, at);

-- ── Events (append only) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  entity_id         uuid NOT NULL REFERENCES finance.entities (id) ON DELETE RESTRICT,
  asset_id          uuid NOT NULL REFERENCES finance.assets (id),
  grouping          text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('opening', 'transfer', 'amortisation', 'impairment', 'impairment_test',
                                                  'disposal', 'reclass', 'catch_up', 'transition', 'reversal')),
  basis             text NOT NULL CHECK (basis IN ('FRS 102', 'IFRS')),
  period            text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  event_date        date NOT NULL,
  amount            numeric(14,2) NOT NULL DEFAULT 0,
  -- { cost, accumulated, charge } as Xero AccountIDs, for the figures it moves.
  accounts          jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason            text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence_ref      text,
  signed_by         text,
  signed_at         timestamptz,
  -- A wrong event is answered by a reversal, never edited.
  reverses_event_id uuid REFERENCES finance.asset_events (id),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_event_in_period CHECK (to_char(event_date, 'YYYY-MM') = period),
  -- Available for use is signed, with evidence (spec 4.2).
  CONSTRAINT asset_event_transfer_signed CHECK (kind <> 'transfer' OR (signed_by IS NOT NULL AND signed_at IS NOT NULL AND length(btrim(coalesce(evidence_ref, ''))) >= 3)),
  CONSTRAINT asset_event_reversal_has_target CHECK ((kind = 'reversal') = (reverses_event_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_finance_asset_events_asset ON finance.asset_events (asset_id, period);
CREATE INDEX IF NOT EXISTS idx_finance_asset_events_month ON finance.asset_events (client_id, grouping, period);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_available_event_fk' AND conrelid = 'finance.assets'::regclass) THEN
    ALTER TABLE finance.assets ADD CONSTRAINT assets_available_event_fk
      FOREIGN KEY (available_event_id) REFERENCES finance.asset_events (id);
  END IF;
END $$;

-- ── Signed months ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.asset_register_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES shared.clients (id) ON DELETE RESTRICT,
  grouping        text NOT NULL,
  period          text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'prepared', 'signed')),
  -- At sign-off: figures per company, asset and account, the checks, and the
  -- trial balance tied to ({ entity: { as_at, read_at, totals } }).
  snapshot        jsonb,
  trial_balance   jsonb,
  prepared_by     text,
  prepared_at     timestamptz,
  signed_by       text,
  signed_at       timestamptz,
  reopened_by     text,
  reopened_at     timestamptz,
  reopen_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, grouping, period),
  CONSTRAINT asset_period_signed CHECK (status <> 'signed' OR (signed_by IS NOT NULL AND signed_at IS NOT NULL AND snapshot IS NOT NULL))
);

-- ── Append only ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION finance.asset_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: answer a wrong row with a new one', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asset_events_no_update ON finance.asset_events;
CREATE TRIGGER asset_events_no_update BEFORE UPDATE OR DELETE ON finance.asset_events
  FOR EACH ROW EXECUTE FUNCTION finance.asset_append_only();

DROP TRIGGER IF EXISTS asset_approvals_no_update ON finance.asset_approvals;
CREATE TRIGGER asset_approvals_no_update BEFORE UPDATE OR DELETE ON finance.asset_approvals
  FOR EACH ROW EXECUTE FUNCTION finance.asset_append_only();

-- ── The signed month locks ───────────────────────────────────────────────────
--
-- A cost line or event dated in a signed month of its grouping is refused, on
-- the way in and (for a cost line) on any change, old date or new. A
-- correction is a reclass or catch-up event in an open month. finance-api
-- checks first and gives the reason in words; this is the backstop.

CREATE OR REPLACE FUNCTION finance.asset_period_lock() RETURNS trigger AS $$
DECLARE
  months text[];
  locked text;
BEGIN
  IF TG_TABLE_NAME = 'asset_events' THEN
    months := ARRAY[NEW.period];
  ELSIF TG_OP = 'UPDATE' THEN
    months := ARRAY[to_char(NEW.line_date, 'YYYY-MM'), to_char(OLD.line_date, 'YYYY-MM')];
  ELSE
    months := ARRAY[to_char(NEW.line_date, 'YYYY-MM')];
  END IF;
  SELECT p.period INTO locked FROM finance.asset_register_periods p
   WHERE p.client_id = NEW.client_id AND p.grouping = NEW.grouping
     AND p.period = ANY (months) AND p.status = 'signed'
   LIMIT 1;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'asset register % is signed for %: reopen it, or record a correction in an open month', NEW.grouping, locked
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asset_cost_lines_period_lock ON finance.asset_cost_lines;
CREATE TRIGGER asset_cost_lines_period_lock BEFORE INSERT OR UPDATE ON finance.asset_cost_lines
  FOR EACH ROW EXECUTE FUNCTION finance.asset_period_lock();

DROP TRIGGER IF EXISTS asset_events_period_lock ON finance.asset_events;
CREATE TRIGGER asset_events_period_lock BEFORE INSERT ON finance.asset_events
  FOR EACH ROW EXECUTE FUNCTION finance.asset_period_lock();

-- ── Comments and grants ──────────────────────────────────────────────────────

COMMENT ON TABLE finance.assets IS
  'The asset register: one row per asset or sub-asset, by grouping (lib/asset-groupings.js). Amortisation starts only from a signed transfer event.';
COMMENT ON TABLE finance.asset_cost_lines IS
  'Every slice of an invoice or journal line that builds up an asset: amount, treatment, reason, expected against posted account. Slices of one source line sum to its net.';
COMMENT ON TABLE finance.asset_account_map IS
  'Ledger accounts each grouping uses per company, by Xero AccountID, dated, with who amortises them (register or Xero). An account may serve several groupings.';
COMMENT ON TABLE finance.asset_planned_lines IS
  'Forecast asset cost by scenario and version, kept apart from actual cost lines; an actual line records which planned line it settles.';

GRANT SELECT, INSERT, UPDATE ON finance.asset_groupings_client TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.asset_account_map TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.asset_policies TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.assets TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.asset_planned_lines TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.asset_cost_lines TO africastn_app;
GRANT SELECT, INSERT ON finance.asset_approvals TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE finance.asset_approvals_id_seq TO africastn_app;
GRANT SELECT, INSERT ON finance.asset_events TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.asset_register_periods TO africastn_app;
