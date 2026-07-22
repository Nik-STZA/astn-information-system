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

## Cloud Run API (backend)

The frontend talks to a separate Express API running on Cloud Run. This is NOT part of the Next.js app — it is a standalone Node.js server in the `deploy/` directory.

### API architecture
- **Entry point:** `deploy/server.js` — Express app with pg Pool connecting to Cloud SQL (PostgreSQL 17).
- **Route files:** 8 modular route files live in the repo root and must be copied into `deploy/` before deploying. `deploy/server.js` loads them via `require()`:
  - `server-listing-routes.js` — `/api/countries`, `/api/maturity`, `/api/enforcement`, `/api/sports`, `/api/organizations`
  - `server-pipeline-routes.js` — `/api/prospects`, prospect CRUD
  - `server-client-management-routes.js` — `/api/compliance/clients`, client CRUD, tabs (breaches, processing activities, special categories)
  - `server-agent-routes.js` — `/api/compliance/clients/:id/analyze`, AI-powered POPIA analysis
  - `server-remediation-routes.js` — `/api/compliance/clients/:id/remediation`, remediation board CRUD
  - `server-processing-routes.js` — processing activities and special categories CRUD
  - `server-dsar-routes.js` — `/api/compliance/clients/:id/dsars`, data subject access request CRUD
  - `server-compliance-v2-routes.js` — V2 multi-jurisdiction analysis: document ingest, knowledge base, assessment runs
- **Auth:** `X-API-Key` header checked against `API_KEY` env var. The key is stored in GCP Secret Manager (secret name: `api-key`), NOT in code.
- **Frontend client:** `src/lib/cloud-run.ts` — wraps fetch with API key from `CLOUD_RUN_API_KEY` Netlify env var. Base URL defaults to `https://africastn-api-782190795609.europe-west1.run.app`.

### GCP project
- Project ID: `africanstn-research`, project number: `782190795609`
- Region: `europe-west1`
- Cloud Run service: `africastn-api`
- Cloud SQL instance: `africastn-db` (PostgreSQL 17)
- Service account for GitHub Actions: `github-deploy@africanstn-research.iam.gserviceaccount.com`
- Workload Identity Federation pool: `github-pool`, provider: `github-provider`

### Database (Cloud SQL)
- DB name: `africastn_os`, user: `africastn_app`
- Password stored in GCP Secret Manager (secret name: `db-password`)
- Migrations are in `migrations/` (003 through 013), applied manually via psql or the Supabase MCP

### Key database tables (Cloud SQL, not Supabase)
These tables power the compliance engine and are separate from the Supabase `organizations`/`classified_items` tables:

- `prospects` — compliance prospect pipeline
- `clients`, `client_contacts` — compliance client management
- `compliance_findings`, `compliance_scores` — V1 POPIA analysis results
- `remediation_items` — remediation board (migration 009)
- `audit_log` — compliance audit trail (migration 009)
- `processing_activities`, `special_categories` — ROPA data mapping (migration 010)
- `breach_register`, `breach_tasks` — breach management (migration 011)
- `data_subject_requests` — DSAR tracking (migration 012)
- `compliance_knowledge_base`, `jurisdiction_requirements`, `document_store`, `analysis_runs`, `analysis_findings` — V2 multi-jurisdiction engine (migration 013)

## Build & deploy workflow

### Frontend (Netlify)
- `npm run build` locally to verify before committing — catches type errors and server/client boundary violations that only surface at build time.
- Commit to `main`; Netlify auto-deploys in ~90 seconds.
- `.gitattributes` forces LF line endings; expect no CRLF warnings.
- After deploy, verify the Overview counters read: Organisations 6,983 / Countries 55 / Sports 81 / Verified at High 93.7% / Partnerships 135 / Items this week ~647.

