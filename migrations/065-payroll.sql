-- 065-payroll.sql
--
-- Payroll from the provider's monthly salary report (lib/payroll.js, 19 Nov
-- 2026). Staff details are never stored: employees are known only by the
-- employee code the payroll provider gives them, with an allow-list of payroll
-- figures. Names, addresses, emails, NI numbers and tax codes stay in the
-- client's own files.
--
--   finance.payroll_settings  per client: the companies, the account for each
--                             journal line, the development projects, and where
--                             the working file goes on the client's drive
--   finance.payroll_roles     each employee code's role: director, direct or
--                             intercompany
--   finance.payroll_runs      one month's report as figures by employee code,
--                             the capitalisation shares the CFO confirmed, and
--                             the working file's place on the drive
--   finance.journals          source 'payroll': the month's journals, proposed
--                             for the CFO on the Journals page
--
-- Additive and re-runnable.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.payroll_settings (
  client_id            uuid PRIMARY KEY REFERENCES shared.clients (id) ON DELETE CASCADE,
  payroll_entity_id    uuid NOT NULL REFERENCES finance.entities (id),
  contracted_entity_id uuid REFERENCES finance.entities (id),
  -- { payroll: { line: code }, contracted: { ... }, capdev: { ... } }: see lib/payroll.js.
  accounts             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(accounts) = 'object'),
  projects             text[] NOT NULL DEFAULT '{}',
  -- The client's shared drive and the folder for a month, e.g.
  -- ["Example Ltd", "Payroll", "{yymm}"]. The provider's export is put there.
  drive_id             text,
  drive_path           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(drive_path) = 'array'),
  updated_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.payroll_roles (
  client_id   uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  emp_code    text NOT NULL CHECK (emp_code ~ '^[A-Za-z0-9_-]{1,20}$'),
  role        text NOT NULL CHECK (role IN ('director', 'direct', 'intercompany')),
  -- No name: the code is how payroll and the platform both know the person.
  set_by      text NOT NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, emp_code)
);

CREATE TABLE IF NOT EXISTS finance.payroll_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  period         text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  pay_date       date NOT NULL,
  -- [{ emp_code, basic, bonus, ee_pension, ee_nic, tax, net_pay, er_nic, er_pension, pay_bill }]
  figures        jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'array'),
  -- Figures the export did not have, taken as nil.
  missing        text[] NOT NULL DEFAULT '{}',
  source_name    text NOT NULL,
  source_sha256  text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  -- { emp_code: { project: percent } }, carried forward and confirmed by the CFO.
  alloc          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(alloc) = 'object'),
  alloc_confirmed_by text,
  alloc_confirmed_at timestamptz,
  -- Where the shares came from, e.g. "development lead, email 4 Nov 2026".
  alloc_note     text CHECK (alloc_note IS NULL OR length(alloc_note) BETWEEN 3 AND 200),
  uploaded_by    text NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  workbook_requested_at timestamptz,
  workbook_requested_by text,
  workbook_file_id      text,
  workbook_name         text,
  workbook_link         text,
  workbook_saved_at     timestamptz,
  workbook_error        text
);
-- One live report per client and month: a new upload replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_live ON finance.payroll_runs (client_id, period) WHERE superseded_at IS NULL;

ALTER TABLE finance.journals
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES finance.payroll_runs (id),
  -- payroll, contracted, capdev, capdev_other: which of the month's journals.
  ADD COLUMN IF NOT EXISTS payroll_kind text;

ALTER TABLE finance.journals DROP CONSTRAINT IF EXISTS journals_source_check;
ALTER TABLE finance.journals ADD CONSTRAINT journals_source_check CHECK (source IN ('person', 'agent', 'schedule', 'vat', 'accrual', 'payroll'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_payroll_has_run') THEN
    ALTER TABLE finance.journals ADD CONSTRAINT journal_payroll_has_run
      CHECK (source <> 'payroll' OR (payroll_run_id IS NOT NULL AND payroll_kind IN ('payroll', 'contracted', 'capdev', 'capdev_other')));
  END IF;
END $$;

-- One live journal of each kind per month's report.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_payroll
  ON finance.journals (payroll_run_id, payroll_kind)
  WHERE source = 'payroll' AND state IN ('proposed', 'approved', 'draft_created', 'posted');

GRANT SELECT, INSERT, UPDATE ON finance.payroll_settings, finance.payroll_roles, finance.payroll_runs TO africastn_app;
GRANT SELECT, INSERT, UPDATE ON finance.journals TO africastn_app;
