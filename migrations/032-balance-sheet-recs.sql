-- 032-balance-sheet-recs.sql
--
-- Balance sheet reconciliations in os.stza.io. A reconciliation is at GROUP
-- level: one record for a GL account across the client's companies, with each
-- company's ledger, support, difference and comment beneath it.
--
--   finance.rec_accounts        the client's GL accounts that need a rec, kept
--                               across months: name, matrix line, how proved
--   finance.recs                one account for one month: status, who has it,
--                               and what was seen when it was prepared
--   finance.rec_balances        each company's figures for that rec
--   finance.rec_periods         when a month's list was last read from the
--                               trial balance, and what could not be read
--   finance.rec_schedule_items  the schedule behind an account, by company.
--                               Lives here, not in a spreadsheet
--   finance.rec_evidence        support for the other two proofs: outside
--                               evidence and ledger review
--   finance.rec_journals        journals an agent proposed, and what became of them
--   finance.rec_events          append-only history
--
-- The matrix sets Owner, Challenge, Class (M or J) and the artefact: they are
-- copied onto each rec from finance-api lib/bs-matrix.js when the list is
-- composed. No route lets an agent write them.
--
-- Release amounts are not stored. They are worked out from each item
-- (lib/recs.js); what was shown when a rec was prepared is kept on the rec.
--
-- Additive and re-runnable. Run it as the owner of finance.client_finance_config
-- and finance.agent_runs, which it alters; the grants at the end are what the
-- app role needs on the new tables, as it owns none of them.

-- Give up rather than queue behind live traffic: the two ALTERs take a brief
-- exclusive lock on tables the running service uses.
SET lock_timeout = '10s';

ALTER TABLE finance.client_finance_config
  ADD COLUMN IF NOT EXISTS rec_tolerance numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN finance.client_finance_config.rec_tolerance IS
  'Rounding tolerance per company for a balance sheet reconciliation: a difference at or under this ties. Nil until a client rule sets it, so every variance is reported.';

-- The rec a run was started on. Not a foreign key: a finished run cannot be
-- updated, so it could not follow a rec being removed.
ALTER TABLE finance.agent_runs ADD COLUMN IF NOT EXISTS rec_id uuid;

CREATE TABLE IF NOT EXISTS finance.rec_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  -- Class and account name, reduced to letters and digits. Companies in a group
  -- can number the same account differently, so the name joins them, not the
  -- code. A bank account never joins: each is keyed on its own Xero account id.
  account_key   text NOT NULL CHECK (length(account_key) > 0),
  account_name  text NOT NULL,
  -- A line of the balance sheet matrix, or null while no one has placed it.
  line_key      text,
  proof         text NOT NULL DEFAULT 'ledger_review'
                  CHECK (proof IN ('schedule', 'outside_evidence', 'ledger_review')),
  placed_by     text,
  placed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, account_key)
);

CREATE TABLE IF NOT EXISTS finance.rec_periods (
  client_id      uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  period         text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  composed_at    timestamptz NOT NULL DEFAULT now(),
  composed_by    text NOT NULL,
  -- Companies whose trial balance could not be read: the list is then not
  -- complete, and says so.
  entity_errors  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What a person should know about the read, in words.
  notes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (client_id, period)
);

CREATE TABLE IF NOT EXISTS finance.recs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  rec_account_id     uuid NOT NULL REFERENCES finance.rec_accounts (id) ON DELETE CASCADE,
  period             text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  period_end         date NOT NULL,
  status             text NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('not_started', 'in_progress', 'with_fc', 'with_cfo', 'signed_off', 'sent_back')),
  -- From the matrix, never from an agent.
  owner              text,
  challenge          text,
  class              text CHECK (class IN ('M', 'J')),
  artefact           text,
  proof              text NOT NULL CHECK (proof IN ('schedule', 'outside_evidence', 'ledger_review')),
  preparer_note      text,
  review_note        text,
  -- What the preparer saw: each company's opening and closing, and the schedule.
  prepared_snapshot  jsonb,
  -- prepared_by is who did it (agent:fm1). _person is who answers for it: the
  -- person, or the one who started the agent.
  prepared_by        text,
  prepared_by_person text,
  prepared_at        timestamptz,
  reviewed_by        text,
  reviewed_by_person text,
  reviewed_at        timestamptz,
  signed_off_by      text,
  signed_off_role    text,
  signed_off_at      timestamptz,
  -- One person acted in more than one seat, which is normal in a small practice
  -- but must be on the record and on the screen.
  sole_reviewer      boolean NOT NULL DEFAULT false,
  -- The figures as signed. Screens show these from then on; the ledger read
  -- carries on in rec_balances, which is how a later move is noticed.
  signed_snapshot    jsonb,
  -- Set when a figure moved after preparation. Cleared by preparing it again.
  recheck_reason     text,
  recheck_at         timestamptz,
  -- The last run of the checks (lib/recs.js journalChecks).
  checks             jsonb,
  checks_at          timestamptz,
  -- No longer on the trial balance for this month, after a correction. Kept for
  -- its history when work had started on it.
  dropped_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rec_account_id, period)
);

