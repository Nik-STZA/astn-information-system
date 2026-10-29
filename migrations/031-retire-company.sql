-- 031-retire-company.sql
--
-- A company can be retired from a client's profile (Nik, 29 Oct 2026): set up
-- by mistake, struck off, or sold. It is hidden from the profile, the company
-- lists and the agents, and kept, with its history, rather than deleted.
--
-- Retired by a person in os.stza.io and logged to shared.client_events
-- (finance-api server.js). A company connected to Xero, owning another
-- company, or representing the VAT group cannot be retired until that changes.
-- Additive and re-runnable.

ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS retired_at      timestamptz;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS retired_by      text;
ALTER TABLE finance.entities ADD COLUMN IF NOT EXISTS retired_reason  text;

COMMENT ON COLUMN finance.entities.retired_at IS 'Retired from the client profile: hidden from company lists and agents, kept for history.';
