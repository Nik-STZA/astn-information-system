-- 043-rec-reconciling-items.sql
--
-- Bank reconciliations worked on the platform (11 Nov 2026). Until now a bank
-- rec held one figure per company (the statement balance) and either tied to
-- the ledger or did not. Now:
--
--   finance.rec_statements        the bank's own export read for a rec, one per
--                                 company: what it said at the month end, and
--                                 the last day it agreed with Xero. The file
--                                 itself is not kept (Nik, 10 Nov 2026: the
--                                 original lives with the client); its name and
--                                 sha256 are.
--   finance.rec_reconciling_items what stands between the statement and the
--                                 ledger: on the statement but not in Xero, or
--                                 in Xero but not on the statement. Statement
--                                 balance + in Xero only - on the statement
--                                 only = the ledger. Found by matching the
--                                 statement to Xero, or keyed by a person or
--                                 FM1. Open until cleared.
--   finance.rec_evidence.method   gains 'statement': the balance read from an
--                                 uploaded statement.
--
-- Additive and re-runnable. Apply BEFORE merging the code that uses it; until
-- then the rec page shows no reconciling items and the upload answers 503.

SET lock_timeout = '10s';

ALTER TABLE finance.rec_evidence DROP CONSTRAINT IF EXISTS rec_evidence_method_check;
ALTER TABLE finance.rec_evidence ADD CONSTRAINT rec_evidence_method_check
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward', 'statement'));

CREATE TABLE IF NOT EXISTS finance.rec_statements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rec_id            uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  entity_id         uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  file_name         text NOT NULL,
  sha256            text NOT NULL,
  first_date        date,
  last_date         date,
  line_count        integer NOT NULL DEFAULT 0,
  balance_at_end    numeric(14,2),
  agreed_on         date,
  agreed_balance    numeric(14,2),
  matched           integer NOT NULL DEFAULT 0,
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by       text NOT NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rec_id, entity_id)
);

CREATE TABLE IF NOT EXISTS finance.rec_reconciling_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rec_id          uuid NOT NULL REFERENCES finance.recs (id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  side            text NOT NULL CHECK (side IN ('bank_only', 'xero_only')),
  kind            text NOT NULL CHECK (kind IN ('timing', 'unreconciled', 'error', 'query')),
  txn_date        date,
  description     text,
  amount          numeric(14,2) NOT NULL,
  statement_row   integer,
  xero_ref        text,
  source          text NOT NULL CHECK (source IN ('statement', 'keyed')),
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'cleared')),
  note            text,
  added_by        text NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  edited_by       text,
  edited_at       timestamptz,
  cleared_by      text,
  cleared_at      timestamptz,
  cleared_note    text
);

CREATE INDEX IF NOT EXISTS rec_reconciling_items_rec ON finance.rec_reconciling_items (rec_id, entity_id);

COMMENT ON TABLE finance.rec_reconciling_items IS
  'Between a statement and the ledger. amount: money into the account positive. Statement + xero_only - bank_only = ledger, while open.';
COMMENT ON COLUMN finance.rec_reconciling_items.kind IS
  'timing: through the bank after the month end (may stay open at sign-off). unreconciled: on the statement, not yet in Xero. error: needs fixing in Xero. query: for the client to explain.';

GRANT SELECT, INSERT, UPDATE, DELETE ON finance.rec_statements, finance.rec_reconciling_items TO africastn_app;