### Backend (Cloud Run) — CI/CD via GitHub Actions
- **Workflow file:** `.github/workflows/deploy-cloud-run.yml`
- **Triggers:** push to `main` when changes touch `deploy/**`, `server-*-routes.js`, or the workflow file itself.
- **What it does:** checks out code → copies `server-*-routes.js` from repo root into `deploy/` → authenticates via Workload Identity Federation (keyless, no JSON keys) → deploys to Cloud Run using source-based build.
- **Required GitHub repo secrets:**
  - `WIF_PROVIDER`: `projects/782190795609/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
  - `WIF_SERVICE_ACCOUNT`: `github-deploy@africanstn-research.iam.gserviceaccount.com`
- **Manual deploy alternative:** from repo root, run `deploy/deploy.sh` (bash) or the equivalent PowerShell commands — see script for details.

### CRITICAL: route file copy step
The 8 `server-*-routes.js` files live in the repo root (for easy editing) but `deploy/server.js` loads them via `require()` from its own directory. They MUST be copied into `deploy/` before any deploy. The GitHub Actions workflow and `deploy.sh` both handle this automatically. If you deploy manually without copying, the API will crash on startup with `MODULE_NOT_FOUND` errors and the frontend's Data Protection, Jurisdictions, and Compliance pages will break.

## Security constraints

- The API key (`CLOUD_RUN_API_KEY` / `API_KEY`) must NEVER be committed to git or stored in files that get synced. It lives only in: Netlify env vars, GCP Secret Manager, and the operator's password manager.
- `DB_PASSWORD` is a GCP Secret Manager reference, not a plain-text env var.
- `ANTHROPIC_API_KEY` has been removed from the Cloud Run service — the V2 analysis engine does not currently call Claude.
- Tests must not depend on a working Anthropic API key.

## What has been built (as of July 2026)

### Frontend pages (Next.js, under `src/app/(app)/`)

| Route | What it does |
|---|---|
| `/overview` | Dashboard with org/country/sport counts from Supabase |
| `/registry` | Organisation registry browser with filters, pagination, detail view, edit form |
| `/registry/[id]` | Organisation detail + profile report (Word export) |
| `/data-protection` | Data protection landscape — country tracker, maturity scores, enforcement data (from Cloud Run API) |
| `/data-protection/jurisdictions` | Multi-jurisdiction browser with side panel drilldown |
| `/data-protection/editions` | AfricanSTN weekly edition content management |
| `/pipeline` | Prospect pipeline (compliance services sales funnel) |
| `/compliance` | Compliance services hub — client list, V1 and V2 assessments |
| `/compliance/client/[id]` | Full client workspace with tabs: Overview, Findings, Data Mapping, Special Categories, Breaches, Remediation, DSARs, Audit Trail |
| `/compliance/assessment/[id]` | V1 POPIA assessment report (printable) |
| `/compliance/assessment-v2/[id]` | V2 multi-jurisdiction assessment report |
| `/compliance/jurisdictions` | Knowledge base browser — jurisdictions and requirements |
| `/clients` | Client management with edit modal, CRUD |
| `/dashboard` | Secondary dashboard view |
| `/content` | Content/article management |
| `/reports` | Report generation tools |

### Compliance engine (two versions)

**V1 (POPIA-only):** Single-jurisdiction analysis. Scrapes a company's website, identifies privacy policy and terms, analyses against POPIA requirements, produces findings with severity scores, generates a compliance radar chart and executive summary. Supports remediation board, breach register, DSAR tracking, ROPA export.

**V2 (multi-jurisdiction):** Extends V1 with a knowledge base architecture. Supports POPIA (South Africa) and UAE PDPL. Document ingest pipeline with content hash deduplication. Knowledge base stores jurisdiction requirements. Assessment runs produce findings mapped to specific requirements.

**Known V2 limitations:**
- The pipeline constructs URLs by guessing from `client.company_website` (appends `/privacy`, `/privacy-policy`, `/terms`). It does NOT use the `privacy_policy_url` or `terms_url` fields from the prospect record. This should be fixed.
- No frontend UI for uploading documents directly (e.g., PAIA manuals). The API supports it via `POST /api/compliance/clients/:clientId/documents/ingest` with a `documents` array parameter, but the frontend only sends `urls`.
- Content hash deduplication means re-ingesting identical content is silently skipped — re-running an assessment without new content produces no changes.

## Pending work and known issues

### Immediate (blocking)
1. **GitHub Actions secrets not yet added** — `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` must be added to GitHub repo settings (Settings → Secrets and variables → Actions). Values are in the "Required GitHub repo secrets" section above.
2. **API_KEY not yet in GCP Secret Manager** — needs to be created via `gcloud secrets create api-key --data-file=- --replication-policy="automatic"`. The workflow references it as `API_KEY=api-key:latest`.
3. **First deploy needed** — the workflow file exists but hasn't been pushed to `main` yet. Once secrets are set and the file is pushed, the first automated deploy will fix the broken Data Protection and Jurisdictions pages.

### Feature backlog
- **Document upload UI** — frontend needs a way to upload documents (PAIA manuals, custom URLs) for V2 compliance analysis. API supports it, frontend doesn't expose it.
- **V2 pipeline should use prospect URL fields** — `privacy_policy_url` and `terms_url` from prospects should feed into the V2 pipeline rather than just guessing from `company_website`.
- **Prospect-to-client conversion** — UX improvement to bridge or combine Compliance Services and Clients sections, reducing clicks.
- **Registry assistant** — Claude-powered natural language query over the organisation registry.
- **Narrative reports** — AI-generated country profile reports.

## Reference documents (in the STZA shared drive, not the repo)

- `AfricanSTN_Information_System_Scoping_Memo_v1.docx` — full v1 scope, page specs, build sequence.
- `STZA_AfricanSTN_Licensed_Access_Architecture_Considerations_v1.docx` — read before any external-access work.
- `AfricanSTN_Database_Audit_v1_2.docx` — the registry's contents and provenance.
- STZA Brand Guidelines v1.0 — the full brand system.
- `STZA_DPO_Engagement_Risk_Assessment.docx` — risk assessment for offering DPO/advisory services.
- `STZA_POPIA_Engagement_Scope.docx` — template engagement scope for compliance advisory.

## Working style for Claude Code in this repo

- Verify schema before writing queries. Do not assume column names.
- Run `npm run build` before committing; show diffs before committing.
- Keep the brand tokens centralised; never hard-code colours.
- When unsure about a schema detail, query the live database rather than guessing — the cost of a wrong assumption here is silent wrong data in production, which is worse than a loud error.
- When modifying route files, remember they must exist both in the repo root AND be copied to `deploy/` for the API to work. The CI/CD pipeline handles this, but manual deploys require the copy step.
- The frontend and backend are separate deployments. Frontend changes deploy via Netlify on push. Backend changes deploy via GitHub Actions (or manually via `deploy.sh`).

