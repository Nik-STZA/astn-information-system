-- 054: a sub-line within a P&L category (CFO, 18 Nov 2026). A master mapping
-- file has two levels, P&L Mapping 1 (the heading: IT Costs) and P&L Mapping 2
-- (the line under it: Hosting & Infrastructure); the pack draws each category's
-- sub-lines as totals of their accounts. Null: the account sits directly under
-- its category, as before.
ALTER TABLE finance.account_mappings
  ADD COLUMN IF NOT EXISTS subline text CHECK (subline IS NULL OR char_length(btrim(subline)) BETWEEN 1 AND 80);
