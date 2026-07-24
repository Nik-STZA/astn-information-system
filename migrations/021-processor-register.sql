-- Migration 021: Processor / systems register
-- Date: 24 July 2026
-- Purpose: Persist the systems stock-take as the OS system of record. This IS the
--          processor list for a ROPA and the DPA action tracker (Art 28 / operator).
--          Seeds Sports Tech Africa Ltd (STZA) from the 2026-07-24 stock-take.
--          dpa_status is the live action state; update as DPAs are confirmed/signed.
--
-- Idempotent. Run against Cloud SQL (africastn_os).

BEGIN;

CREATE TABLE IF NOT EXISTS client_processors (
    id               SERIAL PRIMARY KEY,
    client_id        UUID NOT NULL REFERENCES compliance_clients(id) ON DELETE CASCADE,
    system_name      TEXT NOT NULL,
    category         TEXT,   -- ai_llm | infrastructure | business_saas
    purpose          TEXT,
    data_categories  TEXT,
    tier             TEXT,   -- consumer | free | commercial_api | business
    dpa_status       TEXT NOT NULL DEFAULT 'unknown'
        CHECK (dpa_status IN ('in_place','available_unconfirmed','not_covered','exiting','not_required','decommissioned','unknown')),
    action           TEXT,
    status           TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','exiting','decommissioned')),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, system_name)
);

CREATE INDEX IF NOT EXISTS idx_client_processors_client ON client_processors(client_id);

INSERT INTO client_processors (client_id, system_name, category, purpose, data_categories, tier, dpa_status, action, status, notes)
SELECT c.id, v.system_name, v.category, v.purpose, v.data_categories, v.tier, v.dpa_status, v.action, v.status, v.notes
FROM compliance_clients c,
(VALUES
  ('Claude (Consumer Max)','ai_llm','Interactive advisory and analysis by principal','Business plus potentially client personal data','consumer','not_covered','Move interactive use to Claude Team/Enterprise (commercial terms + DPA), or keep client data out of the consumer tier','active','Principal hands-on use via claude.ai'),
  ('OpenAI / ChatGPT','ai_llm','Analysis and drafting','Business plus potentially client personal data','consumer (to confirm)','not_covered','Confirm tier; move to ChatGPT Business/Enterprise or the API with a DPA, or exclude client data','active','Billed to the entity; likely consumer'),
  ('Google Gemini (AI Studio)','ai_llm','Compliance engine cross-check and content generation','Client documents if used for client work','free','not_covered','For client data, move to Vertex AI / paid Gemini under the Google Cloud DPA','active','gen-lang-client project; acceptable for STZA-own documents only'),
  ('Anthropic API','ai_llm','Compliance engine Claude cross-check','Client documents','commercial_api','available_unconfirmed','Sign the Anthropic commercial DPA and set zero/limited retention','active','Pay-as-you-go, set up 2026-07-24'),
  ('Google Cloud Platform','infrastructure','Hosts the OS, compliance engine, Cloud SQL (client compliance data), Secret Manager','Client personal data (compliance)','business','available_unconfirmed','Confirm the Google Cloud DPA is accepted','active','Core infrastructure'),
  ('GitHub','infrastructure','Source code and some data backups','Mostly code; some data (e.g. transcripts)','business','available_unconfirmed','Confirm the DPA','active',NULL),
  ('Netlify','infrastructure','Website hosting (stza.io, africanstn.com)','Website and analytics data','business','available_unconfirmed','Confirm the DPA; potential future exit','active','Billed to the business'),
  ('Supabase','infrastructure','Organisation registry (legacy)','Organisation data','business','exiting','Complete migration to Cloud SQL, then decommission','exiting','Last remaining Supabase dependency'),
  ('Google Workspace','business_saas','Email, Drive, Docs — client communications and documents','Client and business personal data','business','available_unconfirmed','Confirm the Workspace DPA is accepted','active',NULL),
  ('Xero','business_saas','Accounting and fractional finance work','Client financial and personal data','business','available_unconfirmed','Confirm the Xero DPA is signed','active',NULL),
  ('HubSpot','business_saas','CRM and marketing','Contact personal data','business','available_unconfirmed','Confirm the DPA; possible exit pending OS build and cost','active','May move away'),
  ('Notion','business_saas','Content workflow (legacy)','Business and content data','business','exiting','Exit for compliance records; reduce reliance','exiting',NULL),
  ('Beehiiv','business_saas','Newsletter','Subscriber personal data','business','available_unconfirmed','Confirm the DPA','active',NULL),
  ('Canva','business_saas','Design','Minimal personal data','to confirm','unknown','Confirm whether still in use; decommission if not','active','Previously used'),
  ('Tally.so','business_saas','Forms','None','none','not_required','Remove from records','decommissioned','Not in use'),
  ('SendGrid','business_saas','Transactional email (dormant)','Recipient data','business','exiting','Decommission','exiting','Dormant, being removed')
) AS v(system_name, category, purpose, data_categories, tier, dpa_status, action, status, notes)
WHERE c.company_name = 'Sports Tech Africa Ltd'
ON CONFLICT (client_id, system_name) DO NOTHING;

COMMIT;
