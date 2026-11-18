-- 058: VAT returns and VAT group clearing (CFO build spec, 17 Nov 2026).
--
-- Xero's API does not expose UK VAT returns, so each company's return is
-- exported from Xero and uploaded; scripts parse it, build the group return
-- and the import file, propose the clearing journals and match HMRC's
-- payments; the CFO approves. Nothing is written to a VAT return in Xero.
--
--   vat_registrations          one per VAT registration: single or group
--   vat_registration_members   the companies on it, effective dated
--   vat_stagger                return frequency, effective dated
--   vat_ic_pairs               a member's intercompany account with the
--                              representative, both sides
--   vat_returns                one per registration and period
--   vat_return_uploads         every file uploaded, with its hash
--   vat_return_figures         boxes 1-9 per return and company, as parsed
--   vat_return_lines           the Transactions by VAT Box rows
--   vat_imports                every import file generated, and its check
--   vat_payments               HMRC receipts or payments matched to a return
--   vat_adjustment_reasons     the reason and evidence for each adjustment
--                              with no accounting transaction, accepted by
--                              the CFO
--
-- Rows end by state: the application role has no DELETE. Amounts
-- numeric(14,2). Journals gain the source 'vat' (clearing journals).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS finance.vat_registrations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  vat_number             text NOT NULL CHECK (vat_number ~ '^[0-9]{9}([0-9]{3})?$'),
  kind                   text NOT NULL CHECK (kind IN ('single', 'group')),
  representative_id      uuid REFERENCES finance.entities (id),
  -- Where the group return's workbook is saved on the client's drive, as
  -- path parts with {fy} and {period} (pack-engine/profiles output style).
  export_path            jsonb NOT NULL DEFAULT '["VAT", "FY{fy}", "{period}"]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  ended_at               timestamptz,
  CONSTRAINT vat_group_has_representative CHECK (kind = 'single' OR representative_id IS NOT NULL),
  UNIQUE (client_id, vat_number)
);

CREATE TABLE IF NOT EXISTS finance.vat_registration_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL REFERENCES finance.vat_registrations (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id),
  effective_from   date NOT NULL,
  effective_to     date,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (registration_id, entity_id, effective_from)
);

CREATE TABLE IF NOT EXISTS finance.vat_stagger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL REFERENCES finance.vat_registrations (id) ON DELETE CASCADE,
  effective_from   date NOT NULL,
  effective_to     date,
  -- monthly, quarterly (with the quarter-end months), or a one-off bridging period
  frequency        text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'bridge')),
  quarter_end_months int[] CHECK (quarter_end_months IS NULL OR array_length(quarter_end_months, 1) = 4),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (registration_id, effective_from)
);

CREATE TABLE IF NOT EXISTS finance.vat_ic_pairs (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id              uuid NOT NULL REFERENCES finance.vat_registrations (id) ON DELETE CASCADE,
  member_entity_id             uuid NOT NULL REFERENCES finance.entities (id),
  member_account_code          text NOT NULL,
  representative_account_code  text NOT NULL,
  effective_from               date NOT NULL,
  effective_to                 date,
  UNIQUE (registration_id, member_entity_id, effective_from)
);

CREATE TABLE IF NOT EXISTS finance.vat_returns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES finance.vat_registrations (id),
  period_start     date NOT NULL,
  period_end       date NOT NULL CHECK (period_end >= period_start),
  status           text NOT NULL DEFAULT 'building' CHECK (status IN
                     ('building', 'import_ready', 'import_confirmed', 'submitted', 'paid', 'part_paid', 'outstanding')),
  submitted_on     date,
  hmrc_receipt_ref text,
  -- Boxes 1-9 as submitted: fixed once the return is submitted.
  submitted_boxes  jsonb,
  signed_by        text,
  signed_at        timestamptz,
  history_note     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS finance.vat_return_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES finance.vat_returns (id) ON DELETE CASCADE,
  entity_id     uuid REFERENCES finance.entities (id),
  kind          text NOT NULL CHECK (kind IN ('member_export', 'representative_pre_import', 'representative_post_import', 'hmrc_receipt')),
  file_name     text NOT NULL,
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  stored_ref    text,
  parsed        jsonb,
  superseded_at timestamptz,
  uploaded_by   text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vat_return_uploads_return ON finance.vat_return_uploads (return_id, entity_id);

