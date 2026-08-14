-- 011-journal-idempotency.sql
--
-- Supports POST /api/finance/clients/:slug/xero/:entity/journals
-- (docs/xero-write-path/xero-write-path-spec.md).
--
-- Two things:
--   1. finance.journal_posts - the idempotency ledger required by spec section 4.
--   2. journal_materiality_gbp on every client's materiality_thresholds.
--
-- Idempotent and re-runnable.

BEGIN;

-- ── finance.journal_posts ───────────────────────────────────────────────────
--
-- One row per (client, entity, idempotency_key). Exists so a replayed key
-- returns the original result instead of posting a second journal to a client
-- ledger. The audit trail stays in finance.audit_log; this table is only the
-- uniqueness claim and enough of the outcome to answer a replay.
--
-- request_fingerprint is a hash of the normalised request. A repeat with the
-- same key and the same payload is a replay and returns the original result; a
-- repeat with the same key and a DIFFERENT payload is a caller bug and gets a
-- 409, which is why the fingerprint is stored rather than recomputed from the
-- journal.

CREATE TABLE IF NOT EXISTS finance.journal_posts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES shared.clients(id),
  entity_id             uuid NOT NULL REFERENCES finance.entities(id),
  idempotency_key       text NOT NULL,
  request_fingerprint   text NOT NULL,

  -- Outcome. Null journal_id means it never reached Xero, or Xero refused.
  outcome               text NOT NULL
                          CHECK (outcome IN ('posted', 'draft', 'failed', 'dry_run')),
  journal_id            text,
  journal_number        text,
  xero_status           text,

  -- The response body returned for the original call, replayed verbatim so a
  -- retry cannot observe a different answer from the first attempt.
  response_body         jsonb NOT NULL,

  audit_id              uuid,
  actor_email           text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, entity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS journal_posts_client_created_idx
  ON finance.journal_posts (client_id, created_at DESC);

-- Finding a prior journal with the same shape, for the duplicate warning in
-- spec section 4 that catches posts made without a key.
CREATE INDEX IF NOT EXISTS journal_posts_journal_id_idx
  ON finance.journal_posts (journal_id) WHERE journal_id IS NOT NULL;

-- ── journal materiality ─────────────────────────────────────────────────────
--
-- Its own key. materiality_thresholds already carries bva_variance_flag_gbp and
-- balance_control_threshold_gbp, which are different concepts measuring
-- different things; overloading either would silently couple journal approval
-- to budget variance reporting.
--
-- 1 GBP is deliberate and is a rule, not a threshold (spec section 8.3). It
-- means effectively every journal carries its amount into the text the approver
-- reads, so an unusual number is visible against a uniform background. Raising
-- it later is cheap; discovering after a miss that the interesting journal was
-- the silent one is not.

UPDATE finance.client_finance_config
   SET materiality_thresholds =
         COALESCE(materiality_thresholds, '{}'::jsonb)
         || jsonb_build_object('journal_materiality_gbp', 1)
 WHERE NOT (COALESCE(materiality_thresholds, '{}'::jsonb) ? 'journal_materiality_gbp');

COMMIT;
