-- 064-history-is-append-only.sql
--
-- The record tables cannot be changed or removed, enforced by the database
-- (19 Nov 2026). Their migrations said "append-only" and granted the app role
-- no UPDATE or DELETE, but the app role owns every table (migrations run as
-- it), so those grants changed nothing. A trigger binds the owner too, short
-- of disabling it, which the app never does.
--
--   finance.audit_log                  every write's record
--   shared.client_events               the client master's history (029 refused
--                                      updates only; deletes are refused now too)
--   finance.rec_events                 a reconciliation's history
--   finance.accrual_comments           the discussion on an accrual proposal
--   finance.pack_commentary_versions   every saved version of a pack's commentary
--
-- One delete is allowed: when a month's list is refreshed, a reconciliation
-- nobody has touched (only ever "composed") is removed, and its "composed"
-- events go with it (lib/recs-routes.js). Every other change is refused.
-- A client cannot be deleted while it has history: the audit log keeps it.
--
-- The full fix, a separate owner role so the app holds only what it is
-- granted, is a build item. finance.thread_entries has had its own guard since
-- migration 050 and is left to it. Re-runnable.

SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION finance.refuse_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Nested, not AND: a statement-level TRUNCATE has no OLD row to read.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'rec_events' THEN
    IF OLD.action = 'composed' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '%.% is a record: rows are added, never changed or removed (migration 064)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance.audit_log', 'shared.client_events', 'finance.rec_events',
                           'finance.accrual_comments', 'finance.pack_commentary_versions']
  LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS history_append_only ON %s', t);
    EXECUTE format('CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION finance.refuse_history_change()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS history_no_truncate ON %s', t);
    EXECUTE format('CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION finance.refuse_history_change()', t);
  END LOOP;
END $$;
