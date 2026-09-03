# CLAUDE.md — AfricanSTN information system

This file gives standing context to Claude Code for every session in this repository. Read it fully before making changes.

## What this project is

The internal operating system for **African Sports Technology Network (AfricanSTN)**, operated by **Sports Tech Africa Limited (STZA)**. A Next.js 14 dashboard, deployed to Cloud Run, authenticated by Google Cloud Identity-Aware Proxy, backed by Cloud SQL for PostgreSQL 17.

It is an **internal-only** tool for a single operator today. It is NOT a licensed or public product. See the "Future considerations" section of README.md before doing anything that would expose data externally — licensed access requires a separate architecture (a separate surface, server-side-only DB access, tiered permissions, auditing, rate limiting) and must not be bolted onto this codebase.

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Google Cloud Identity-Aware Proxy for authentication (see "Authentication" below)
- Cloud SQL for PostgreSQL 17, reached through the Express API on Cloud Run
- Recharts for charts, `docx` for Word generation
- Deployed to Cloud Run service `astn-os` by GitHub Actions from the `main` branch
  of `Nik-STZA/astn-information-system`
- Live at https://os.stza.io

### Styling reality vs the config

Tailwind is installed but barely used. The established pattern is **inline React
style objects reading CSS custom properties** defined in `src/styles/globals.css`
(`var(--pg)`, `var(--pnl)`, `var(--bd)`, `var(--tx)`, `var(--sub)`). Theme
switching sets `data-theme` on `<html>`; the toggle persists to localStorage under
`stza-theme`. There is no shadcn/ui, no Radix and no icon library. Match this
pattern rather than introducing a component library.

## Authentication

The app runs behind Google Cloud Identity-Aware Proxy. IAP authenticates every
request at the load balancer and enforces access via IAM
(`roles/iap.httpsResourceAccessor`). The app trusts the
`x-goog-authenticated-user-email` assertion header.

- `src/lib/auth.ts` — `getIapEmail()` reads and parses the assertion header
- `src/middleware.ts` — rejects any request lacking the header
- `src/app/(app)/layout.tsx` — reads the email for display, redirects to `/blocked`
- Sign-out clears the session at the proxy via `/_gcp_iap/clear_login_cookie`

There is **no Supabase Auth and no Firebase Auth**. IAP IAM is the allowlist.
`ALLOWED_EMAILS` survives in `.env.example` and the deploy config but nothing in
`src/` reads it, and `src/lib/allowlist.ts` no longer exists.

## CRITICAL: database schema facts

These were learned the hard way in production. The Day 1 build assumed column names that did not match the live schema, producing silently-wrong numbers. **Always verify schema against the live database before writing queries.** Query the live database rather than assuming.

Known facts about the `organizations` table (7,003 rows as at 29 July 2026):
- Organisation name column is **`organization_name`**, NOT `name`.
- **`source_confidence`** holds DESCRIPTIVE STRINGS, not enum values. E.g. "High (via governing body listing)", "Medium-Low (Wikipedia)". To filter for High-confidence, use **`ILIKE 'High%'`**, never `= 'High'` (which matches zero rows). About 94 per cent are High.
- **`country`** and **`sport`** are denormalised onto the table as human-readable names, alongside `country_iso` and `sport_code`. Prefer the denormalised `country`/`sport` for display — avoids needing the lookup join.
- There are 55 distinct `country_iso` values (54 sovereign African countries + a pan-African classification) and 81 distinct `sport_code` values.

`lookup_countries` table:
- Country code column is **`iso_code`**, NOT `iso`. Columns: `iso_code`, `name`, `region`, `created_at`.

`classified_items` table (11,903 rows as at 29 July 2026):
- Has **`created_at`** and `classified_at` but **NO `published_at`**. Use `created_at` for ordering recent items.
- ~647 items in the last 7 days at time of writing.
- RLS: a "Nik can do anything" policy keyed on `auth.email() = 'nik@stza.io'`, plus an "Others can see approved items" policy for `status = 'approved'`.

`partnerships` table: ~135 rows.

### Aggregation over large tables
Aggregations that scan the full organizations table (distinct counts, top-N
groupings) run server-side in the Cloud Run API against Cloud SQL, so the old
1,000-row PostgREST cap no longer applies. `src/lib/data/overview.ts` now calls
`cloudRunFetch` rather than a Supabase client.

## Legacy Supabase project

The platform has moved to Cloud SQL. The Supabase project `vjtdcsshsqnmfcftlver`
still holds `dp_jurisdictions` and `dp_editions`; everything else has migrated.
Do not add new tables there. There are no Supabase packages in `package.json`
and no Supabase client files in `src/` any more.

## Architecture conventions

- Authenticated routes live under the `src/app/(app)/` route group, which shares a
  layout that reads the IAP identity and renders the TopNav.
- Auth is enforced in two places (defence in depth): `src/middleware.ts` and the
  `(app)` layout.
- Data-fetching functions live in `src/lib/data/`, and reach the database through
  `src/lib/cloud-run.ts`. **The Next.js app has no database driver.** Every query
  goes through the Express API on Cloud Run with an `X-API-Key` header.
- Navigation is a horizontal grouped top nav in `src/components/TopNav.tsx`
  (Home / Registry / Regulatory / Commercial / Publishing). There is no sidebar.

### Module structure (added July 2026 for the Finance module)

- `src/shared/*` — cross-module foundation, safe to import anywhere
- `src/modules/<name>/*` — self-contained modules, currently `finance`
- A module may import from `src/shared` but never from another module, and never
  from the legacy `src/app`, `src/lib` or `src/components`. Enforced by
  `eslint-plugin-boundaries` in `.eslintrc.json` and gated in CI.
