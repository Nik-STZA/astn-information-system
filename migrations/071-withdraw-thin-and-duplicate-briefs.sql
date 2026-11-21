-- Migration 071: withdraw 13 public briefs (data change)
-- Date: 20 November 2026
-- Approved by Nik on 20 November 2026 ("withdraw all 13").
-- Branch: feature/brief-pipeline. NOT APPLIED. Needs migration 070 first.
-- After applying, rebuild africanstn.com (Netlify) with the matching
-- redirects from the website branch feature/brief-footer-edition-2.
--
-- 9 thin briefs (fewer than three items) and 4 that overlap a kept brief.
-- Each row is matched by id AND its current status, so a re-run or a row
-- that has changed since 20 November is left alone. The final SELECT must
-- show 13 rows; if not, ROLLBACK instead of COMMIT.

BEGIN;

WITH plan (id, public_date, redirect_to, reason) AS (VALUES
  ('8d9f431f-862c-40df-a92b-2cc1cb51a0fa'::uuid, DATE '2026-03-28', DATE '2026-04-01', 'Duplicate of the w/e 1 April brief (same 30 items)'),
  ('4826adb0-3bae-4193-8e80-18637fefbd45'::uuid, DATE '2026-03-29', DATE '2026-04-01', 'Duplicate of the w/e 1 April brief (same 30 items)'),
  ('4a926734-5109-47c2-b4ad-7d1d19a3e4f1'::uuid, DATE '2026-04-06', DATE '2026-04-09', 'Thin: 1 item'),
  ('350d11a0-e03b-432b-914a-2a08934efa21'::uuid, DATE '2026-04-07', DATE '2026-04-09', 'Thin: 1 item'),
  ('df21285f-4d0e-4e03-a562-dc2bfe2dcd1e'::uuid, DATE '2026-04-23', DATE '2026-04-22', 'Overlaps the w/e 22 April brief (16-23 vs 15-22 April)'),
  ('226697c2-bb50-46f3-9bbf-26fd080785de'::uuid, DATE '2026-04-30', DATE '2026-04-29', 'Thin: 2 items'),
  ('d7f55f3e-c38f-4e7c-9582-3815855c7e76'::uuid, DATE '2026-06-01', DATE '2026-05-28', 'Overlaps the w/e 28 May and 4 June briefs'),
  ('add4b65b-7f8a-4dba-b80f-891bbae57c75'::uuid, DATE '2026-07-30', DATE '2026-07-23', 'Thin: 2 items'),
  ('adf82569-97c1-4101-911d-b322e64626f0'::uuid, DATE '2026-08-06', DATE '2026-08-13', 'Thin: 2 items'),
  ('a138adf3-5ffc-41fb-9d85-a576aa7c2bcd'::uuid, DATE '2026-08-20', DATE '2026-08-23', 'Empty: 0 items'),
  ('ca3b4851-68de-48d7-83f6-dd9ce61c497f'::uuid, DATE '2026-09-10', DATE '2026-09-03', 'Thin: 1 item'),
  ('dd9ac026-e430-48fb-8d28-737ad77c5a9b'::uuid, DATE '2026-09-17', DATE '2026-09-20', 'Empty: 0 items'),
  ('e7fa88eb-e06f-4ab1-b248-8575c896ec37'::uuid, DATE '2026-10-05', DATE '2026-10-08', 'Thin: 2 items')
)
UPDATE weekly_reports w
   SET status = 'withdrawn',
       withdrawn_at = now(),
       withdrawn_reason = p.reason,
       redirect_to = p.redirect_to
  FROM plan p
 WHERE w.id = p.id
   AND w.status = 'published';

SELECT id, week_ending, item_count, status, redirect_to, withdrawn_reason
  FROM weekly_reports
 WHERE status = 'withdrawn'
 ORDER BY week_ending;

-- 13 rows above? COMMIT; otherwise ROLLBACK;
