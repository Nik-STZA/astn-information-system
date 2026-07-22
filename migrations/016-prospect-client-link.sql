-- 016: link converted clients back to their pipeline prospect.
--
-- Conversion previously created an unlinked copy: the client row had no
-- reference to the prospect, stranding IR verification, documents, analysis,
-- and assessments on the pipeline side. This adds the link and backfills it
-- by exact company-name match for existing rows.

ALTER TABLE compliance_clients
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES compliance_prospects(id);

UPDATE compliance_clients c
SET prospect_id = p.id
FROM compliance_prospects p
WHERE c.prospect_id IS NULL
  AND lower(trim(c.company_name)) = lower(trim(p.company_name));
