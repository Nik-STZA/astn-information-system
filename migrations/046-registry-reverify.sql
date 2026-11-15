-- 046-registry-reverify.sql
--
-- Re-verifying registry records (15 Nov 2026). Records below High confidence
-- (Registry > Verify, 972 on 15 Nov) can be sent back to a researcher from
-- os.stza.io. Each becomes a registry candidate of kind 'reverify' pointing at
-- the existing organisation (organization_id, set from the start). The
-- researcher checks the website for free, then researches with Gemini on
-- Vertex with Google Search grounding, and proposes changes; a person ticks
-- the changes to apply. Nothing changes in public.organizations without that.
--
--   kind            'new' (submitted for adding) or 'reverify' (an existing row)
--   website_check   the free automated check of the record's website
--   research_meta   engine, model, searches made and tokens, for cost tracking
--   verdict         gains 'update' (changes proposed) and 'no_change'
--
-- One open re-verification per organisation at a time.
--
-- Additive and re-runnable. Apply BEFORE merging the code that uses it.

SET lock_timeout = '10s';

ALTER TABLE public.registry_candidates
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS website_check jsonb,
  ADD COLUMN IF NOT EXISTS research_meta jsonb;

ALTER TABLE public.registry_candidates DROP CONSTRAINT IF EXISTS registry_candidates_kind_check;
ALTER TABLE public.registry_candidates ADD CONSTRAINT registry_candidates_kind_check
  CHECK (kind IN ('new', 'reverify'));

ALTER TABLE public.registry_candidates DROP CONSTRAINT IF EXISTS registry_candidates_verdict_check;
ALTER TABLE public.registry_candidates ADD CONSTRAINT registry_candidates_verdict_check
  CHECK (verdict IS NULL OR verdict IN ('add', 'duplicate', 'reject', 'update', 'no_change'));

-- A re-verification always names the organisation it is about.
ALTER TABLE public.registry_candidates DROP CONSTRAINT IF EXISTS registry_candidates_reverify_check;
ALTER TABLE public.registry_candidates ADD CONSTRAINT registry_candidates_reverify_check
  CHECK (kind <> 'reverify' OR organization_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_registry_candidates_open_reverify
  ON public.registry_candidates (organization_id)
  WHERE kind = 'reverify' AND status IN ('queued', 'reviewing', 'proposed', 'failed');
