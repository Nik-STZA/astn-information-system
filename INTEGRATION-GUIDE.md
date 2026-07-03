# AfricanSTN OS — Next.js integration guide (v2)

## Overview

This package adds interactive OS modules to the existing `astn-information-system` Next.js app, pulling data from the Cloud Run API at `https://africastn-api-782190795609.europe-west1.run.app`.

All new pages sit under the existing `(app)` route group and are protected by the same Supabase auth + email allowlist.

**v2 changes:** Pages are now interactive with CRUD forms, filtering, sorting, and drill-down panels. A new cross-module Dashboard page provides unified KPIs.

## Files to add/replace

### New files (copy into repo)

| Source file | Repo destination | Notes |
|---|---|---|
| `src/lib/cloud-run.ts` | `src/lib/cloud-run.ts` | API client (unchanged) |
| `src/lib/data/data-protection.ts` | `src/lib/data/data-protection.ts` | Types + fetchers (unchanged) |
| `src/lib/data/compliance.ts` | `src/lib/data/compliance.ts` | Types + fetchers + mutations (unchanged) |
| `src/lib/data/content.ts` | `src/lib/data/content.ts` | Types + fetchers (unchanged) |
| `src/lib/data/pipeline.ts` | `src/lib/data/pipeline.ts` | Types + fetchers + mutations (unchanged) |
| `src/app/(app)/data-protection/page.tsx` | same | **v2:** thin server wrapper |
| `src/app/(app)/data-protection/DataProtectionClient.tsx` | same | **NEW:** interactive client component |
| `src/app/(app)/compliance/page.tsx` | same | **v2:** thin server wrapper |
| `src/app/(app)/compliance/ComplianceClient.tsx` | same | **NEW:** interactive client with CRUD |
| `src/app/(app)/compliance/actions.ts` | same | **NEW:** server actions for mutations |
| `src/app/(app)/content/page.tsx` | same | Server component (unchanged) |
| `src/app/(app)/pipeline/page.tsx` | same | Server component (unchanged) |
| `src/app/(app)/dashboard/page.tsx` | same | **NEW:** cross-module dashboard |

### Files to replace

| Source file | Repo destination | Notes |
|---|---|---|
| `src/components/TopNav.tsx` | same | Adds Dashboard link; brand logo links to /dashboard |

## What's interactive now

### Data protection page
- Search by country name
- Filter by tier (Leader/Advanced/Developing/Nascent/Absent) and DP law status
- Sort columns by clicking headers (country, score, tier, law)
- Click any country row to open a slide-out panel with full maturity breakdown, authority details, law status, and enforcement history

### Compliance page
- Add/edit/delete prospects via modal forms
- Add/edit clients with contact details, service tier, annual fee, engagement tracking
- Log activities against clients (registration, assessment, meeting, etc.)
- Filter by sector, status, priority, or search by company name
- Click a status in the outreach funnel to filter the table
- Click a sector badge to filter
- Tab switcher between Prospects and Clients views

### Dashboard
- Cross-module KPIs: countries, organisations, prospects, active clients, ARR
- Outreach funnel visualisation
- Maturity tier distribution
- Sector breakdown
- Pipeline and content summary with quick-action links

## Environment variable

Already set in Netlify:

```
CLOUD_RUN_API_URL=https://africastn-api-782190795609.europe-west1.run.app
```

## Architecture

```
Browser (Netlify)
  └─ Next.js App Router
       ├─ Supabase Auth (Google OAuth) — existing
       ├─ Supabase Postgres — existing pages (Overview, Registry, Reports)
       └─ Cloud Run API — OS pages (Dashboard, Data Protection, Compliance, Content, Pipeline)
            └─ Cloud SQL PostgreSQL 17 (africastn_os)
```

Server components fetch data at render time with 60s revalidation. Client components handle interactivity. Mutations use Next.js server actions that call the Cloud Run API and revalidate the page cache.

## Deployment steps

1. Copy all new/updated files into the GitHub repo
2. Push to `main` — Netlify auto-deploys
3. Verify at `https://astn-information-system.netlify.app/dashboard`

(CORS patch and env var are already deployed from the previous session.)

---

*Updated 3 July 2026 — v2 interactive upgrade*
