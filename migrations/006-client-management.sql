-- Migration 006: Client management tables for POPIA representative services
-- Date: 8 July 2026 (FK fix 10 July 2026)
-- Purpose: Support client onboarding, IO registration tracking, breach management,
--          compliance tasks, and regulatory correspondence for POPIA representative services.
-- Legal basis: POPIA s3(1)(b)(ii), s55, Regulation 4, IR Guidance Note on IOs/DIOs (1 April 2021)
-- IR registration structure (per Mr Siphokuhle Tyasi, 5 June 2026):
--   Representative = IO, Client = DIO, registered as "other private organisation"
--
-- Runs against Cloud SQL (africastn-research) — same database as compliance_clients.
-- The previous version was incorrectly placed under supabase/migrations/ and used
-- UUID for client_id, which mismatched the SERIAL INTEGER PK on compliance_clients.
-- This corrected version uses INTEGER FKs and SERIAL PKs to match the existing schema.

BEGIN;

-- Client engagements (the service agreement linking a client to a service tier)
CREATE TABLE IF NOT EXISTS client_engagements (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES compliance_clients(id),
  service_tier TEXT NOT NULL CHECK (service_tier IN ('representative', 'authorised_io')),
  engagement_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (engagement_status IN ('draft', 'sent', 'signed', 'active', 'suspended', 'terminated')),
  start_date DATE,
  end_date DATE,
  annual_fee_gbp NUMERIC(10,2),
  annual_fee_zar NUMERIC(10,2),
  payment_frequency TEXT DEFAULT 'annual'
    CHECK (payment_frequency IN ('monthly', 'quarterly', 'annual')),
  agreement_document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- IO/DIO registrations managed on behalf of clients
-- Per IR guidance: representative = IO, client = DIO
CREATE TABLE IF NOT EXISTS io_registrations (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES compliance_clients(id),
  registration_type TEXT NOT NULL
    CHECK (registration_type IN ('information_officer', 'deputy_information_officer')),
  registrant_name TEXT NOT NULL,
  registrant_email TEXT,
  registrant_phone TEXT,
  registrant_role TEXT,
  ir_reference_number TEXT,
  registration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (registration_status IN ('pending', 'submitted', 'confirmed', 'rejected', 'deregistered')),
  submitted_date DATE,
  confirmed_date DATE,
  portal_used TEXT CHECK (portal_used IN ('eservices', 'bizportal', 'manual_email')),
  portal_organisation_type TEXT DEFAULT 'other_private',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Breach / security compromise incidents
CREATE TABLE IF NOT EXISTS breach_incidents (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES compliance_clients(id),
  incident_date TIMESTAMPTZ NOT NULL,
  reported_to_ir BOOLEAN DEFAULT FALSE,
  ir_report_date TIMESTAMPTZ,
  ir_reference_number TEXT,
  incident_type TEXT,
  description TEXT,
  data_subjects_affected INTEGER,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'investigating', 'contained', 'resolved', 'closed')),
  remediation_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compliance tasks (IO duties performed for Tier 2 clients)
CREATE TABLE IF NOT EXISTS compliance_tasks (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES compliance_clients(id),
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  completed_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue', 'cancelled')),
  assigned_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Regulatory correspondence log
CREATE TABLE IF NOT EXISTS regulatory_correspondence (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES compliance_clients(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  correspondent TEXT NOT NULL DEFAULT 'Information Regulator',
  subject TEXT NOT NULL,
  received_date TIMESTAMPTZ,
  response_due_date TIMESTAMPTZ,
  responded_date TIMESTAMPTZ,
  urgency TEXT DEFAULT 'normal'
    CHECK (urgency IN ('normal', 'urgent', 'critical')),
  document_url TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'acknowledged', 'in_progress', 'responded', 'closed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_client_engagements_client ON client_engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_client_engagements_status ON client_engagements(engagement_status);
CREATE INDEX IF NOT EXISTS idx_io_registrations_client ON io_registrations(client_id);
CREATE INDEX IF NOT EXISTS idx_io_registrations_status ON io_registrations(registration_status);
CREATE INDEX IF NOT EXISTS idx_breach_incidents_client ON breach_incidents(client_id);
CREATE INDEX IF NOT EXISTS idx_breach_incidents_status ON breach_incidents(status);
CREATE INDEX IF NOT EXISTS idx_compliance_tasks_client ON compliance_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_compliance_tasks_status ON compliance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_compliance_tasks_due ON compliance_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_regulatory_correspondence_client ON regulatory_correspondence(client_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_correspondence_status ON regulatory_correspondence(status);

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_client_engagements_updated') THEN
        CREATE TRIGGER trg_client_engagements_updated
            BEFORE UPDATE ON client_engagements
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_io_registrations_updated') THEN
        CREATE TRIGGER trg_io_registrations_updated
            BEFORE UPDATE ON io_registrations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_breach_incidents_updated') THEN
        CREATE TRIGGER trg_breach_incidents_updated
            BEFORE UPDATE ON breach_incidents
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_compliance_tasks_updated') THEN
        CREATE TRIGGER trg_compliance_tasks_updated
            BEFORE UPDATE ON compliance_tasks
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_regulatory_correspondence_updated') THEN
        CREATE TRIGGER trg_regulatory_correspondence_updated
            BEFORE UPDATE ON regulatory_correspondence
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;
