-- 015: multi-service expansion — service lines, engagement models, and a
-- monthly revenue ledger so recurring engagements (e.g. fractional FD work)
-- can be tracked historically rather than as a single annual-fee field.
--
-- Service lines mirror stza.io/#services:
--   Strategic Financial & Operational Consultancy
--   Commercial Modelling, Pricing & Forecasting
--   Investment Readiness & Fundraising Strategy
--   Market Research & Insight Development
--   Advisory & Business Transformation
--   Performance, Process & Systems Optimisation
--   Data Protection & Compliance   (the existing POPIA line)

-- The POPIA-era service_tier CHECKs only allow representative-service values;
-- tiers are superseded by service_line + engagement_model for multi-service
-- work, so the constraints go and service_tier becomes informational text.
ALTER TABLE compliance_clients DROP CONSTRAINT IF EXISTS compliance_clients_service_tier_check;
ALTER TABLE client_engagements DROP CONSTRAINT IF EXISTS client_engagements_service_tier_check;

ALTER TABLE client_engagements
  ADD COLUMN IF NOT EXISTS service_line text,
  ADD COLUMN IF NOT EXISTS engagement_model text,   -- fractional | retainer | project
  ADD COLUMN IF NOT EXISTS day_rate_gbp numeric,
  ADD COLUMN IF NOT EXISTS days_per_week numeric;

CREATE TABLE IF NOT EXISTS engagement_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES client_engagements(id) ON DELETE CASCADE,
  client_id uuid REFERENCES compliance_clients(id) ON DELETE CASCADE,
  period_month date NOT NULL,                 -- first day of the month
  amount_gbp numeric NOT NULL,
  basis text NOT NULL DEFAULT 'accrued',      -- accrued | invoiced | paid
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (engagement_id, period_month, basis)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON engagement_revenue TO africastn_app;
