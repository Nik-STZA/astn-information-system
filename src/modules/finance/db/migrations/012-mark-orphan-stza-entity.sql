-- 012-mark-orphan-stza-entity.sql
--
-- Makes the unconnected 'stza-ltd' entity unselectable by mistake.
--
-- The stza client has two entities with near-identical names:
--
--   stza      "Sports Tech Africa Ltd"      tenant_id set, connected 31 Jul 2026
--   stza-ltd  "STZA" / "Sports Tech Africa Limited"   never connected
--
-- 'stza-ltd' is the one migration 010 creates. 'stza' was created through the
-- portal and carries the live Xero connection. Anything reading a list of
-- entities sees two plausible candidates for the same company, and picking the
-- wrong one is a silent failure: it has no tenant, so it 404s rather than
-- posting somewhere wrong - but it has already cost real time in this
-- workstream.
--
-- Renaming rather than deleting is deliberate. Deleting would put this file and
-- the database back out of step, which is the problem 010 has just been
-- reconciled out of. role='Practice' also suggests intent nobody has
-- reconstructed. Merging the two rows properly is separate, considered work and
-- is tracked as an open issue; this migration only removes the ambiguity.
--
-- Idempotent and re-runnable.

BEGIN;

UPDATE finance.entities e
   SET name = 'STZA Practice - NOT CONNECTED, do not use'
  FROM shared.clients c
 WHERE c.id = e.client_id
   AND c.slug = 'stza'
   AND e.slug = 'stza-ltd'
   AND e.accounting_system_config->>'tenant_id' IS NULL;

COMMIT;
