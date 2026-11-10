-- 040-outstanding-documents.sql
--
-- Outstanding documents (Nik, 10 Nov 2026): payments and receipts a client has
-- not supported with a document (tax invoice, receipt, contract). Each one is
-- an open item carried month to month in the close and listed in the
-- management pack, with the concern it raises. It never blocks a sign-off;
-- it is cleared when the document arrives or accepted without one.
--
--   finance.document_uploads        a report a person uploaded (bank rec reports,
--                                    a former accountant's query list). The file
--                                    is held only until it has been read; then
--                                    its contents are deleted and the name,
--                                    fingerprint and lines stay. The original
--                                    lives on the client's drive (Nik, 10 Nov)
--   finance.outstanding_documents   one transaction without its document
--
-- finance.client_finance_config.doc_vat_threshold: the gross amount above which
-- input VAT is treated as not recoverable without a valid VAT invoice (25.00).
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it; until
-- then finance-api answers its routes with migration_missing. No DELETE grant:
-- an item is dismissed or closed, never removed.

SET lock_timeout = '10s';

ALTER TABLE finance.client_finance_config
  ADD COLUMN IF NOT EXISTS doc_vat_threshold numeric(10,2) NOT NULL DEFAULT 25
    CHECK (doc_vat_threshold >= 0);

COMMENT ON COLUMN finance.client_finance_config.doc_vat_threshold IS
  'Outstanding documents: a cost above this gross amount (GBP) without a valid VAT invoice is flagged as VAT not recoverable.';

CREATE TABLE IF NOT EXISTS finance.document_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  file_name     text NOT NULL CHECK (length(btrim(file_name)) > 0),
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  -- The same file uploaded twice is one upload, even after its contents are gone.
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- The file, until it is read. Null once cleared.
  bytes         bytea,
  bytes_cleared_at timestamptz,
  uploaded_by   text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  -- waiting: stored, not read yet; read: lines taken out; failed: see read_error.
  read_state    text NOT NULL DEFAULT 'waiting' CHECK (read_state IN ('waiting', 'reading', 'read', 'failed')),
  read_error    text,
  read_at       timestamptz,
  read_by       text,
  -- How it was read: the model and region, or 'sheet' for a spreadsheet read directly.
  read_with     text,
  line_count    integer,
  UNIQUE (client_id, sha256),
  CONSTRAINT document_upload_bytes_until_read CHECK (bytes IS NOT NULL OR bytes_cleared_at IS NOT NULL)
);

COMMENT ON TABLE finance.document_uploads IS
  'Reports uploaded for outstanding documents (bank rec reports, query lists). The file is held until read, then deleted; name, fingerprint and the lines read stay.';

CREATE TABLE IF NOT EXISTS finance.outstanding_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  -- Null while a read line has not been placed in a company.
  entity_id       uuid REFERENCES finance.entities (id) ON DELETE CASCADE,
  bank_account    text,
  txn_date        date NOT NULL,
  payee           text NOT NULL CHECK (length(btrim(payee)) > 0),
  reference       text,
  -- spent: money out (a cost without its invoice); received: money in.
  direction       text NOT NULL DEFAULT 'spent' CHECK (direction IN ('spent', 'received')),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  currency        text NOT NULL DEFAULT 'GBP' CHECK (currency ~ '^[A-Z]{3}$'),
  -- The sterling value, when the line was not in sterling and the report gave it.
  amount_gbp      numeric(14,2) CHECK (amount_gbp IS NULL OR amount_gbp > 0),
  concern         text NOT NULL DEFAULT 'no_vat_invoice'
                    CHECK (concern IN ('no_vat_invoice', 'audit_evidence', 'business_purpose', 'overseas_reverse_charge', 'unknown_payee', 'other')),
  note            text,
  -- candidate: read from an upload, waiting for a person to accept it;
  -- open: on the register; received: the document came; accepted: closed
  -- without a document, with a reason; dismissed: a candidate that was not one.
  state           text NOT NULL DEFAULT 'open'
                    CHECK (state IN ('candidate', 'open', 'received', 'accepted', 'dismissed')),
  -- Where it came from.
  source          text NOT NULL CHECK (source IN ('upload', 'person', 'agent')),
  upload_id       uuid REFERENCES finance.document_uploads (id) ON DELETE SET NULL,
  source_line     text,
  duplicate_of    uuid REFERENCES finance.outstanding_documents (id) ON DELETE SET NULL,
  -- The Xero transaction it was matched to (agents, later).
  xero_type       text,
  xero_id         text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  opened_by       text,
  last_chased_at  date,
  chase_count     integer NOT NULL DEFAULT 0 CHECK (chase_count >= 0),
  closed_at       timestamptz,
  closed_by       text,
  close_reason    text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outstanding_open_has_company CHECK (state IN ('candidate', 'dismissed') OR entity_id IS NOT NULL),
  CONSTRAINT outstanding_accepted_has_reason CHECK (state <> 'accepted' OR length(btrim(coalesce(close_reason, ''))) >= 15)
);

CREATE INDEX IF NOT EXISTS idx_finance_outstanding_client_state ON finance.outstanding_documents (client_id, state);
CREATE INDEX IF NOT EXISTS idx_finance_outstanding_upload ON finance.outstanding_documents (upload_id);

COMMENT ON TABLE finance.outstanding_documents IS
  'Transactions without their supporting document, carried as open items in the close and listed in the management pack. Never blocks a sign-off.';

GRANT SELECT, INSERT, UPDATE ON finance.document_uploads TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.outstanding_documents TO africastn_app;
