-- 047-contracts.sql
--
-- Contracts (Nik, 15 Nov 2026): what each company of a client has agreed to
-- sell and to buy, in one register per client. A customer contract carries
-- how it becomes revenue (its pattern), its payment schedule and milestones,
-- and what it holds on the balance sheet (deferred income), which the
-- Deferred income reconciliation reads as its evidence. A supplier contract
-- carries its renewal and notice dates, which raise Work tasks.
--
--   finance.contracts            one contract, of one company of one client
--   finance.contract_schedule    its payment instalments and milestones
--   finance.contract_movements   what it put on and took off a balance sheet
--                                account: billed into deferred income, released
--   finance.contract_uploads     a contract PDF, held only until it has been
--                                read; then its contents are deleted and the
--                                name, fingerprint and the terms read stay
--
-- Every row carries its client, and every read and write in finance-api is by
-- client and id together: one client's contracts are never reachable from
-- another's pages, people or agents (Nik, 15 Nov 2026: ring-fenced per client).
--
-- The register holds FINANCE terms only (amounts, dates, renewal, payment
-- triggers). It is not a legal review of a contract.
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it; until
-- then finance-api answers its routes with migration_missing. No DELETE grant:
-- a contract is ended or cancelled, never removed.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.contract_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  file_name     text NOT NULL CHECK (length(btrim(file_name)) > 0),
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- The file, until it is read. Null once cleared.
  bytes         bytea,
  bytes_cleared_at timestamptz,
  uploaded_by   text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  -- waiting: stored; reading; read: terms taken out (proposed); failed: see
  -- read_error; added: a contract was made from it; dismissed: not a contract.
  read_state    text NOT NULL DEFAULT 'waiting'
                  CHECK (read_state IN ('waiting', 'reading', 'read', 'failed', 'added', 'dismissed')),
  read_error    text,
  read_at       timestamptz,
  read_by       text,
  read_with     text,
  -- The terms as read, for the person to check and confirm (lib/contracts.js parseRead).
  proposed      jsonb,
  contract_id   uuid,
  UNIQUE (client_id, sha256),
  CONSTRAINT contract_upload_bytes_until_read CHECK (bytes IS NOT NULL OR bytes_cleared_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS finance.contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- customer: the company sells; supplier: the company buys.
  side            text NOT NULL CHECK (side IN ('customer', 'supplier')),
  counterparty    text NOT NULL CHECK (length(btrim(counterparty)) > 0),
  title           text,
  reference       text,
  -- How it becomes revenue or cost (lib/contracts.js PATTERNS).
  pattern         text NOT NULL,
  pattern_confirmed_by text,
  pattern_confirmed_at timestamptz,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  currency        text NOT NULL DEFAULT 'GBP' CHECK (currency ~ '^[A-Z]{3}$'),
  total_value     numeric(14,2) CHECK (total_value IS NULL OR total_value >= 0),
  start_date      date,
  end_date        date,
  -- no: ends; auto: renews itself unless notice is given; option: may be renewed.
  renewal         text NOT NULL DEFAULT 'no' CHECK (renewal IN ('no', 'auto', 'option')),
  notice_days     integer CHECK (notice_days IS NULL OR (notice_days >= 0 AND notice_days <= 3650)),
  payment_terms   text,
  -- The balance sheet account it holds money in (deferred income, prepayments), by Xero code.
  account_code    text,
  notes           text,
  source          text NOT NULL CHECK (source IN ('person', 'upload')),
  upload_id       uuid REFERENCES finance.contract_uploads (id) ON DELETE SET NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ended_by        text,
  ended_at        timestamptz,
  end_reason      text,
  CONSTRAINT contract_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_finance_contracts_client ON finance.contracts (client_id, status);

CREATE TABLE IF NOT EXISTS finance.contract_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES finance.contracts (id) ON DELETE CASCADE,
  -- payment: money due under it; milestone: something to be delivered.
  kind          text NOT NULL CHECK (kind IN ('payment', 'milestone')),
  seq           integer NOT NULL DEFAULT 1 CHECK (seq > 0),
  label         text NOT NULL CHECK (length(btrim(label)) > 0),
  -- What makes it due, as the contract words it ("on installation").
  trigger_text  text,
  amount        numeric(14,2) CHECK (amount IS NULL OR amount >= 0),
  due_on        date,
  -- When there is no date yet: "early 2027".
  expected      text,
  -- pending; met: a milestone delivered, or a payment received in full.
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'met', 'cancelled')),
  received_amount numeric(14,2) CHECK (received_amount IS NULL OR received_amount >= 0),
  received_on   date,
  evidence      text,
  note          text,
  updated_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_milestone_met_has_evidence CHECK (kind <> 'milestone' OR status <> 'met' OR length(btrim(coalesce(evidence, ''))) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_finance_contract_schedule ON finance.contract_schedule (contract_id, kind, seq);

CREATE TABLE IF NOT EXISTS finance.contract_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES finance.contracts (id) ON DELETE CASCADE,
  -- billed: invoiced into the account (held); released: taken out to revenue or cost.
  kind          text NOT NULL CHECK (kind IN ('billed', 'released')),
  on_date       date NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  -- The invoice number or journal that did it.
  ref           text,
  note          text,
  added_by      text NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  withdrawn_by  text
);

CREATE INDEX IF NOT EXISTS idx_finance_contract_movements ON finance.contract_movements (contract_id) WHERE withdrawn_at IS NULL;

-- The Deferred income reconciliation fetches its evidence from this register:
-- finance.rec_evidence.method gains 'contracts' (043 set the list).
ALTER TABLE finance.rec_evidence DROP CONSTRAINT IF EXISTS rec_evidence_method_check;
ALTER TABLE finance.rec_evidence ADD CONSTRAINT rec_evidence_method_check
  CHECK (method IS NULL OR method IN ('ageing_ar', 'ageing_ap', 'counterpart', 'carry_forward', 'statement', 'contracts'));

COMMENT ON TABLE finance.contracts IS
  'Contracts a client''s companies have agreed, both sides: pattern, terms, renewal. Finance terms only, not a legal review.';
COMMENT ON TABLE finance.contract_movements IS
  'What a contract put on (billed) and took off (released) its balance sheet account; the Deferred income reconciliation''s evidence.';

GRANT SELECT, INSERT, UPDATE ON finance.contract_uploads TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.contracts TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.contract_schedule TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.contract_movements TO africastn_app;
