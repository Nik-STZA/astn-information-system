-- 055: the client's management pack template (part 2 of
-- docs/management-pack-templates-plan.md, CFO 18 Nov 2026). The templates
-- themselves are in code (finance-api/lib/pack-templates.js); this records
-- which one the client uses. The CFO changes it in Settings > Financial.
--
-- Everyone starts on standard_management, which draws exactly what the pack
-- draws today (Management EBITDA since #207). Feldspar Sport Group moves to its
-- own template.
--
-- Idempotent.
ALTER TABLE shared.clients
  ADD COLUMN IF NOT EXISTS pack_template text NOT NULL DEFAULT 'standard_management';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_pack_template_check') THEN
    ALTER TABLE shared.clients ADD CONSTRAINT clients_pack_template_check
      CHECK (pack_template IN ('standard_management', 'standard_statutory', 'feldspar_management'));
  END IF;
END $$;

UPDATE shared.clients SET pack_template = 'feldspar_management'
 WHERE slug = 'feldspar-sport-group' AND pack_template = 'standard_management';
