-- 041-outstanding-card-holder.sql
--
-- Outstanding documents (Nik, 10 Nov 2026): the person who made each payment,
-- the cardholder of a card payment or the person who sent a transfer, as
-- named in the bank reference. The Excel export has a tab per person, so
-- each can be asked for their own documents.
--
-- Additive and re-runnable. Apply BEFORE merging the code that reads it.

SET lock_timeout = '10s';

ALTER TABLE finance.outstanding_documents
  ADD COLUMN IF NOT EXISTS card_holder text CHECK (card_holder IS NULL OR length(card_holder) <= 80);

COMMENT ON COLUMN finance.outstanding_documents.card_holder IS
  'The person who made the payment (cardholder or sender of a transfer), as named in the bank reference. Null when none is named.';
