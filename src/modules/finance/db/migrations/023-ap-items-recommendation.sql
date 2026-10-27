-- 023: an agent's recommendation on an AP queue item.
--
-- The AP Clerk agent reviews Bills items line by line and suggests the coding
-- (Nik, 27 Oct 2026). Advice only: it changes neither the item's state nor its
-- proposed bill, and nothing goes to the ledger. The CFO accepts it in the
-- portal, which is recorded as the decision.
--
--   recommendation  { lines: [{ index, account_code, tax_type, reason }],
--                     due_date, note, agent, run_id, by_email, at }
--
-- Idempotent.

ALTER TABLE finance.ap_items ADD COLUMN IF NOT EXISTS recommendation jsonb;
