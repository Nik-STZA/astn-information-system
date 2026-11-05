-- 039-xero-changes.sql
--
-- Proposed changes to Xero other than journals: an agent (or a person) proposes
-- one, the CFO approves it in os.stza.io, and only then does finance-api make
-- it, through the same gated write route Cowork uses (tier, validation,
-- confirmation code, audit). The first kind is a fixed asset, created in Xero's
-- register as a DRAFT; a person registers it there. Other writes join by adding
-- a kind in finance-api (lib/xero-changes.js), with no new table.
--
--   finance.xero_changes   one proposed change: what, why, the CFO's decision,
--                          and what Xero said
--
-- Journals keep their own register (033): they have periods, numbers and a
-- posting step this does not.
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it; until
-- then finance-api answers its routes with migration_missing. No DELETE grant:
-- a change is rejected, never removed.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.xero_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  -- The Cowork tool whose write route makes it: create_fixed_asset first.
  kind             text NOT NULL CHECK (kind ~ '^[a-z_]+$'),
  -- The body the write route receives, exactly as the CFO saw it. Never edited
  -- after it is proposed: a change is rejected and proposed again.
  input            jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  -- One line for lists, e.g. "Laptop, 12 Sep 2026, 1,200.00".
  summary          text NOT NULL CHECK (length(btrim(summary)) > 0),
  -- Why, with the evidence (the bill it came from). Stays here, never in Xero.
  reason           text,
  -- The Xero document it came from, when there is one (the purchase bill).
  source_doc       text,
  source           text NOT NULL CHECK (source IN ('person', 'agent')),
  proposed_by      text NOT NULL,
  proposed_run_id  uuid,
  state            text NOT NULL DEFAULT 'proposed'
                     CHECK (state IN ('proposed', 'approved', 'written', 'rejected')),
  approved_by      text,
  approved_at      timestamptz,
  rejected_by      text,
  rejected_at      timestamptz,
  rejected_after_check boolean NOT NULL DEFAULT false,
  -- Part of the Xero idempotency key. Moves on only after Xero definitely refused.
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  -- unknown: the last attempt may have reached Xero (no clear answer came back).
  attempt_outcome  text CHECK (attempt_outcome IN ('refused', 'unknown')),
  last_error       text,
  -- What Xero made: the asset id, and the audit row of the write.
  xero_id          text,
  result           jsonb,
  written_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xero_change_agent_has_run CHECK (source <> 'agent' OR proposed_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_finance_xero_changes_client_state ON finance.xero_changes (client_id, state);

COMMENT ON TABLE finance.xero_changes IS
  'Changes to Xero other than journals (fixed assets first). Proposed by a person or an agent, approved by the CFO in os.stza.io, then made by finance-api through the gated write route.';

GRANT SELECT, INSERT, UPDATE ON finance.xero_changes TO africastn_app;
