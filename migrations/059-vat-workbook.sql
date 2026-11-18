-- 059: the VAT return workbook (CFO, 18 Nov 2026).
--
-- The consolidated workbook the CFO kept by hand: a GROUP sheet (each company,
-- the group and the adjustment, as live formulas) and each company's three
-- Xero tabs, built by the pack engine and saved to the client's shared drive.
--
--   vat_return_uploads.sheets   the export's tabs as uploaded (rows of cell
--                               text), so the workbook carries them as Xero
--                               gave them
--   vat_registrations.drive_id  the client's shared drive; export_path (058)
--                               is the folder path inside it, with {yyyy},
--                               {yymm}, {period} and {fy}
--   vat_registrations.workbook_title  the name the file starts with
--   vat_registration_members.code  the company's short code for its columns
--                               and tabs (UDL); the slug or initials when unset
--   vat_returns.workbook_*      the last save: requested, saved (file id,
--                               name, link) or the error
--
-- Idempotent.

ALTER TABLE finance.vat_return_uploads ADD COLUMN IF NOT EXISTS sheets jsonb;

ALTER TABLE finance.vat_registrations ADD COLUMN IF NOT EXISTS drive_id text
  CHECK (drive_id IS NULL OR drive_id ~ '^[A-Za-z0-9_-]{10,80}$');
ALTER TABLE finance.vat_registrations ADD COLUMN IF NOT EXISTS workbook_title text;

ALTER TABLE finance.vat_registration_members ADD COLUMN IF NOT EXISTS code text
  CHECK (code IS NULL OR code ~ '^[A-Z0-9]{2,6}$');

ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_requested_at timestamptz;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_requested_by text;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_file_id text;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_name text;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_link text;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_saved_at timestamptz;
ALTER TABLE finance.vat_returns ADD COLUMN IF NOT EXISTS workbook_error text;
