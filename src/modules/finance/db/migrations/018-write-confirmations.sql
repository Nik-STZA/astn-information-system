-- 018-write-confirmations.sql
--
-- Supports the confirmed write tiers in finance-api (post, send, settle, setup,
-- conversion): POST /api/finance/clients/:slug/xero/:entity/write/...
--
-- Two things:
--   1. finance.write_confirmations - the single-use confirmation codes a dry run
--      issues. On the laptop MCP they lived in process memory; Cloud Run runs
--      several instances, so a code issued by one must be redeemable on another.
--   2. write_policy on the four portal entities, copied from the laptop's
--      mcp_write_policy.json so both surfaces allow the same things.
--
-- Idempotent and re-runnable.

BEGIN;

-- ── finance.write_confirmations ─────────────────────────────────────────────
--
-- A code proves the write being made is the one that was validated and shown:
-- it is bound to the tool, the entity and a hash of the exact payload, lasts 15
-- minutes and is redeemed once. Redemption is a single conditional UPDATE, so
-- two concurrent requests cannot both spend the same code.

CREATE TABLE IF NOT EXISTS finance.write_confirmations (
  code            text PRIMARY KEY,
  client_id       uuid NOT NULL REFERENCES shared.clients(id),
  entity_id       uuid NOT NULL REFERENCES finance.entities(id),
  tool            text NOT NULL,
  payload_digest  text NOT NULL,
  issued_to       text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  consumed_by     text
);

CREATE INDEX IF NOT EXISTS write_confirmations_expires_idx
  ON finance.write_confirmations (expires_at) WHERE consumed_at IS NULL;

-- ── write_policy ────────────────────────────────────────────────────────────
--
-- Same switches as the laptop policy on 18 October 2026:
--   Feldspar entities: post on (17 Sep 2026, month-end journals). settle off:
--     the practice does not move money on these ledgers.
--   STZA: post and settle on (16 and 17 Sep 2026), cap 5000.00.
-- Anything not set takes lib/xero-write.js DEFAULT_POLICY (note and draft on).
-- Only written where the entity has no write_policy yet, so a later change made
-- on the portal is never overwritten by a re-run.

UPDATE finance.entities e
   SET accounting_system_config = e.accounting_system_config
         || jsonb_build_object('write_policy', jsonb_build_object('post', true))
  FROM shared.clients c
 WHERE c.id = e.client_id
   AND c.slug = 'feldspar-sport-group'
   AND e.slug IN ('feldspar-group-holdings', 'feldspar-ltd', 'ultraspeed-digital')
   AND NOT (e.accounting_system_config ? 'write_policy');

UPDATE finance.entities e
   SET accounting_system_config = e.accounting_system_config
         || jsonb_build_object('write_policy',
              jsonb_build_object('post', true, 'settle', true, 'max_amount', '5000.00'))
  FROM shared.clients c
 WHERE c.id = e.client_id
   AND c.slug = 'stza'
   AND e.slug = 'stza'
   AND NOT (e.accounting_system_config ? 'write_policy');

COMMIT;
