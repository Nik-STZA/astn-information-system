-- 017: LinkedIn post drafts — the weekly brief distilled to a LinkedIn post.
-- The research agent generates the draft (Gemini, per prompts/weekly-linkedin-post.md)
-- and writes it here; the OS surfaces it for validation, edit, and approval,
-- replacing the Notion LinkedIn Drafts loop.

CREATE TABLE IF NOT EXISTS linkedin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid REFERENCES weekly_reports(id) ON DELETE SET NULL,
  week_ending date,
  post_text text NOT NULL,
  edited_text text,              -- operator's edited version, when present
  char_count integer,
  word_count integer,
  status text NOT NULL DEFAULT 'draft',   -- draft | approved | posted
  generated_by text DEFAULT 'gemini',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_drafts_created ON linkedin_drafts (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON linkedin_drafts TO africastn_app;
