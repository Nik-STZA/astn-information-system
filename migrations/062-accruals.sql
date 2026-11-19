-- 062-accruals.sql
--
-- Accruals (docs/accruals-spec.md): agent proposals the CFO discusses and
-- decides in place, the precedents those decisions leave for the agents, the
-- schedule of accrued items on the accruals rec, and the accrual with its
-- reversal as one journal pair on the Journals page.
--
--   finance.accrual_settings    the accruals account per company, set by the CFO
--   finance.accrual_proposals   one candidate per company, month and supplier
--   finance.accrual_comments    the discussion on a proposal; append-only
--   finance.accrual_precedents  each decision and its reason, per client
--   finance.accrual_items       the schedule: one-off and standing items
--   finance.accrual_clearings   the bill that cleared an item's month, and the difference
--   finance.journals            source 'accrual': one row, two Xero drafts
--
-- The rules (proposal checks, cite-or-depart, continuity, the pair, matching)
-- are in finance-api/lib/accruals.js. An agent proposes and comments; only a
-- person with the CFO role decides or approves. finance-api creates DRAFTs only.
--
-- Additive and re-runnable. There is no DELETE grant anywhere here: a proposal
-- is superseded, a precedent ended, an item stopped, never removed.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.accrual_settings (
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- The company's own code (805 Accruals, say). Never a default in code:
  -- a sweep that hard-coded 830 posted 28 journals to Corporation Tax (item 71).
  account_code  text NOT NULL CHECK (length(btrim(account_code)) > 0),
  set_by        text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, entity_id)
);

CREATE TABLE IF NOT EXISTS finance.accrual_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- The month the accrual is for: the service month, accrued at its month end.
  period           text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  supplier         text NOT NULL CHECK (length(btrim(supplier)) > 0),
  contact_id       text,
  test             text NOT NULL CHECK (test IN ('continuity', 'backward', 'gap', 'forward', 'reverse_cutoff')),
  -- [{ account_code, amount, description }]: the cost, Dr, net of VAT. The
  -- credit to the accruals account is added when the pair is made. Empty for
  -- an open question: it is never estimated into a journal.
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  service_from     date,
  service_to       date,
  basis_kind       text NOT NULL CHECK (basis_kind IN ('contract', 'purchase_order', 'last_bill', 'estimate')),
  basis            text NOT NULL CHECK (length(btrim(basis)) > 0),
  -- [{ invoice_id, line, ref, document }]
  evidence         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  confidence       text NOT NULL CHECK (confidence IN ('high', 'medium', 'open')),
  precedent_ids    uuid[] NOT NULL DEFAULT '{}',
  -- Why this month differs from a precedent that applies (cite or depart).
  departs_reason   text,
  -- agent:fm1, claude, or a person's email; the run for an agent.
  proposed_by      text NOT NULL,
  proposed_run_id  uuid,
  decision         text NOT NULL DEFAULT 'pending'
                     CHECK (decision IN ('pending', 'accept', 'accept_edited', 'no_accrual', 'question', 'standing', 'superseded')),
  decision_reason  text,
  applies_to       text CHECK (applies_to IS NULL OR applies_to IN ('this_month', 'until_changed')),
  decided_by       text,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accrual_open_has_no_amount CHECK (confidence <> 'open' OR jsonb_array_length(lines) = 0),
  CONSTRAINT accrual_no_accrual_has_reason CHECK (decision <> 'no_accrual' OR length(btrim(coalesce(decision_reason, ''))) > 0),
  CONSTRAINT accrual_service_order CHECK (service_from IS NULL OR service_to IS NULL OR service_to >= service_from)
);

-- One open proposal per company, month and supplier: a second one is a reply
-- on the first, or the first is superseded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accrual_proposals_open
  ON finance.accrual_proposals (entity_id, period, lower(btrim(supplier)))
  WHERE decision IN ('pending', 'question');
CREATE INDEX IF NOT EXISTS idx_accrual_proposals_client_period ON finance.accrual_proposals (client_id, period);

