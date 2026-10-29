-- 025: Client rules for the agents' procedures (29 Oct 2026).
--
-- The standard procedures are files in finance-api (agents/procedures): how
-- STZA's finance team works, the same for every client. A client's engagement
-- adds to them here:
--
--   addition     extra rules appended to a standard procedure, which take
--                precedence where they differ ("accrue freelancers monthly
--                from the time sheet")
--   replacement  the client's own version of a standard procedure, in full
--   own          a procedure only this client has (a grant claim, a stock count)
--
-- Only an approved rule reaches an agent. A draft, or one whose approval was
-- withdrawn, is invisible to it, so a rule cannot be put into effect by the
-- person who wrote it without the approval being recorded.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS finance.client_procedures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  procedure      text NOT NULL CHECK (procedure ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind           text NOT NULL CHECK (kind IN ('addition', 'replacement', 'own')),
  title          text,
  summary        text,
  body           text NOT NULL CHECK (length(btrim(body)) > 0),
  roles          text[],
  version        int NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  approved_by    text,
  approved_at    timestamptz,
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

-- One live rule of each kind per procedure per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_procedures_live
  ON finance.client_procedures (client_id, procedure, kind) WHERE status <> 'retired';

COMMENT ON TABLE finance.client_procedures IS
  'Client rules for the agents'' standard procedures. Only approved rows reach an agent (finance-api lib/agent-procedures.js).';
