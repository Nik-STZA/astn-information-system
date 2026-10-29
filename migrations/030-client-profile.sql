-- 030-client-profile.sql
--
-- The client profile (Nik, 29 Oct 2026): the group and the companies in it,
-- with the facts an agent needs to choose a treatment.
--
--   finance.entities      each company: registration, address, country of
--                         incorporation, its parent and the share held, VAT
--                         number, whether it is in the group's VAT group, and
--                         the reporting standard it reports under. A company
--                         need not be connected to Xero to be on the profile.
--   shared.clients        the group's VAT group registration: on or off, its
--                         number, and the representative member.
--
-- Changes are made by a person in os.stza.io and logged to shared.client_events
-- (finance-api lib/profile.js holds the rules). Additive and re-runnable.

ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS company_number            text;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS registered_address        text;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS country_of_incorporation  text;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS parent_id                 uuid REFERENCES finance.entities (id) ON DELETE SET NULL;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS ownership_pct             numeric(6,3);
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS vat_number                text;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS in_vat_group              boolean NOT NULL DEFAULT false;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS reporting_framework       text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_country_check' AND conrelid = 'finance.entities'::regclass) THEN
    ALTER TABLE finance.entities ADD CONSTRAINT entities_country_check
      CHECK (country_of_incorporation IS NULL OR country_of_incorporation ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_framework_check' AND conrelid = 'finance.entities'::regclass) THEN
    ALTER TABLE finance.entities ADD CONSTRAINT entities_framework_check
      CHECK (reporting_framework IS NULL OR reporting_framework IN
        ('FRS 105', 'FRS 102 Section 1A', 'FRS 102', 'IFRS', 'IFRS for SMEs', 'US GAAP', 'Other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_ownership_check' AND conrelid = 'finance.entities'::regclass) THEN
    ALTER TABLE finance.entities ADD CONSTRAINT entities_ownership_check
      CHECK (ownership_pct IS NULL OR (ownership_pct > 0 AND ownership_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_not_own_parent' AND conrelid = 'finance.entities'::regclass) THEN
    ALTER TABLE finance.entities ADD CONSTRAINT entities_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

COMMENT ON COLUMN finance.entities.parent_id IS 'The company that owns this one, within the same client. Null for the group parent.';
COMMENT ON COLUMN finance.entities.reporting_framework IS 'The standard the company reports under. Agents read it to choose a treatment.';
COMMENT ON COLUMN finance.entities.in_vat_group IS 'Member of the client''s VAT group (shared.clients.vat_group).';

ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS vat_group                      boolean NOT NULL DEFAULT false;
ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS vat_group_number               text;
ALTER TABLE shared.clients ADD COLUMN IF NOT EXISTS vat_group_representative_id    uuid REFERENCES finance.entities (id) ON DELETE SET NULL;

COMMENT ON COLUMN shared.clients.vat_group IS 'The group is registered for VAT as a group; member companies are ticked on finance.entities.in_vat_group.';
