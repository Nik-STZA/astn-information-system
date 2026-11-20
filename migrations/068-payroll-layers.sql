-- 068: the layer rules for capitalised development (CFO, 20 Nov 2026).
--
-- Each project (a software layer) can carry a rule: its name, whether it may
-- be capitalised to the software account at all (a tangible memo layer, such
-- as hardware, never is), and the first month it may be (e.g. not until the
-- IP transfers). Confirming a month's shares refuses a share against the
-- rules, and the month's journals show it as an issue. Found when one month
-- put a share on a hardware layer whose capitalisation was blocked.
--
-- { "<project>": { "name": text, "capitalise": bool, "from": "YYYY-MM", "why": text } }
--
-- Needs 065. Idempotent.

SET lock_timeout = '10s';

ALTER TABLE finance.payroll_settings
  ADD COLUMN IF NOT EXISTS layers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE finance.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_layers_check;
ALTER TABLE finance.payroll_settings ADD CONSTRAINT payroll_settings_layers_check CHECK (jsonb_typeof(layers) = 'object');
