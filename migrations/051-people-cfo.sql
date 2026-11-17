-- 051: the CFO's profile, so his sign-offs and thread entries show his
-- initials (NM) from the first day rather than his email. He can change it
-- later (PUT /api/finance/people/me); this never overwrites a profile he set.
INSERT INTO finance.people (email, kind, display_name, initials, title) VALUES
  ('nik@stza.io', 'person', 'Nik M', 'NM', 'CFO')
ON CONFLICT (email) DO NOTHING;
