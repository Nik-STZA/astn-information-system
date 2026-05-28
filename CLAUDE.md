# CLAUDE.md — AfricanSTN information system

This file gives standing context to Claude Code for every session in this repository. Read it fully before making changes.

## What this project is

The internal operating system for **African Sports Technology Network (AfricanSTN)**, operated by **Sports Tech Africa Limited (STZA)**. A Next.js 14 dashboard, deployed to Netlify, authenticated via Supabase Auth with Google OAuth, backed by a Supabase Postgres database.

It is an **internal-only** tool for a single operator today. It is NOT a licensed or public product. See the "Future considerations" section of README.md before doing anything that would expose data externally — licensed access requires a separate architecture (a separate surface, server-side-only DB access, tiered permissions, auditing, rate limiting) and must not be bolted onto this codebase.

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase Auth (Google OAuth provider) + Supabase Postgres via PostgREST
- `@supabase/ssr` (browser + server clients are in separate files — see below)
- Recharts for charts, `docx` for Word generation
- Deployed on Netlify from the `main` branch of `Nik-STZA/astn-information-system`
- Live at https://astn-information-system.netlify.app

## CRITICAL: database schema facts

These were learned the hard way in production. The Day 1 build assumed column names that did not match the live schema, producing silently-wrong numbers. **Always verify schema against the live database before writing queries.** Use the Supabase MCP or a quick query rather than assuming.

Known facts about the `organizations` table (~6,983 rows):
- Organisation name column is **`organization_name`**, NOT `name`.
- **`source_confidence`** holds DESCRIPTIVE STRINGS, not enum values. E.g. "High (via governing body listing)", "Medium-Low (Wikipedia)". To filter for High-confidence, use **`ILIKE 'High%'`**, never `= 'High'` (which matches zero rows). 6,543 of 6,983 (93.7%) are High.
- **`country`** and **`sport`** are denormalised onto the table as human-readable names, alongside `country_iso` and `sport_code`. Prefer the denormalised `country`/`sport` for display — avoids needing the lookup join.
- There are 55 distinct `country_iso` values (54 sovereign African countries + a pan-African classification) and 81 distinct `sport_code` values.

`lookup_countries` table:
- Country code column is **`iso_code`**, NOT `iso`. Columns: `iso_code`, `name`, `region`, `created_at`.

`classified_items` table (~6,417 rows):
- Has **`created_at`** and `classified_at` but **NO `published_at`**. Use `created_at` for ordering recent items.
- ~647 items in the last 7 days at time of writing.
- RLS: a "Nik can do anything" policy keyed on `auth.email() = 'nik@stza.io'`, plus an "Others can see approved items" policy for `status = 'approved'`.

`partnerships` table: ~135 rows.

### The 1,000-row PostgREST limit
The Supabase JS client returns a maximum of 1,000 rows per query by default. Any aggregation that scans the full organizations table (distinct counts, top-N groupings) MUST paginate past this limit or use a HEAD `count`, otherwise it silently sees only the first 1,000 rows and returns wrong numbers. See `fetchAllColumnValues` in `src/lib/data/overview.ts` for the pagination pattern. For large-scale aggregation, prefer a Postgres RPC.

## Supabase project

- Project ref: `vjtdcsshsqnmfcftlver`
- URL: `https://vjtdcsshsqnmfcftlver.supabase.co`
- Auth uses the **legacy anon key** (the `eyJ...` JWT), not the new `sb_publishable_` format, because the pinned SDK version expects the legacy format. Migrate to publishable keys only alongside an SDK update.