CREATE INDEX IF NOT EXISTS idx_finance_recs_client_period ON finance.recs (client_id, period);

CREATE TABLE IF NOT EXISTS finance.rec_balances (
  rec_id        uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  account_code  text,
  account_name  text NOT NULL,
  -- The company's base currency in Xero.
  currency      text,
  -- Signed debit minus credit, from Xero's trial balance.
  opening       numeric(14,2) NOT NULL DEFAULT 0,
  closing       numeric(14,2) NOT NULL DEFAULT 0,
  movement      numeric(14,2) NOT NULL DEFAULT 0,
  comment       text,
  read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rec_id, entity_id)
);

CREATE TABLE IF NOT EXISTS finance.rec_schedule_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  rec_account_id   uuid NOT NULL REFERENCES finance.rec_accounts (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  item_no          integer NOT NULL DEFAULT 0,
  supplier         text NOT NULL CHECK (length(btrim(supplier)) > 0),
  description      text,
  pl_account_code  text NOT NULL,
  invoice_ref      text,
  invoice_date     date,
  total_cost       numeric(14,2) NOT NULL,
  service_start    date,
  service_end      date,
  amort_commenced  date,
  -- amortise: released monthly. held: stays on the balance sheet until ended.
  treatment        text NOT NULL DEFAULT 'amortise' CHECK (treatment IN ('amortise', 'held')),
  -- Taken off the schedule from this month: reclassified, refunded or written off.
  ended_period     text CHECK (ended_period IS NULL OR ended_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  document_ref     text,
  note             text,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       text,
  CONSTRAINT rec_item_amortise_dates CHECK (
    treatment <> 'amortise' OR (service_start IS NOT NULL AND service_end IS NOT NULL
      AND amort_commenced IS NOT NULL AND service_end >= service_start)
  )
);

CREATE INDEX IF NOT EXISTS idx_finance_rec_items_account ON finance.rec_schedule_items (rec_account_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS finance.rec_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rec_id        uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('outside_evidence', 'ledger_review')),
  amount        numeric(14,2),
  source        text,
  document_ref  text,
  note          text,
  added_by      text NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.rec_journals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  rec_id           uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  state            text NOT NULL DEFAULT 'proposed'
                     CHECK (state IN ('proposed', 'approved', 'draft_created', 'rejected', 'superseded')),
  journal_date     date NOT NULL,
  narration        text NOT NULL,
  -- [{ account_code, description, amount }], debits positive, credits negative.
  lines            jsonb NOT NULL,
  -- Why, for the screen. Stays here and never goes to Xero.
  reason           text,
  proposed_by      text NOT NULL,
  -- The run whose answer showed this journal: the follow-up hangs from it.
  proposed_run_id  uuid NOT NULL,
  approved_by      text,
  approved_at      timestamptz,
  -- The follow-up run that may create exactly this journal, and no other.
  approved_run_id  uuid UNIQUE,
  -- Part of the Xero idempotency key. Moves on only after Xero definitely refused.
  attempts         integer NOT NULL DEFAULT 1,
  rejected_by      text,
  rejected_at      timestamptz,
  xero_journal_id  text,
  xero_journal_no  text,
  drafted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_rec_journals_rec ON finance.rec_journals (rec_id);

-- One live proposal per rec and company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_rec_journals_live
  ON finance.rec_journals (rec_id, entity_id) WHERE state IN ('proposed', 'approved');

CREATE TABLE IF NOT EXISTS finance.rec_events (
  id         bigserial PRIMARY KEY,
  rec_id     uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_finance_rec_events_rec ON finance.rec_events (rec_id, at DESC);

COMMENT ON TABLE finance.recs IS
  'A balance sheet reconciliation: one GL account for one month, across the client''s companies. Group level by design.';

GRANT SELECT, INSERT, UPDATE, DELETE ON
  finance.rec_accounts, finance.rec_periods, finance.recs, finance.rec_balances,
  finance.rec_schedule_items, finance.rec_evidence, finance.rec_journals
  TO africastn_app;
-- History is added to, never changed.
GRANT SELECT, INSERT ON finance.rec_events TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE finance.rec_events_id_seq TO africastn_app;
