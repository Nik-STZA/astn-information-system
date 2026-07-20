-- Migration 011: POPIA s22 breach notification fields and FK type corrections
-- Date: 20 July 2026
-- Purpose:
--   1. Add missing POPIA s22 breach notification tracking fields to breach_incidents.
--   2. Correct FK type mismatch on migration-006 tables (INTEGER → UUID).
--
-- Background — FK type investigation:
--   Migration 006 (8 July 2026) created client_engagements, io_registrations,
--   breach_incidents, compliance_tasks, and regulatory_correspondence with
--   client_id INTEGER, referencing compliance_clients(id). Its header stated
--   this was intentional because compliance_clients.id was "SERIAL INTEGER PK".
--
--   Migrations 009 (16 July 2026) and 010 (17 July 2026) both use client_id UUID,
--   referencing the same compliance_clients(id). Migration 010 explicitly documents
--   "compliance_clients.id (UUID PK)".
--
--   The compliance_clients table was created directly in Cloud SQL before this
--   migration series. Its PK is UUID. Migration 006's INTEGER FKs are therefore
--   incorrect and must be altered to UUID to match the parent table type and to be
--   consistent with migrations 009 and 010.
--
--   Tables affected by the FK type fix (all from migration 006):
--     - client_engagements.client_id       INTEGER → UUID
--     - io_registrations.client_id          INTEGER → UUID
--     - breach_incidents.client_id          INTEGER → UUID
--     - compliance_tasks.client_id          INTEGER → UUID
--     - regulatory_correspondence.client_id INTEGER → UUID
--
-- POPIA s22 breach notification fields added to breach_incidents:
--   - notification_deadline: statutory 72-hour deadline for IR notification
--   - data_subjects_notified: whether affected data subjects have been notified
--   - data_subjects_notification_date: when data subjects were notified
--   - data_subjects_count: estimated number of affected data subjects
--   (Note: the existing data_subjects_affected column records actual confirmed
--   affected count; data_subjects_count is the initial estimate used in the
--   IR notification form.)
--
-- Run against Cloud SQL (africastn-research):
--   psql "host=<IP> dbname=africastn_os user=africastn_app" -f 011-breach-fields-and-fixes.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. FK TYPE CORRECTIONS — migration 006 tables (INTEGER → UUID)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Each block: drop the old FK constraint (by name or by lookup), alter the column
-- type, then re-add the FK referencing compliance_clients(id) ON DELETE CASCADE.
--
-- These are wrapped in conditional DO blocks that check the current column type
-- so the migration is safe to re-run: if already UUID, it skips the ALTER.

-- ─── 1a. client_engagements.client_id ────────────────────────────────────────

DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'client_engagements'
          AND column_name = 'client_id'
          AND data_type = 'integer'
    ) THEN
        FOR r IN
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'client_engagements'
              AND kcu.column_name = 'client_id'
              AND tc.constraint_type = 'FOREIGN KEY'
        LOOP
            EXECUTE 'ALTER TABLE client_engagements DROP CONSTRAINT ' || r.constraint_name;
        END LOOP;

        ALTER TABLE client_engagements ALTER COLUMN client_id TYPE UUID USING NULL;
        ALTER TABLE client_engagements
            ADD CONSTRAINT fk_client_engagements_client
            FOREIGN KEY (client_id) REFERENCES compliance_clients(id) ON DELETE CASCADE;

        RAISE NOTICE 'client_engagements.client_id: converted INTEGER → UUID';
    ELSE
        RAISE NOTICE 'client_engagements.client_id: already UUID, no change needed';
    END IF;
END $$;

-- ─── 1b. io_registrations.client_id ──────────────────────────────────────────

DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'io_registrations'
          AND column_name = 'client_id'
          AND data_type = 'integer'
    ) THEN
        FOR r IN
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'io_registrations'
              AND kcu.column_name = 'client_id'
              AND tc.constraint_type = 'FOREIGN KEY'
        LOOP
            EXECUTE 'ALTER TABLE io_registrations DROP CONSTRAINT ' || r.constraint_name;
        END LOOP;

        ALTER TABLE io_registrations ALTER COLUMN client_id TYPE UUID USING NULL;
        ALTER TABLE io_registrations
            ADD CONSTRAINT fk_io_registrations_client
            FOREIGN KEY (client_id) REFERENCES compliance_clients(id) ON DELETE CASCADE;

        RAISE NOTICE 'io_registrations.client_id: converted INTEGER → UUID';
    ELSE
        RAISE NOTICE 'io_registrations.client_id: already UUID, no change needed';
    END IF;
END $$;

-- ─── 1c. breach_incidents.client_id ──────────────────────────────────────────

DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'breach_incidents'
          AND column_name = 'client_id'
          AND data_type = 'integer'
    ) THEN
        FOR r IN
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'breach_incidents'
              AND kcu.column_name = 'client_id'
              AND tc.constraint_type = 'FOREIGN KEY'
        LOOP
            EXECUTE 'ALTER TABLE breach_incidents DROP CONSTRAINT ' || r.constraint_name;
        END LOOP;

        ALTER TABLE breach_incidents ALTER COLUMN client_id TYPE UUID USING NULL;
        ALTER TABLE breach_incidents
            ADD CONSTRAINT fk_breach_incidents_client
            FOREIGN KEY (client_id) REFERENCES compliance_clients(id) ON DELETE CASCADE;

        RAISE NOTICE 'breach_incidents.client_id: converted INTEGER → UUID';
    ELSE
        RAISE NOTICE 'breach_incidents.client_id: already UUID, no change needed';
    END IF;
END $$;

-- ─── 1d. compliance_tasks.client_id ──────────────────────────────────────────

DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_tasks'
          AND column_name = 'client_id'
          AND data_type = 'integer'
    ) THEN
        FOR r IN
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'compliance_tasks'
              AND kcu.column_name = 'client_id'
              AND tc.constraint_type = 'FOREIGN KEY'
        LOOP
            EXECUTE 'ALTER TABLE compliance_tasks DROP CONSTRAINT ' || r.constraint_name;
        END LOOP;

        ALTER TABLE compliance_tasks ALTER COLUMN client_id TYPE UUID USING NULL;
        ALTER TABLE compliance_tasks
            ADD CONSTRAINT fk_compliance_tasks_client
            FOREIGN KEY (client_id) REFERENCES compliance_clients(id) ON DELETE CASCADE;

        RAISE NOTICE 'compliance_tasks.client_id: converted INTEGER → UUID';
    ELSE
        RAISE NOTICE 'compliance_tasks.client_id: already UUID, no change needed';
    END IF;
END $$;

-- ─── 1e. regulatory_correspondence.client_id ─────────────────────────────────

DO $$
DECLARE
    r RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'regulatory_correspondence'
          AND column_name = 'client_id'
          AND data_type = 'integer'
    ) THEN
        FOR r IN
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'regulatory_correspondence'
              AND kcu.column_name = 'client_id'
              AND tc.constraint_type = 'FOREIGN KEY'
        LOOP
            EXECUTE 'ALTER TABLE regulatory_correspondence DROP CONSTRAINT ' || r.constraint_name;
        END LOOP;

        ALTER TABLE regulatory_correspondence ALTER COLUMN client_id TYPE UUID USING NULL;
        ALTER TABLE regulatory_correspondence
            ADD CONSTRAINT fk_regulatory_correspondence_client
            FOREIGN KEY (client_id) REFERENCES compliance_clients(id) ON DELETE CASCADE;

        RAISE NOTICE 'regulatory_correspondence.client_id: converted INTEGER → UUID';
    ELSE
        RAISE NOTICE 'regulatory_correspondence.client_id: already UUID, no change needed';
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. POPIA s22 BREACH NOTIFICATION FIELDS
-- ═══════════════════════════════════════════════════════════════════════════════
-- POPIA s22(1): responsible party must notify the Information Regulator and
-- data subjects "as soon as reasonably possible" after discovering a breach.
-- IR Guidance Note on Breach Notification (2021): 72-hour notification window.
--
-- notification_deadline: computed as incident discovery + 72 hours; stored so
--   the dashboard can show countdown / overdue status without re-calculating.
-- data_subjects_notified: whether affected individuals have been told.
-- data_subjects_notification_date: when they were told.
-- data_subjects_count: initial estimate for the IR notification form
--   (distinct from the existing data_subjects_affected which is the confirmed
--   count after investigation).

ALTER TABLE breach_incidents ADD COLUMN IF NOT EXISTS
    notification_deadline TIMESTAMPTZ;

ALTER TABLE breach_incidents ADD COLUMN IF NOT EXISTS
    data_subjects_notified BOOLEAN DEFAULT FALSE;

ALTER TABLE breach_incidents ADD COLUMN IF NOT EXISTS
    data_subjects_notification_date DATE;

ALTER TABLE breach_incidents ADD COLUMN IF NOT EXISTS
    data_subjects_count INTEGER;

-- ─── 3. updated_at trigger ───────────────────────────────────────────────────
-- breach_incidents already has trg_breach_incidents_updated from migration 006;
-- the new columns are covered automatically since the trigger fires on any UPDATE.

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════════
-- No new tables created, but ensure africastn_app has access to the altered tables.
-- These are idempotent — safe to re-run.

GRANT SELECT, INSERT, UPDATE, DELETE ON breach_incidents TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_engagements TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON io_registrations TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_tasks TO africastn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON regulatory_correspondence TO africastn_app;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- Verify new columns exist on breach_incidents
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'breach_incidents'
  AND column_name IN (
    'notification_deadline',
    'data_subjects_notified',
    'data_subjects_notification_date',
    'data_subjects_count',
    'client_id'
  )
ORDER BY ordinal_position;

-- Verify FK column types are UUID across all client-linked tables
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name = 'client_id'
  AND table_name IN (
    'client_engagements', 'io_registrations', 'breach_incidents',
    'compliance_tasks', 'regulatory_correspondence',
    'remediation_items', 'audit_log',
    'client_processing_activities', 'client_special_categories'
  )
ORDER BY table_name;