CREATE TABLE IF NOT EXISTS finance.vat_return_figures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL REFERENCES finance.vat_returns (id) ON DELETE CASCADE,
  upload_id   uuid NOT NULL REFERENCES finance.vat_return_uploads (id),
  entity_id   uuid REFERENCES finance.entities (id),
  box         int NOT NULL CHECK (box BETWEEN 1 AND 9),
  amount      numeric(14,2) NOT NULL,
  UNIQUE (upload_id, box)
);

CREATE TABLE IF NOT EXISTS finance.vat_return_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid NOT NULL REFERENCES finance.vat_returns (id) ON DELETE CASCADE,
  upload_id    uuid NOT NULL REFERENCES finance.vat_return_uploads (id),
  entity_id    uuid REFERENCES finance.entities (id),
  box          int NOT NULL CHECK (box BETWEEN 1 AND 9),
  section      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('standard', 'late', 'adjusted', 'late_adjusted', 'no_transaction', 'imported')),
  reverse_charge boolean NOT NULL DEFAULT false,
  line_date    date,
  account      text,
  account_code text,
  reference    text,
  details      text,
  vat          numeric(14,2),
  net          numeric(14,2),
  created_on   date
);
CREATE INDEX IF NOT EXISTS vat_return_lines_return ON finance.vat_return_lines (return_id, entity_id, box);

CREATE TABLE IF NOT EXISTS finance.vat_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid NOT NULL REFERENCES finance.vat_returns (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('group', 'correction', 'reset')),
  boxes          jsonb NOT NULL,
  generated_by   text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_by_upload_id uuid REFERENCES finance.vat_return_uploads (id),
  confirmed_at   timestamptz
);

CREATE TABLE IF NOT EXISTS finance.vat_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id            uuid NOT NULL REFERENCES finance.vat_returns (id) ON DELETE CASCADE,
  xero_bank_txn_id     text,
  paid_on              date NOT NULL,
  amount               numeric(14,2) NOT NULL,
  difference           numeric(14,2) NOT NULL DEFAULT 0,
  -- HMRC can set a repayment off against another tax debt.
  set_off_reason       text,
  matched_by           text NOT NULL,
  matched_at           timestamptz NOT NULL DEFAULT now(),
  withdrawn_at         timestamptz
);

CREATE TABLE IF NOT EXISTS finance.vat_adjustment_reasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id       uuid NOT NULL REFERENCES finance.vat_return_lines (id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  evidence_ref  text,
  accepted_by   text,
  accepted_at   timestamptz,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Clearing journals go to the Journals page with their own source.
ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journals_source_check;
ALTER TABLE finance.journals ADD CONSTRAINT journals_source_check CHECK (source IN ('person', 'agent', 'schedule', 'vat'));

-- Seed a registration from the client profile's VAT group (migration 030),
-- where one is recorded and no registration exists yet: members from the
-- companies ticked in_vat_group, effective from the start of 2026. The CFO
-- corrects dates, stagger and intercompany pairs in Settings.
INSERT INTO finance.vat_registrations (client_id, vat_number, kind, representative_id, created_by)
SELECT c.id, regexp_replace(c.vat_group_number, '[^0-9]', '', 'g'), 'group', c.vat_group_representative_id, 'migration 058'
  FROM shared.clients c
 WHERE c.vat_group AND c.vat_group_number IS NOT NULL AND c.vat_group_representative_id IS NOT NULL
   AND regexp_replace(c.vat_group_number, '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
   AND NOT EXISTS (SELECT 1 FROM finance.vat_registrations r WHERE r.client_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO finance.vat_registration_members (registration_id, entity_id, effective_from)
SELECT r.id, e.id, DATE '2026-01-01'
  FROM finance.vat_registrations r
  JOIN finance.entities e ON e.client_id = r.client_id AND e.in_vat_group AND e.retired_at IS NULL
 WHERE r.created_by = 'migration 058'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'africastn_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finance.vat_registrations, finance.vat_registration_members, finance.vat_stagger,
      finance.vat_ic_pairs, finance.vat_returns, finance.vat_return_uploads, finance.vat_return_figures,
      finance.vat_return_lines, finance.vat_imports, finance.vat_payments, finance.vat_adjustment_reasons TO africastn_app;
  END IF;
END $$;