### Deployment settings that must stay correct (these have broken before)
- Supabase Auth → URL Configuration → **Site URL** must be `https://astn-information-system.netlify.app` (it defaulted to `http://localhost:3000`, which broke sign-in — symptom was "localhost refused to connect" after Google auth).
- Redirect URLs must include `https://astn-information-system.netlify.app/auth/callback` and `http://localhost:3000/auth/callback`.
- Supabase Auth → Providers → Google must be **enabled** with Client ID and Secret present (symptom when off: "provider is not enabled").
- Netlify env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_EMAILS` (currently `nik@stza.io`).

## Architecture conventions

- **Browser vs server Supabase clients are in separate files** and must stay separate (Next.js forbids mixing `next/headers` server imports into client components):
  - `src/lib/supabase-browser.ts` — `createSupabaseBrowserClient()` for client components
  - `src/lib/supabase-server.ts` — `createSupabaseServerClient()` for server components and route handlers
- Authenticated routes live under the `src/app/(app)/` route group, which shares a layout enforcing the auth + allowlist check and rendering the TopNav.
- Auth is enforced in two places (defence in depth): `src/middleware.ts` and the `(app)` layout.
- Allowlist check is in `src/lib/allowlist.ts`, reading the `ALLOWED_EMAILS` env var.
- Data-fetching functions live in `src/lib/data/`.

## Brand rules (STZA Brand Guidelines v1.0) — apply everywhere

- **Font:** Calibri, with fallback chain `'Calibri', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`.
- **Colours** (defined as Tailwind tokens in `tailwind.config.ts` and CSS vars in `globals.css` — always reference the token, never hard-code a hex):
  - Brand Dark `#1A1C1E`, Brand Gold `#C5A059`, Warm Grey `#8E9196`, Near Black `#0F1113`, Warm Light `#F5F0E8`, Gold Border `#D4C5A9`, Alert Red `#CC0000`, Warning Amber `#CC7700`, Success Green `#2E7D32`.
- **Naming:** "African Sports Technology Network" on first reference (login/hero only), "AfricanSTN" everywhere else. **Never** "ASTN" (that is the Australian network).
- **Writing:** sentence case for headings; hyphens not em dashes; dates as "27 May 2026" (no ordinals); numbers with comma thousand separators via `toLocaleString('en-GB')`; Oxford comma.
- Confidence pills: High → green, Medium → amber, Medium-Low/Low → red. Derive the band by prefix-matching the descriptive `source_confidence` string.

## Build & deploy workflow

- `npm run build` locally to verify before committing — catches type errors and server/client boundary violations that only surface at build time.
- Commit to `main`; Netlify auto-deploys in ~90 seconds.
- `.gitattributes` forces LF line endings; expect no CRLF warnings.
- After deploy, verify the Overview counters read: Organisations 6,983 / Countries 55 / Sports 81 / Verified at High 93.7% / Partnerships 135 / Items this week ~647.

## Roadmap (see scoping memo for detail)

- **Day 1 (done):** scaffold, auth, overview page, registry + reports skeletons.
- **Day 1 fix (apply if not yet live):** the six schema fixes above, to `overview.ts`, `registry/page.tsx`, `RecentItemsFeed.tsx`.
- **Day 2:** registry browser — filter bar (country/sport/type/confidence), pagination, click-through to `/registry/[id]` detail page, edit form with save-back to Supabase.
- **Day 3:** profile report builder (templated Word doc population).
- **v1.1+:** Claude-powered registry assistant and narrative reports; filtered + snapshot exports; verification-queue workflow.

## Reference documents (in the STZA shared drive, not the repo)

- `AfricanSTN_Information_System_Scoping_Memo_v1.docx` — full v1 scope, page specs, build sequence.
- `STZA_AfricanSTN_Licensed_Access_Architecture_Considerations_v1.docx` — read before any external-access work.
- `AfricanSTN_Database_Audit_v1_2.docx` — the registry's contents and provenance.
- STZA Brand Guidelines v1.0 — the full brand system.

## Working style for Claude Code in this repo

- Verify schema before writing queries. Do not assume column names.
- Run `npm run build` before committing; show diffs before committing.
- Keep the brand tokens centralised; never hard-code colours.
- When unsure about a schema detail, query the live database rather than guessing — the cost of a wrong assumption here is silent wrong data in production, which is worse than a loud error.