CREATE TABLE IF NOT EXISTS finance.accrual_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL REFERENCES finance.accrual_proposals (id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  -- A person's email, agent:fm1, agent:fc or claude.
  author       text NOT NULL,
  -- The FC or the CFO challenging the proposal, as distinct from a reply.
  challenge    boolean NOT NULL DEFAULT false,
  body         text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  run_id       uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accrual_comments_proposal ON finance.accrual_comments (proposal_id, created_at);

CREATE TABLE IF NOT EXISTS finance.accrual_precedents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- Null for a precedent loaded from before os.stza.io (the back-load).
  proposal_id  uuid REFERENCES finance.accrual_proposals (id),
  supplier     text NOT NULL,
  contact_id   text,
  test         text,
  decision     text NOT NULL CHECK (decision IN ('accept', 'accept_edited', 'no_accrual', 'standing')),
  -- The CFO's words.
  reason       text,
  -- this_month binds only its own month; until_changed binds until ended.
  applies_to   text NOT NULL DEFAULT 'this_month' CHECK (applies_to IN ('this_month', 'until_changed')),
  period       text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- What it rested on: { service_month, amount, basis_kind }
  facts        jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by   text NOT NULL,
  decided_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  ended_by     text,
  -- The draft it went into when promoted to a client rule (finance.client_procedures).
  promoted_rule_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accrual_precedents_client ON finance.accrual_precedents (client_id, entity_id);

CREATE TABLE IF NOT EXISTS finance.accrual_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  proposal_id      uuid REFERENCES finance.accrual_proposals (id),
  supplier         text NOT NULL CHECK (length(btrim(supplier)) > 0),
  contact_id       text,
  -- [{ account_code, amount, description }], Dr, net of VAT: one month's accrual.
  lines            jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  -- The first (for a one-off, the only) month accrued.
  period_from      text NOT NULL CHECK (period_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  standing         boolean NOT NULL DEFAULT false,
  end_period       text CHECK (end_period IS NULL OR end_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Not accrued from this month on: the CFO stopped it, with a reason.
  stopped_period   text CHECK (stopped_period IS NULL OR stopped_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  stopped_by       text,
  stopped_reason   text,
  -- How many months after the service the bill is dated (a monthly fee billed on the 1st of the next month: 1).
  bill_lag_months  integer NOT NULL DEFAULT 1 CHECK (bill_lag_months BETWEEN 0 AND 3),
  basis_kind       text,
  basis            text,
  service_from     date,
  service_to       date,
  expected_clearing text,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accrual_item_end_after_start CHECK (end_period IS NULL OR end_period >= period_from),
  CONSTRAINT accrual_one_off_has_no_end CHECK (standing OR end_period IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_accrual_items_client ON finance.accrual_items (client_id, entity_id);

CREATE TABLE IF NOT EXISTS finance.accrual_clearings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES finance.accrual_items (id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  -- The service month the bill cleared.
  period       text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  bill_id      text NOT NULL,
  bill_number  text,
  bill_date    date NOT NULL,
  bill_net     numeric(14,2) NOT NULL,
  -- Bill net less the accrual: positive when the accrual was under the bill.
  difference   numeric(14,2) NOT NULL,
  matched_by   text NOT NULL,
  matched_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, period)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accrual_clearings_bill ON finance.accrual_clearings (client_id, bill_id);

-- ── The journal pair ────────────────────────────────────────────────────────
--
-- One register row, two Xero drafts. The accrual leg keeps the register's own
-- columns and key (journal-<id>-<attempts>); the reversal has its own attempt
-- counter and key (journal-<id>-<reversal_attempts>-reversal), so a refused
-- reversal is tried again without ever making the accrual twice.

ALTER TABLE finance.journals
  ADD COLUMN IF NOT EXISTS accrual_item_id       uuid REFERENCES finance.accrual_items (id),
  ADD COLUMN IF NOT EXISTS reversal_date         date,
  ADD COLUMN IF NOT EXISTS reversal_attempts     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reversal_xero_journal_id text,
  ADD COLUMN IF NOT EXISTS reversal_xero_journal_no text,
  ADD COLUMN IF NOT EXISTS reversal_xero_status  text,
  ADD COLUMN IF NOT EXISTS reversal_drafted_at   timestamptz,
  -- A backfill into its own month (smoothing), never a catch-up.
  ADD COLUMN IF NOT EXISTS backfill              boolean NOT NULL DEFAULT false;

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journals_source_check;
ALTER TABLE finance.journals ADD CONSTRAINT journals_source_check CHECK (source IN ('person', 'agent', 'schedule', 'vat', 'accrual'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_accrual_is_pair') THEN
    ALTER TABLE finance.journals ADD CONSTRAINT journal_accrual_is_pair
      CHECK (source <> 'accrual' OR (accrual_item_id IS NOT NULL AND reversal_date IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_reversal_on_the_first') THEN
    ALTER TABLE finance.journals ADD CONSTRAINT journal_reversal_on_the_first
      CHECK (reversal_date IS NULL OR (reversal_date = journal_date + 1 AND extract(day FROM reversal_date) = 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_reversal_attempts_positive') THEN
    ALTER TABLE finance.journals ADD CONSTRAINT journal_reversal_attempts_positive CHECK (reversal_attempts >= 1);
  END IF;
END $$;

-- One live pair per item and month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_accrual_pair
  ON finance.journals (accrual_item_id, period)
  WHERE source = 'accrual' AND state IN ('proposed', 'approved', 'draft_created', 'posted');

COMMENT ON TABLE finance.accrual_proposals IS
  'Accrual candidates from FM1, a person or Claude, decided by the CFO in os.stza.io (docs/accruals-spec.md).';
COMMENT ON TABLE finance.accrual_precedents IS
  'The CFO''s accrual decisions, per client, read by that client''s agents only.';

GRANT SELECT, INSERT, UPDATE ON finance.accrual_settings TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.accrual_proposals TO africastn_app;
-- Append-only: no UPDATE.
GRANT SELECT, INSERT ON finance.accrual_comments TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.accrual_precedents TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.accrual_items TO africastn_app;
GRANT SELECT, INSERT ON finance.accrual_clearings TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.journals TO africastn_app;