- The four original modules (registry, compliance, publishing) still live in
  `src/app/(app)/` and have not been relocated.

## MCP server (commercial product)

The BYOAI (Bring Your Own AI) commercial product. Lives in `finance-api/mcp-server/`.

- **What it is:** an MCP server that exposes Xero accounting tools so users can connect from Claude Desktop, ChatGPT (via GPT Actions), or Gemini and interact with their books conversationally.
- **Architecture (v0.1):** wraps the finance REST API via HTTP. stdio transport for local Claude Desktop connections. Single-client mode with client slug in env.
- **Architecture (v1.0, planned):** direct Xero access, per-user API keys, SSE transport for remote connections, tier-based tool access.
- **Entry point:** `finance-api/mcp-server/index.js` (ESM, `"type": "module"`)
- **Dependencies:** `@modelcontextprotocol/sdk`, `zod`
- **OpenAPI spec:** `finance-api/mcp-server/openapi.yaml` (OpenAPI 3.1 for ChatGPT/Gemini)
- **Tools (10):** `list_clients`, `list_entities`, `get_trial_balance`, `get_profit_and_loss`, `get_balance_sheet`, `get_bank_summary`, `get_aged_receivables`, `get_aged_payables`, `get_accounts`, and one write tool — `post_journal`.
- **Config env vars:** `STZA_API_URL`, `STZA_ACTOR_EMAIL`, `STZA_CLIENT`. **No API key.** The key is read from Secret Manager (`finance-api-key`) via Application Default Credentials at startup; run `gcloud auth application-default login` once per machine. `STZA_API_KEY` survives as a deprecated fallback and warns when used — it must not be set in normal operation, because a plaintext key in `claude_desktop_config.json` is a second credential holder with write access to client ledgers.
- **`post_journal` invariant:** `approval.presented_text` and `approval.agreed_text` are passed through from the caller verbatim. The tool must **never** compose them — it would be validating the payload against a description of itself. See the block comment above the tool definition and spec §5.
- **Scoping memo:** `outputs/STZA_BYOAI_Architecture_Scoping_Memo_v2.docx`

The MCP server is a separate package from the finance REST API. It has its own `package.json` and `node_modules`. It does NOT share a database connection with the REST API in v0.1 — it makes HTTP calls to the existing API endpoints.

Recovered into version control on 14 August 2026. It had been running from an
untracked directory in a second, stale checkout at `C:\Dev\astn-information-system`
and existed nowhere else. Do not run it from there.

## Brand rules (STZA Brand Guidelines v1.0) — apply everywhere

- **Font:** Manrope, set in `src/styles/globals.css`. (The brand guideline names Calibri; the app shipped with Manrope and has stayed there.)
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
- **Frontend client:** `src/lib/cloud-run.ts` — wraps fetch with API key from the `CLOUD_RUN_API_KEY` env var, injected from Secret Manager. Base URL defaults to `https://africastn-api-782190795609.europe-west1.run.app`.

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
- Migrations are in `migrations/` (003 through 024), applied manually. Note there is no psql or migration runner on the operator machine; use the Cloud SQL Auth Proxy plus a small `pg` script

### Key database tables (Cloud SQL, not Supabase)
These tables power the compliance engine and are separate from the Supabase `organizations`/`classified_items` tables:

- `prospects` — compliance prospect pipeline
- `compliance_clients` — compliance client management. **There is no `clients` table.**
- `compliance_findings`, `compliance_scores` — V1 POPIA analysis results
- `remediation_items` — remediation board (migration 009)
- `audit_log` — compliance audit trail (migration 009)
- `processing_activities`, `special_categories` — ROPA data mapping (migration 010)
- `breach_register`, `breach_tasks` — breach management (migration 011)
- `data_subject_requests` — DSAR tracking (migration 012)
- `compliance_knowledge_base`, `jurisdiction_requirements`, `document_store`, `analysis_runs`, `analysis_findings` — V2 multi-jurisdiction engine (migration 013)

## Build & deploy workflow

### Frontend (Cloud Run)
- `npm run build` locally to verify before committing — catches type errors and server/client boundary violations that only surface at build time.
- Commit to `main`; the `deploy-frontend.yml` workflow builds and deploys Cloud Run service `astn-os`.
- `.gitattributes` forces LF line endings; expect no CRLF warnings.
- After deploy, verify the Overview counters read: Organisations 7,003 / Countries 55 / Sports 81 / Partnerships 135.

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

- The API key (`CLOUD_RUN_API_KEY` / `API_KEY`) must NEVER be committed to git or stored in files that get synced. It lives only in: GCP Secret Manager and the operator's password manager.
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

### STZA Finance Platform — MCP server (August 2026)

**v0.1 (current):** `finance-api/mcp-server/index.js` — 8 read-only Xero tools wrapping the finance REST API. stdio transport. Tested with `@modelcontextprotocol/sdk` v1.x. OpenAPI 3.1 spec at `finance-api/mcp-server/openapi.yaml` for ChatGPT/Gemini integration.

**v1.0 (planned):** Direct Xero access (bypass REST API), per-user API keys, SSE transport, tier-based access, journal posting.

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
- **MCP server v1.0** — direct Xero access (remove REST API dependency), per-user API key auth, SSE transport, `post_journal` tool, `get_invoices`/`get_contacts` tools, tier-based access control.
- **MCP server deploy** — Cloud Run service for the MCP server (SSE transport), API gateway for OpenAPI endpoints.

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
- The frontend and backend are separate Cloud Run services (`astn-os` and `africastn-api`), each with its own GitHub Actions workflow.

