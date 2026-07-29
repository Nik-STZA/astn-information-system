-- 003-engagement-roles.sql
--
-- Makes the approver's role a per-client fact, and snapshots it onto every
-- audit entry.
--
-- Why. The role STZA holds differs by engagement: Fractional Finance Director
-- at one client, Fractional CFO at another. An audit trail that records only
-- "approved by nik@stza.io" is not verifiable, because it does not say in what
-- capacity the approval was given. That capacity is what an auditor, a board,
-- or a court would ask about.
--
-- The critical design point is the snapshot. audit_log.actor_role stores the
-- role AS AT the moment of approval, rather than joining to a current-role
-- field. If it joined, then changing a title later would silently rewrite the
-- capacity recorded against every historical approval. An audit trail that can
-- be altered by editing a lookup table is not an audit trail.
--
-- Idempotent and re-runnable.

CREATE TABLE IF NOT EXISTS finance.client_engagement_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  actor_email     text NOT NULL,
  role            text NOT NULL,
  -- NULL means "from the beginning of the engagement, exact date not recorded".
  -- Better an honest null than an invented date in an audit table.
  effective_from  date,
  -- NULL means currently in force.
  effective_to    date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_role_dates CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from
  )
);

COMMENT ON TABLE finance.client_engagement_roles IS
  'The capacity in which a person acts for a given client. Effective dated, because the role can change mid-engagement and historical approvals must keep the role that applied at the time.';
COMMENT ON COLUMN finance.client_engagement_roles.role IS
  'Engagement capacity as it would be stated to an auditor, for example Fractional Finance Director or Fractional CFO.';

CREATE INDEX IF NOT EXISTS idx_finance_engagement_roles_lookup
  ON finance.client_engagement_roles (client_id, actor_email);

-- Only one role in force per person per client at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_engagement_role_current
  ON finance.client_engagement_roles (client_id, actor_email)
  WHERE effective_to IS NULL;


-- Resolves the role that applied on a given date. Used to populate the
-- snapshot at write time, never to render historical entries.
CREATE OR REPLACE FUNCTION finance.role_at(
  p_client_id uuid,
  p_actor_email text,
  p_on date DEFAULT CURRENT_DATE
) RETURNS text AS $$
  SELECT role
  FROM finance.client_engagement_roles
  WHERE client_id = p_client_id
    AND actor_email = p_actor_email
    AND (effective_from IS NULL OR effective_from <= p_on)
    AND (effective_to IS NULL OR effective_to >= p_on)
  ORDER BY effective_from DESC NULLS LAST
  LIMIT 1;
$$ LANGUAGE sql STABLE;


-- The snapshot. Written at the time of the action and never recalculated.
ALTER TABLE finance.audit_log
  ADD COLUMN IF NOT EXISTS actor_role text;

COMMENT ON COLUMN finance.audit_log.actor_role IS
  'The capacity the actor held for this client at the moment of the action. A snapshot: never derive this by joining to client_engagement_roles when reading, or historical entries will change when a role changes.';


DROP TRIGGER IF EXISTS set_updated_at ON finance.client_engagement_roles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.client_engagement_roles
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();


-- Seed the Feldspar engagement. Per the Feldspar CLAUDE.md the engagement is
-- described as Fractional Finance Director. effective_from is deliberately
-- left null: the true engagement start date is not recorded anywhere in this
-- repo and must not be guessed in an audit table. Set it once confirmed.
INSERT INTO finance.client_engagement_roles (client_id, actor_email, role, effective_from, notes)
SELECT id, 'nik@stza.io', 'Fractional Finance Director', NULL,
       'Seeded from the Feldspar engagement description. Confirm the engagement start date and set effective_from.'
FROM shared.clients WHERE slug = 'feldspar-sport-group'
ON CONFLICT DO NOTHING;
