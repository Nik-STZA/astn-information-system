-- 063-pack-commentary.sql
--
-- Each month's management pack commentary, held in os.stza.io instead of
-- files on the drive and a Word round trip (lib/pack-commentary.js).
--
--   finance.pack_commentary           the month's highlights (words beside
--                                     figures) and dashboard (figures), as
--                                     the pack build reads them; draft or approved
--   finance.pack_commentary_versions  every saved version, kept; append-only
--
-- An agent (FP&A, FC) or a person drafts; only the CFO approves; the pack
-- build takes only an approved month. Changing an approved month makes it a
-- draft again, at the next version.
--
-- Additive and re-runnable. No DELETE grant: a month's commentary is replaced
-- by a new version, never removed.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS finance.pack_commentary (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  period       text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind         text NOT NULL CHECK (kind IN ('highlights', 'dashboard')),
  content      jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- A person's email, agent:fpa or agent:fc.
  updated_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  approved_by  text,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period, kind),
  CONSTRAINT pack_commentary_approved_by CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS finance.pack_commentary_versions (
  id             bigserial PRIMARY KEY,
  commentary_id  uuid NOT NULL REFERENCES finance.pack_commentary (id) ON DELETE CASCADE,
  version        integer NOT NULL,
  content        jsonb NOT NULL,
  status         text NOT NULL,
  -- What happened: imported, edited, approved.
  action         text NOT NULL CHECK (action IN ('imported', 'edited', 'approved')),
  changed_paths  text[] NOT NULL DEFAULT '{}',
  note           text,
  saved_by       text NOT NULL,
  run_id         uuid,
  saved_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pack_commentary_versions ON finance.pack_commentary_versions (commentary_id, saved_at DESC);

COMMENT ON TABLE finance.pack_commentary IS
  'Monthly management pack commentary (highlights, dashboard). Drafted by agents or people, approved by the CFO, read by the pack build.';

GRANT SELECT, INSERT, UPDATE ON finance.pack_commentary TO africastn_app;
GRANT SELECT, INSERT ON finance.pack_commentary_versions TO africastn_app;
GRANT USAGE, SELECT ON SEQUENCE finance.pack_commentary_versions_id_seq TO africastn_app;
