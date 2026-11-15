-- 045-registry-candidate-duplicates.sql
--
-- A registry candidate can be closed as a confirmed duplicate (15 Nov 2026).
-- Until now a candidate the reviewer found already in the registry could only
-- be rejected, which recorded the wrong thing and dropped the link to the row
-- it duplicates. Status 'duplicate' closes it and organization_id points at
-- the existing organisation.
--
-- Additive and re-runnable. Apply BEFORE merging the code that uses it.

SET lock_timeout = '10s';

ALTER TABLE public.registry_candidates DROP CONSTRAINT IF EXISTS registry_candidates_status_check;
ALTER TABLE public.registry_candidates ADD CONSTRAINT registry_candidates_status_check
  CHECK (status IN ('queued', 'reviewing', 'proposed', 'failed', 'approved', 'rejected', 'duplicate'));

-- A duplicate names the row it duplicates, and was decided by someone.
ALTER TABLE public.registry_candidates DROP CONSTRAINT IF EXISTS registry_candidates_duplicate_check;
ALTER TABLE public.registry_candidates ADD CONSTRAINT registry_candidates_duplicate_check
  CHECK (status <> 'duplicate' OR (organization_id IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL));
