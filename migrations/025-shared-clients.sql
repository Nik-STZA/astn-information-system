-- 025-shared-clients.sql
--
-- Creates shared.clients, the cross-module client entity described in portal
-- spec section 15.3. Each module attaches its own client config in its own
-- schema and never reads another module's config table.
--
-- Context on the seam. The platform already has public.compliance_clients,
-- which is the compliance module's own record and carries compliance-specific
-- fields (service tier, IR registration, POPIA flags). It has no slug, and the
-- Finance routes are slug-addressed (/finance/clients/<slug>/...). Rather than
-- retrofit a slug onto a compliance-owned table, shared.clients becomes the
-- identity record and compliance_clients stays as compliance's config.
--
-- Feldspar is seeded with the SAME uuid it already has in
-- public.compliance_clients, so the two rows describe one real client and a
-- later foreign key needs no mapping table.
--
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS shared.clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  legal_name    text,
  jurisdiction  text,
  framework     text,
  year_end      date,
  vat_regime    text,
  status        text NOT NULL DEFAULT 'active',
  folder_path   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE shared.clients IS
  'Cross-module client identity. Modules attach their own config in their own schema.';
COMMENT ON COLUMN shared.clients.slug IS
  'URL-safe identifier. Matches the client folder name under STZA Group/Clients/.';
COMMENT ON COLUMN shared.clients.folder_path IS
  'Absolute path to the client artefact folder the agents read and write.';

CREATE INDEX IF NOT EXISTS idx_shared_clients_status ON shared.clients (status);

-- Seed Feldspar. The uuid matches public.compliance_clients so both rows
-- describe the same client. Re-running updates the non-identity fields.
INSERT INTO shared.clients (
  id, slug, name, legal_name, jurisdiction, framework, year_end, vat_regime,
  status, folder_path
) VALUES (
  'ef32f76e-66fa-40e2-ba28-3a78d2ff01e3',
  'feldspar-sport-group',
  'Feldspar Sport Group',
  'Feldspar Group Holdings Limited',
  'United Kingdom',
  'FRS 102',
  '2025-12-31',
  'UK VAT',
  'active',
  'C:\Users\yogim\STZA Group\Clients\feldspar-sport-group'
)
ON CONFLICT (id) DO UPDATE SET
  slug         = EXCLUDED.slug,
  name         = EXCLUDED.name,
  legal_name   = EXCLUDED.legal_name,
  jurisdiction = EXCLUDED.jurisdiction,
  framework    = EXCLUDED.framework,
  year_end     = EXCLUDED.year_end,
  vat_regime   = EXCLUDED.vat_regime,
  status       = EXCLUDED.status,
  folder_path  = EXCLUDED.folder_path,
  updated_at   = now();
