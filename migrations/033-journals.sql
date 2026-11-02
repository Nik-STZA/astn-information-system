-- 033-journals.sql
--
-- The Journals register in os.stza.io: month-end journals that are not tied to
-- a balance sheet reconciliation (an accrual, a reclass, the payroll journal, a
-- correction). A rec's own journals stay in finance.rec_journals (migration
-- 032); the Journals page lists both.
--
--   finance.journals   one journal for one company: who proposed it, the CFO's
--                      decision, and what became of it in Xero
--
-- A person or an agent (FM1 or FC, from a run) proposes. Only a person with the
-- CFO role approves, in os.stza.io. finance-api then creates the journal in Xero
-- as a DRAFT, under a key made from the journal's id and its attempt number, so
-- one approval cannot make two drafts. A person posts it in Xero.
--
-- Additive and re-runnable. The grants at the end are what the app role needs;
-- it owns nothing here. There is no DELETE grant: a journal is rejected or
-- superseded, never removed, so the register is the record.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.journals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- The month the journal belongs to. The date must fall in it.
  period           text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  journal_date     date NOT NULL,
  -- Short, because it lands in Xero.
  narration        text NOT NULL CHECK (length(btrim(narration)) > 0),
  -- [{ account_code, description, amount, tax_type }], debits positive, credits
  -- negative, summing to nil. Checked in finance-api (lib/journals.js) before it
  -- is stored, and again by the journal route before Xero is asked.
  lines            jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  -- Why, for the screen. Stays here and never goes to Xero.
  reason           text,
  source           text NOT NULL CHECK (source IN ('person', 'agent')),
  -- An email for a person; agent:fm1 or agent:fc for an agent.
  proposed_by      text NOT NULL,
  -- The run that proposed it, for an agent. Not a foreign key, as on recs.
  proposed_run_id  uuid,
  state            text NOT NULL DEFAULT 'proposed'
                     CHECK (state IN ('proposed', 'approved', 'draft_created', 'posted', 'rejected', 'superseded')),
  approved_by      text,
  approved_at      timestamptz,
  rejected_by      text,
  rejected_at      timestamptz,
  -- The last attempt's outcome was unknown, and the rejecter says they looked
  -- in Xero and the draft is not there.
  rejected_after_check boolean NOT NULL DEFAULT false,
  -- Part of the Xero idempotency key. Moves on only after Xero definitely refused.
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  -- Why the last approval did not reach Xero, in words, for the screen.
  last_error       text,
  xero_journal_id  text,
  xero_journal_no  text,
  -- What Xero last said the journal is (DRAFT, POSTED, VOIDED, DELETED), and when.
  xero_status      text,
  xero_checked_at  timestamptz,
  drafted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_date_in_period CHECK (to_char(journal_date, 'YYYY-MM') = period),
  CONSTRAINT journal_agent_has_run CHECK (source <> 'agent' OR proposed_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_finance_journals_client_period ON finance.journals (client_id, period);
CREATE INDEX IF NOT EXISTS idx_finance_journals_entity_state ON finance.journals (entity_id, state);

COMMENT ON TABLE finance.journals IS
  'Month-end journals not tied to a reconciliation. Proposed by a person or FM1/FC, approved by the CFO in os.stza.io, created in Xero only as a DRAFT.';

GRANT SELECT, INSERT, UPDATE ON finance.journals TO africastn_app;
