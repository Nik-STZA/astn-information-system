# STZA Finance Module — Technical Specification

**Working title:** STZA Finance module (integrated into `os.stza.io`)
**Status:** v0.3 spec — os.stza.io integration + extraction-ready modularity
**Owner:** Nik
**Date:** 2026-05-08 (v0.1) / 2026-07-27 (v0.2) / 2026-07-29 (v0.3)

## Revision log

- **v0.3 (2026-07-29):** Recognised os.stza.io already exists as a working Next.js platform (AfricanSTN registry + POPIA compliance + publishing modules, Firebase-auth-backed, dark/light/auto theme system, sidebar-grouped navigation, shared client entity, Feldspar Sports already a client). Finance is now a **module inside the existing platform**, not a separate app. Added Section 1.6 (integration approach) and Section 15 (extraction-ready architecture) so the Finance module can be lifted out as a standalone product later. Timeline compresses because auth / brand / theme / shell / client entity are already in place.
- **v0.2 (2026-07-27):** Swapped Supabase-based stack for GCP-native equivalents (Cloud SQL, Firebase Auth, Cloud Storage, Cloud Run, Pub/Sub). Added Section 1.5 documenting what is already in place from the Feldspar close pipeline work (so Phase 1 isn't greenfield). Added Master Mapping migration as an explicit phase. Updated ERP adapter §3.3 to note the current `stza-xero` MCP already exposes 40+ operations. Removed reference to Supabase-only pricing tier.
- **v0.1 (2026-05-08):** Initial spec, Supabase-based, five screens, single-user auth, seven-to-nine focused weekends.

## 1.6 os.stza.io integration approach (added 2026-07-29)

os.stza.io is already live and running. It hosts three modules today: **Registry** (AfricanSTN sports tech database), **Regulatory** (POPIA compliance services with kanban pipeline, POPIA representative + data protection knowledge base), and **Publishing** (Review / Briefs / LinkedIn / Content / Reports). Sidebar groups them under Home / Registry / Regulatory / Commercial / Publishing. Client records already sit at `/clients/<slug>` with tabbed detail views. Feldspar Sports already exists as a client in the system.

The Finance module slots in as a **new sidebar section** ("Finance") alongside the existing groups, and as **new tabs on the shared client detail page**. Auth (Firebase, `nik@stza.io` signed in), theme system (Auto / Light / Dark buttons in top nav), sidebar shell, client entity, and brand are all shared and already built.

### What integration means concretely

- New sidebar section **Finance** with items: Approvals · Close · Reports · Xero connections.
- New route `/finance/approvals` — the killer feature. Same shell, section-label-above-page-title pattern ("STZA · FINANCE"), same top nav.
- Extend `/clients/<slug>` detail page with new tabs: **Finance · Close · Approvals · Diary · Open items**. AfricanSTN's existing tabs stay unchanged.
- Feldspar Sports as first client with both AfricanSTN data (existing) and Finance data (new).
- One deploy, one auth, one theme system, one client entity.
- Timeline: **3-5 focused weekends**, not 7-9, because the shell is done.

## 15. Extraction-ready architecture (added 2026-07-29)

**Constraint:** Finance integrates into os.stza.io today, but must be architected so the module can be lifted out as a standalone product later — either as a white-labelled tool licensed to other fractional-FD practices, or as STZA's own commercial SaaS offering separate from AfricanSTN.

To honour this without slowing the build, enforce the following design rules from day one:

### 15.1 Modular monolith structure

```
src/
  shared/            # Cross-module foundation - safe to import anywhere
    layout/          # AppShell, Sidebar, TopNav, ThemeProvider
    auth/            # Firebase Auth wrappers, useUser(), hasRole()
    brand/           # STZA wordmark, palette tokens, config-driven
    ui/              # Buttons, cards, chips, section labels
    clients/         # Shared Client entity + CRUD (name, slug, jurisdiction)
    lib/             # Utilities, types, no domain knowledge
  modules/
    registry/        # AfricanSTN registry (existing)
    compliance/      # AfricanSTN POPIA (existing)
    publishing/      # AfricanSTN content (existing)
    finance/         # NEW - self-contained
      pages/         # /finance/* routes
      api/           # /api/finance/* handlers
      components/    # ApprovalCard, WipDetail, XeroConnectPanel
      lib/           # Domain logic, ERP adapter interface
      db/            # Schema migrations, queries scoped to finance.*
      config/        # Feature flags, module-local settings
```

**Enforced rule:** modules never import from each other. `finance/*` can import from `shared/*`, never from `registry/*` or `compliance/*` or `publishing/*`. ESLint boundary rule to enforce.

### 15.2 Database schema separation

Postgres schemas namespace the tables:

- `shared.*` — `clients`, `users`, `audit_log`
- `registry.*` — AfricanSTN organisations, sports, partnerships
- `compliance.*` — POPIA prospects, IO registrations, DSARs
- `finance.*` — wip_items, diary_entries, recurring_tasks, ap_invoices, bank_transactions, journals, entities, chart_of_accounts_mapping

Extraction = dump `shared.*` + `finance.*` schemas, load into new database.

### 15.3 Shared client entity as the seam

`shared.clients` holds core fields (id, name, slug, jurisdiction, status). Each module attaches its own client-specific config in its own schema:

- `compliance.client_popia_config` (client_id FK)
- `finance.client_finance_config` (client_id FK, accounting_system_config jsonb, close_cadence, materiality_thresholds)

Neither module reads the other's config table. Client detail page composes tabs from all modules that have data for this client.

### 15.4 Auth abstraction

Cloud Run and Next.js API routes depend on an interface:

```ts
interface AuthProvider {
  getCurrentUser(): Promise<User | null>
  requireUser(): Promise<User>
  hasRole(role: string): Promise<boolean>
  hasClientAccess(clientId: string): Promise<boolean>
}
```

Firebase implementation lives in `shared/auth/firebase.ts`. If a licensed customer wants Okta / Auth0 / Cognito, swap the implementation, Finance code untouched.

### 15.5 Brand shell as a wrapper

`shared/layout/AppShell` reads `shared/brand/config.ts` for wordmark, palette, sidebar sections. Environment variable `BRAND_CONFIG` can point at a different config file for white-label:

- STZA: `stza.brand.ts` → STZA® wordmark, black + gold, "An STZA platform" subtitle
- White-label: `<practice>.brand.ts` → their wordmark, their palette

Finance module never hard-codes the STZA colour or wordmark; always reads from brand tokens.

### 15.6 Feature flags per module

`FEATURES=registry,compliance,publishing,finance` in env. Sidebar renders only the modules listed. Extraction target = `FEATURES=finance` only, everything else invisible.

### 15.7 API namespacing

Every Finance route lives under `/api/finance/*`. Registry lives under `/api/registry/*`. No handler ever cross-calls into another module. Modules communicate only via shared client entity or via emitted domain events on Pub/Sub.

### 15.8 Deploy paths

The modular structure supports three deploy shapes without rewrites:

| Deploy | FEATURES | Domain | Users |
|---|---|---|---|
| Today | `registry,compliance,publishing,finance` | `os.stza.io` | STZA (Nik + team) |
| Tomorrow — STZA standalone Finance offering | `finance` | e.g. `finance.stza.io` or `<practice>.io` | Licensed fractional-FD practices |
| Tomorrow — AfricanSTN spin-out | `registry,compliance,publishing` | e.g. `africanstn.com/os` | AfricanSTN team, independent from Finance |

Extraction is a config + DB-schema-dump operation, not a code rewrite. That's the value of the constraint applied from day one.

## 1. Goal

A single internal web (and eventually mobile) application for STZA to manage all client finance work and the agent hierarchy that performs it. Built and owned by STZA — not a configured off-the-shelf product, not a SaaS for others.

The portal is a **view and control layer** over the file-based agent system in `C:\Users\yogim\STZA Group\clients\`. The agents continue to read and write markdown / CSV / spreadsheet artefacts in those folders; the portal mirrors that state into a queryable database, presents it cleanly, and lets the CFO act (approve / reject / send back) from anywhere.

The portal must integrate with **whichever accounting system the client runs** — Xero (already done via the stza-xero MCP for Feldspar), QuickBooks Online, Sage (50/200/Intacct), NetSuite, FreeAgent, and others as encountered. ERP integration sits behind a single adapter interface so adding a new system is a contained piece of work, not a structural rewrite.

The killer-feature shape for v1 is: see every client's state at a glance, get a push notification when work hits the CFO approval queue, tap once to approve, agents proceed — regardless of which accounting system underpins the client.

## 1.1 North star

Every design decision is judged against two outcomes:

- **Quick close.** Each client's month-end runs to completion in days, not weeks. The portal exists to compress the close cycle by giving the CFO a single approval surface, eliminating context-switching between clients, and surfacing blockers the moment they appear rather than at the end.
- **Always current.** The state shown in the portal reflects the live ledger. Direct ERP integration (Xero today, others next) means TBs, balances, contacts, and transactions are pulled live; nothing waits on a manual export. When something changes in the source ledger, the portal sees it within minutes.

A successful v1 is one where Nik can run the Feldspar Sport Group close in a measurable fraction of the time it takes today, and where the answer to "where are we on Acme's close right now?" is always one click away — never a dig through email, Drive, or Xero tabs.

## 1.5 What is already in place (added 2026-07-27)

Between v0.1 and v0.2 of this spec, the file-based Feldspar close pipeline has advanced materially. The portal is now a **view / control layer over a working system**, not a companion to something being built in parallel.

Currently working (in `C:\Users\yogim\STZA Group\clients\feldspar-sport-group\` and `C:\Users\yogim\Feldspar_Project\XERO REPORTING\`):

- **`stza-xero` MCP server** exposing 40+ Xero operations as tools: trial balance pulls, journal posting, contact + invoice + bank transaction + manual journal reads, account transaction detail, aged payables / receivables, bank balances.
- **`monthly_close.py` orchestrator** running the pack build as a five-stage pipeline (raw pack -> finalize -> Group BvA -> Dashboard -> Supplier Spend) with strict-mode verification, em-dash sweep and materiality thresholds pulled from `configs/assumptions.json`.
- **Excel management pack** with Contents, Dashboard (KPIs + waterfall + Op Cost Breakdown + Compliance strip + Actions strip + CFO Commentary), Group P&L / BS / CFS, per-entity P&L / BS / CFS, AP Aging, Supplier Spend, Intercompany, Mapping Gaps, Balance Control, Group BvA. Formula-driven for auditability.
- **PPTX board pack** auto-generated from the same JSON commentary + dashboard data. Variance commentary paginates dynamically across slides.
- **FC agent workflow** running via Cowork sessions: pulls supplier detail, drafts CFO commentary in plain English with no individual names, runs new-supplier scan, resolves account codes against Master Mapping, flags anomalies.
- **File-based agent artefacts** — `diary/YYYY-MM.md`, `open-items.md`, `reconciliations/*.md`, `policies/capitalisation-policy.md` — that the portal will mirror to the database.
- **CLAUDE.md rules (12 hard rules)** enforced across every Cowork session for Feldspar work.
- **Master Mapping CSV** (`Master Mapping as at <date>.csv`) with 170+ account codes mapped to P&L category / sub-category / BS category. Currently a flat CSV; migrating to Cloud SQL table is a Phase 1 task.

What this means for the build phases (see §10 updated):

- Phase 1 seeds Cloud SQL from the existing file artefacts rather than starting empty.
- Phase 2 renders what already exists rather than requiring the CFO to input it.
- Phase 3 (approval flow) is where the real net-new UX work lives.
- The ERP adapter interface (§3.3) is already backed by working code for Xero — the interface just needs formalising.

## 2. Non-goals (v1)

- No client-facing portal. That's v2 — separate auth scope, separate UI, read-only slices.
- No team members beyond Nik. Auth is single-user. Multi-user with RLS comes when STZA hires.
- No replacement of the file-based agent system. The agents continue to operate on `clients/<slug>/` markdown files; the portal layers on top.
- No native mobile app. Mobile-responsive web + PWA (installable, push notifications) is v1; native via React Native / Expo only if PWA limits become real.

## 3. Architecture

Three planes, same shape as the system already in place plus a new view layer.

```
┌─────────────────────────────────────────────┐
│  Agent plane                                │
│  C:\Users\yogim\STZA Group\clients\<slug>\  │
│  markdown / CSV / spreadsheets / WIP / posted│
│  Read and written by Cowork agents          │
└────────────────────┬────────────────────────┘
                     │
              file watcher (Node + chokidar)
              two-way sync via Cloud Run
                     │
┌────────────────────▼────────────────────────┐
│  Database plane                             │
│  Cloud SQL for PostgreSQL 15+               │
│  Mirror of file state + portal-only data    │
│  (auth mapping, push subscriptions, audit log)│
│  Firestore for realtime listeners           │
└────────────────────┬────────────────────────┘
                     │
              Cloud Run REST + Firestore
              live subscriptions
                     │
┌────────────────────▼────────────────────────┐
│  Portal plane                               │
│  Next.js (App Router) on Netlify or Cloud Run│
│  Firebase Auth (Google SSO + magic link)    │
│  Web (desktop + mobile responsive)          │
│  PWA-installable with push notifications    │
│  Anthropic SDK for portal-triggered agents  │
└─────────────────────────────────────────────┘
```

### 3.1 Sync strategy

The file system is the source of truth for agent work. The database mirrors it. Two-way sync because the portal needs to *initiate* state changes (approve a WIP item, write a diary entry) and have those flow back into the file system that the agents read on the next session.

A small **file watcher service** (Node, run locally on Nik's machine or a small VM) uses `chokidar` to watch `clients/`. Changes in markdown files / WIP folder structure / diary entries are pushed to Supabase via the REST API. When the portal triggers an action (e.g., approve a WIP item), it calls a Netlify Function that:

1. Updates the database (status change, audit log entry).
2. Writes the corresponding artefacts back into the file system via a separate sync API or a queue the watcher consumes.
3. Triggers any side effects (e.g., calling the stza-xero MCP to actually post a journal once approved).

For v1, run the watcher locally. For v2, move it to a small always-on VM (Hetzner, Fly.io, or similar) so the portal works even when Nik's laptop is asleep.

### 3.2 Why this shape

- The agents stay where they are, with their existing file-based contract. No churn to the v0.4.0 plugin.
- The portal is fast and queryable because it reads from Postgres, not from disk.
- Real-time updates are free via Supabase's realtime subscriptions.
- Auth, file storage, and edge functions all come from Supabase — one platform.

### 3.3 ERP integration layer

STZA's clients run on different accounting systems. The portal and agents talk to a single **ERP adapter interface** rather than to any specific system. One adapter per supported system; adding a new system is a contained piece of work, not a structural rewrite.

```
┌──────────────────────────────────────────────┐
│  Portal / Agents                             │
│  Use a normalised model: entities, accounts, │
│  contacts, transactions, journals, balances  │
└────────────────────┬─────────────────────────┘
                     │
              ERPAdapter interface
                     │
       ┌─────────────┼──────────────┬────────┐
       ▼             ▼              ▼        ▼
  XeroAdapter  QuickBooksAdapter  SageAdapter  ...
  (stza-xero   (stza-qb MCP +     (stza-sage   future
   MCP +        OAuth)             MCP +        adapters
   OAuth)                          API)
```

**Common adapter interface (TypeScript shape):**

```ts
interface ERPAdapter {
  // Connection
  authenticate(config: object): Promise<AuthResult>
  isConnected(): Promise<boolean>

  // Reads
  listEntities(): Promise<Entity[]>
  getChartOfAccounts(entityId: string): Promise<Account[]>
  getTrialBalance(entityId: string, asOf: Date): Promise<TrialBalance>
  getAccountBalance(entityId: string, accountCode: string, asOf: Date): Promise<Balance>
  listContacts(entityId: string, type: 'vendor' | 'customer'): Promise<Contact[]>
  listTransactions(entityId: string, params: TxQuery): Promise<Transaction[]>

  // Writes (CFO-approved only — see approval flow)
  createContact(entityId: string, contact: ContactInput): Promise<Contact>
  postJournal(entityId: string, journal: JournalInput): Promise<JournalResult>
  createInvoice(entityId: string, invoice: InvoiceInput): Promise<InvoiceResult>
  createCreditNote(entityId: string, creditNote: CreditNoteInput): Promise<CreditNoteResult>

  // Capability flags
  capabilities(): AdapterCapabilities
}
```

Each adapter handles its own auth flow (OAuth 2.0 typically), API mechanics, rate limiting, and **shape normalisation** — translating between the portal's normalised model and the ERP's specific data shapes. The adapter is responsible for exposing what the ERP can and can't do via `capabilities()`, so the portal can hide or disable features for adapters that don't support them (e.g., a manual / spreadsheet adapter has read-only capability).

**v1 supported adapters:** Xero only (already in flight via `stza-xero` MCP and used for Feldspar). The pattern is in place from day one but only one adapter is implemented.

**Roadmap, in priority order based on STZA's likely client mix:**

| Adapter | Priority | Notes |
|---|---|---|
| Xero | v1 | Done. UK + ANZ + global. |
| QuickBooks Online | v2 | Most common second; very common for US clients and increasingly UK micro-SMEs. |
| Sage 50 / Sage 200 | v2 | Common in UK mid-market. Sage 50 is desktop-only and harder; Sage 200 has cloud API. |
| FreeAgent | v3 | UK micro / freelancer market. |
| Sage Intacct | v3 | UK mid/upper-market and US. |
| NetSuite | v3 | If STZA picks up larger clients. |
| Manual / spreadsheet | always available | For clients where direct integration isn't viable; read-only ingest of CSV TBs and journal exports. |

Each adapter is roughly "an evening to a weekend" once the pattern is established. Auth is the variable — Xero, QBO, Sage Intacct all use OAuth 2.0; Sage 50 needs a desktop bridge; FreeAgent has its own quirks.

**Where adapters live:**

- **Read-side adapters** (TB pulls, account balances, contact listings) are called from the portal directly via Netlify Functions, with credentials stored encrypted in Supabase.
- **Write-side adapters** (post journal, create contact, create invoice) are called only after CFO approval, from the same Netlify Functions, and produce a confirmation that becomes part of the WIP audit trail.
- **Agent-side**, the existing MCP pattern continues — `stza-xero` MCP, future `stza-qb` MCP, etc. Agents and portal use the same adapter logic underneath; the MCP is just the surface the agents see.

## 4. Stack (v0.2 - GCP-native)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript | Familiar from stza.io / africanstn.com. Strong AI-pair-programming support. |
| Styling | Tailwind CSS + shadcn/ui | Owned components, infinitely customisable. Palette per `feldspar_style.py` (Mineral Blue / Flare / Frost / Metal). |
| Hosting | Netlify (frontend) + Cloud Run (backend services) | Netlify remains for the Next.js app; backend services (file watcher, sync, ERP writes) move to Cloud Run so nothing depends on Nik's laptop. |
| Database | Cloud SQL for PostgreSQL 15+ | Managed Postgres on GCP. Same SQL schema as the v0.1 spec; different vendor. Automated backups + point-in-time recovery. |
| Auth | Firebase Auth (with Google SSO + email link) | Free tier covers v1 single-user. Ready for multi-user + custom claims (role-based) in v2. Firebase Admin SDK for token verification in Cloud Run. |
| Realtime | Firestore listeners (portal-only slice) | Cloud SQL is the source of truth; Firestore mirrors the small "live state" slice (pending counts, WIP status changes) so the portal streams updates without polling. |
| Storage | Cloud Storage | For artefact uploads (vendor invoices, supplier statements) with signed URLs; lifecycle policy for retention. |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) via Cloud Run | Portal-triggered agent calls (e.g. "summarise this WIP") run in a Cloud Run service with the API key in Secret Manager. |
| File watcher | Node + chokidar in a Cloud Run job (v1: local, v2: cloud) | v1 runs on Nik's machine writing to Cloud SQL via a Cloud Run REST endpoint. v2 moves to a Compute Engine micro-VM or Cloud Run job with a mounted volume once the shared drive lives in Cloud Storage. |
| PWA | next-pwa | Installable on iOS/Android, push notifications via Web Push API. |
| Push | Firebase Cloud Messaging (FCM) via Cloud Functions or Web Push | Dispatches push notifications when a `pending-cfo/` event lands. FCM handles iOS + Android; Web Push covers desktop browsers. |
| Secrets | Secret Manager | Xero client_secret + refresh tokens, Anthropic API key, HMRC OAuth, Google service accounts. |
| Data warehouse (Master Mapping etc) | Cloud SQL reference tables + Firestore for CFO-editable config | Master Mapping migrates off the CSV / Google Sheet into a `chart_of_accounts_mapping` table with an admin UI for edits. |

## 5. Data model

Tables in Postgres. All have `id` (uuid), `created_at`, `updated_at` unless stated.

### 5.1 Core entities

```sql
clients (
  id uuid pk,
  slug text unique,           -- e.g. 'feldspar-sport-group'
  name text,                  -- e.g. 'Feldspar Sport Group'
  framework text,             -- 'FRS 102', 'IFRS', 'US GAAP'
  year_end date,
  jurisdiction text,
  vat_regime text,
  status text,                -- 'active', 'paused', 'offboarded'
  folder_path text,           -- absolute path to clients/<slug>/
  created_at, updated_at
)

entities (
  id uuid pk,
  client_id uuid fk → clients,
  name text,
  legal_name text,
  accounting_system text,     -- 'xero', 'quickbooks', 'sage_50', 'sage_200', 'sage_intacct', 'netsuite', 'freeagent', 'kashflow', 'pandle', 'manual'
  accounting_system_config jsonb,  -- adapter-specific: Xero { config_name, tenant_id }; QuickBooks { realm_id, company_id }; etc.
  role text,                  -- 'Holding', 'Operating', 'Trading', 'Dormant'
  folder_path text,
  created_at, updated_at
)

users (
  id uuid pk,
  email text unique,
  full_name text,
  role text,                  -- 'CFO', 'FC', 'FM1', 'FM2', 'AP Clerk', 'AR Clerk', 'Tax Mgr', 'FP&A Mgr'
  push_subscription jsonb,    -- web push subscription
  active boolean,
  created_at, updated_at
)
```

### 5.2 Agent activity

```sql
agents (
  id uuid pk,
  name text,                  -- friendly name, optional ('Sam')
  role text,                  -- 'AP Clerk', 'FM2', etc.
  config_path text,           -- path to agent .md in plugin
  active boolean,
  created_at, updated_at
)

diary_entries (
  id uuid pk,
  client_id uuid fk → clients,
  occurred_at timestamptz,
  role text,                  -- which agent role
  agent_name text,            -- optional friendly name
  action text,                -- short verb-led description
  where_path text,            -- file path / folder reference
  status text,                -- 'Drafted', 'Awaiting review', 'Returned', 'Escalated', 'Approved', 'Posted'
  notes text,
  source_file text,           -- which diary/YYYY-MM.md file this came from
  source_line int,            -- line number in source file
  created_at
)
```

### 5.3 Work in progress

```sql
wip_items (
  id uuid pk,
  client_id uuid fk → clients,
  entity_id uuid fk → entities (nullable for cross-entity items),
  type text,                  -- 'ap', 'ar', 'vat', 'month-end', 'reconciliation', 'tax', 'fpa'
  tier text,                  -- which tier currently owns it
  status text,                -- 'wip', 'pending-fc', 'pending-cfo', 'sent-back', 'approved', 'posted', 'archived'
  folder_path text,           -- clients/<slug>/.../wip/<type>/<batch>/
  drafter_role text,
  current_reviewer_role text,
  title text,                 -- e.g. "AP batch 2026-05-08 (12 invoices, £18,420.50)"
  amount_total numeric,       -- if monetary
  created_at, updated_at
)

wip_review_log (
  id uuid pk,
  wip_id uuid fk → wip_items,
  reviewer_role text,
  outcome text,               -- 'Approved', 'Sent back', 'Conditional approval'
  findings jsonb,             -- structured list of findings
  notes text,
  next_step text,
  reviewed_at timestamptz,
  created_at
)
```

### 5.4 Operational tracking

```sql
recurring_tasks (
  id uuid pk,
  client_id uuid fk → clients,
  task text,
  category text,              -- 'Bank', 'AP', 'AR', 'Month-end', 'VAT', 'Payroll', 'Treasury', 'Reporting', 'Tax', 'Admin'
  frequency text,             -- 'one-off', 'daily', 'weekly', 'monthly', 'quarterly', 'annual'
  scope text,                 -- 'in-scope', 'out-of-scope'
  tier text,                  -- which agent tier
  est_minutes int,
  last_actual_minutes int,
  status text,                -- 'todo', 'in-progress', 'done', 'blocked'
  last_run_at timestamptz,
  next_due_at timestamptz,
  notes text,
  created_at, updated_at
)

backlog_items (
  id uuid pk,
  client_id uuid fk → clients,
  task text,
  category text,
  suggested_tier text,
  scope text,
  notes text,
  added_at timestamptz,
  created_at, updated_at
)

out_of_scope_items (
  id uuid pk,
  client_id uuid fk → clients,
  task text,
  category text,
  frequency text,
  time_spent_minutes int,
  status text,                -- 'Logging', 'Raised', 'Quoted', 'Accepted', 'Declined', 'Handed back'
  raised_at timestamptz,
  notes text,
  created_at, updated_at
)
```

### 5.5 Reference data

```sql
vendors (
  id uuid pk,
  client_id uuid fk → clients,
  entity_id uuid fk → entities,
  name text,
  service text,
  gl_code text,
  last_seen_invoice_ref text,
  notes text,
  created_at, updated_at
)

external_events (
  id uuid pk,
  client_id uuid fk → clients,
  event_type text,            -- 'bank-payment-refused', 'customer-dispute', 'supplier-price-change', 'regulator-letter', 'board-meeting', 'contract-signed'
  description text,
  occurred_at timestamptz,
  materiality text,           -- 'low', 'medium', 'high'
  source text,                -- 'diary', 'manual', 'email', etc.
  created_at
)
```

### 5.6 Portal-only

```sql
audit_log (
  id uuid pk,
  user_id uuid fk → users,
  action text,                -- 'approve_wip', 'reject_wip', 'send_back', 'edit_recurring_task', 'manual_diary_entry'
  target_type text,           -- 'wip_item', 'recurring_task', etc.
  target_id uuid,
  payload jsonb,
  occurred_at timestamptz
)

push_events (
  id uuid pk,
  user_id uuid fk → users,
  event_type text,            -- 'approval_needed', 'sent_back', 'external_event_high_materiality'
  payload jsonb,
  delivered boolean,
  delivered_at timestamptz,
  created_at
)
```

## 6. API surface

Implemented as Next.js App Router route handlers (which deploy as Netlify Functions). All authenticated via Supabase Auth.

### 6.1 Read endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/dashboard` | Cross-client state: per-client counts of pending-cfo / pending-fc / sent-back / overdue tasks |
| GET | `/api/clients` | Client list with status badges |
| GET | `/api/clients/:slug` | Full client detail: entities, recurring tasks, backlog, out-of-scope, recent diary |
| GET | `/api/clients/:slug/diary?from=&to=` | Diary entries for a date range |
| GET | `/api/clients/:slug/wip?status=` | WIP items filtered by status |
| GET | `/api/wip/queue?tier=cfo` | Approval queue across all clients |
| GET | `/api/wip/:id` | Single WIP item + review log + folder contents |
| GET | `/api/agents/activity?from=&to=` | Agent activity feed across all clients |

### 6.2 Action endpoints

| Method | Path | Effect |
|---|---|---|
| POST | `/api/wip/:id/approve` | Move folder to `posted/`, write diary entry, trigger Xero post if applicable |
| POST | `/api/wip/:id/reject` | Move folder to `sent-back/`, write rejection in `review.md`, write diary entry |
| POST | `/api/wip/:id/send-back` | Send back to a specific tier with findings; populate `review.md` |
| POST | `/api/clients/:slug/recurring-tasks/:id` | Update a recurring task (status, actual minutes, notes) |
| POST | `/api/clients/:slug/diary` | Manual diary entry (CFO direct action) |
| POST | `/api/clients` | Create a new client (clones the `_template/` folder, runs `new-client-setup` skill) |

### 6.3 Webhooks

| Method | Path | Source |
|---|---|---|
| POST | `/api/sync/file-changed` | File watcher service — payload describes the changed path and event type (created/updated/moved/deleted) |
| POST | `/api/sync/diary-entry` | File watcher — new diary entry parsed |
| POST | `/api/sync/wip-state` | File watcher — WIP folder moved between status directories |

## 7. Screens (v1)

Five screens. Mobile-responsive from day one.

### 7.1 Dashboard

The home screen. One row per active client. Each row shows:

- Client name + small logo / avatar
- State badge: **Clean** / **Items pending** / **Action needed**
- Counts: pending-CFO (red dot if > 0), pending-FC, sent-back, overdue recurring tasks
- Last-activity timestamp

Clicking a row opens the **Client view**. A persistent "Approval queue" link in the top nav goes straight to the cross-client approval queue.

### 7.2 Client view

Tabs:

- **Overview** — pulled from the client's `CLAUDE.md`. Group structure, business context, jurisdiction, key contacts.
- **Recurring tasks** — table view of `recurring_tasks` with inline editing for status / actual minutes / notes.
- **Backlog** — `backlog_items` table.
- **Out-of-scope** — `out_of_scope_items` table.
- **WIP** — current WIP items by tier, click to drill into the WIP detail.
- **Diary** — chronological feed of diary entries, filterable by month / role / status.
- **Entities** — per-entity drill-down (Xero IDs, COA, entity-specific WIP).

### 7.3 Approval queue

The most-used screen. Lists every WIP item in `pending-cfo/` across all clients, newest first.

Each item card shows:

- Client + entity
- Type (AP batch, VAT return, journal, etc.)
- Title and amount
- Chain of `review.md` entries (collapsible)
- Three big buttons: **Approve**, **Send back**, **Reject**
- Tap card to open WIP detail with the actual artefacts

### 7.4 WIP detail

The drill-down for one WIP item.

- Artefacts list — links to the underlying spreadsheet / CSV / evidence files
- Inline preview where possible (read-only Excel / CSV viewer)
- Full review chain — every reviewer's findings
- Action buttons (same as approval queue card)
- "Send back" requires picking which tier and writing findings before submission

### 7.5 Agent activity feed

Chronological stream of agent actions across all clients. Filterable by client / role / action type / time range. Each entry shows the diary entry plus links back to the artefact and the WIP item.

### 7.6 Settings

- Profile (Nik) — email, push notifications, time zone
- Clients — add / archive
- Agents — list with active toggles (read-only of plugin definitions)
- Xero connections — list of configured tenant IDs and last-pulled time
- File watcher — status (running / disconnected) and last sync time

## 8. Auth model

**v1**: single user (Nik). Supabase Auth with Google SSO or magic link. Sessions persisted, no logout pressure.

**v2 (team)**: add roles (CFO / FC / FM2 / Clerk). RLS policies on all tables filter by role and by client assignment. CFO sees everything; lower tiers see only their assigned clients.

**v3 (clients)**: separate auth scope for client-portal users. Clients see only their own data via a different application (subdomain or section).

## 9. Mobile (PWA)

Ship the v1 web app with PWA capabilities from day one:

- `manifest.json` with STZA branding, app icons, splash screens
- Service worker for offline caching of dashboard / client view
- Web Push API integration for approval notifications
- Install prompts on iOS Safari and Android Chrome

Push flow: when the file watcher detects a folder move into `pending-cfo/`, it calls a Netlify Function which records a `push_events` row and dispatches via Web Push to Nik's registered devices. Tapping the notification deep-links into the WIP detail screen.

iOS PWA push support shipped in iOS 16.4 (March 2023) and is solid. Android has full support. If push proves unreliable on iOS, add an SMS fallback via Twilio for high-materiality items.

## 10. Build phases (v0.2 - reflects existing state)

| Phase | Outcome | Duration estimate |
|---|---|---|
| 0. Spec + decisions | This document, signed off | Done |
| 0.5. GCP project setup | Cloud SQL instance, Firebase Auth, Cloud Storage bucket, Cloud Run enabled, Secret Manager populated with existing credentials. `os.stza.io` DNS pointed at Netlify + auth callback URLs configured. | half weekend |
| 1. Scaffold + DB + Master Mapping migration | `npx create-next-app@latest stza-ops --typescript --tailwind --app`; deploy hello-world to Netlify; run Cloud SQL migrations for schema in §5; write `chart_of_accounts_mapping` table + one-shot Python script that reads the current Master Mapping CSV into it. | 1 weekend |
| 2. Import script + read-only dashboard | Python script parses `clients/feldspar-sport-group/*.md` (diary, open-items, reconciliations) into Cloud SQL rows. Dashboard + Client view read from DB. Same script becomes the file-watcher core in Phase 4. | 1 weekend |
| 3. ERP adapter interface | Formalise the existing `stza-xero` MCP behind an `ERPAdapter` TypeScript interface (§3.3). Portal pulls Feldspar TBs and balances live through the interface. Existing MCP tools reused unchanged. | half weekend |
| 4. File watcher (local) | Node + chokidar service running on Nik's machine. Watches `STZA Group/clients/`, pushes changes to Cloud SQL via Cloud Run REST endpoint. | 1 weekend |
| 5. Approval flow + write-side ERP | Approval queue + WIP detail screens, action endpoints, two-way sync, write-side ERP calls (Xero journal post via existing MCP). This is the killer-feature phase. | 1-2 weekends |
| 6. PWA + push (FCM) | next-pwa manifest, service worker, Firebase Cloud Messaging integration. iOS + Android + desktop push covered. | 1 weekend |
| 7. Agent activity feed + filters | Activity feed screen, filtering, links back to source artefact. | half weekend |
| 8. Polish + new-client wizard | Settings screens, new-client wizard that clones `_template/` and seeds DB rows, error states. | 1 weekend |
| 9+ (post-v1) | File watcher migration to Cloud Run / Compute Engine; second ERP adapter (QuickBooks Online); Sage 200 adapter. | 1 weekend per adapter |

Realistic v1 timeline (Xero only, single adapter): **7-9 focused weekends** building it yourself with Claude as pair-programmer. The existing Feldspar file structure + `stza-xero` MCP means Phases 1-3 have real code to lean on rather than building from scratch.

## 11. Open decisions

These need answering before or during phase 1:

1. **File watcher hosting** — local on Nik's laptop (works only when laptop on) vs Cloud Run job with mounted volume vs Compute Engine micro-VM (£5-10/month). Recommend: local for v1, Cloud Run job for v2 once daily-use proves out the architecture. Migrating the shared drive to Cloud Storage is a parallel decision.
2. **Domain** — `os.stza.io` (aligns with what Nik already refers to as "the stza os") or `ops.stza.io`. Recommend: `os.stza.io` — it signals the broader "operating system for STZA's practice" rather than a narrow ops tool. Pick early so Firebase Auth callbacks are stable.
3. **Auth provider** — Google SSO only, magic link only, or both? Recommend: Firebase Auth with Google SSO primary + email link as fallback.
4. **Anthropic API integration depth in v1** — does the portal trigger Claude API calls itself (e.g., a "summarise this WIP" button), or is Claude usage limited to Cowork sessions? Recommend: minimal in v1 (single "Ask Claude about this WIP" panel that hits Cloud Run + Anthropic SDK), add specific buttons as workflows demand.
5. **Where do uploads go?** — Documents (vendor invoices, supplier statements) uploaded via the portal: Cloud Storage with signed URLs, or written to the local file system via the watcher? Recommend: Cloud Storage as primary with a copy synced to the file system on approval. Once the shared drive itself lives in Cloud Storage (v2), this collapses to one location.
6. **State of the v0 sync** — for the initial seed of Feldspar data, run a one-time import script. Same script becomes the foundation of the watcher. Feldspar file structure is stable enough that the parser is straightforward (diary is `## 2026-06-02 - CFO` blocks; open-items is a markdown table; reconciliations follow the pattern in `bs-recon-styling` skill).
7. **Backup strategy** — Cloud SQL has automated backups + PITR. File system: `STZA Group/` folder should be in a backed-up location (OneDrive / Dropbox / Google Drive) regardless. Once shared-drive migrates to Cloud Storage in v2, this consolidates.
8. **Second ERP adapter** — what's the most-likely second client accounting system STZA will need to integrate? Drives which adapter to build after Xero. Recommend: pick based on the next signed client; if no specific trigger, default to QuickBooks Online (broadest market coverage and cleanest OAuth 2.0 story after Xero).
9. **Write-side approval coupling** — when the CFO taps Approve in the portal, does the write to the ERP happen synchronously (user waits, sees confirmation, full audit) or asynchronously (queued via Pub/Sub, status updates via FCM push)? Recommend: synchronous for v1 — fewer edge cases, immediate feedback. Move to async only if API rate limits or long-running posts make it painful.
10. **Master Mapping surface** — the CSV migrates to a Cloud SQL table. Question: does the portal expose a UI for editing it (add a code, change a mapping, tag a code as capex/BS/P&L) or does it stay CSV-editable and re-imported? Recommend: read-only in v1 (change the CSV, re-run the import script), admin UI in v2.
11. **Client-facing portal (v2) — brand strategy** — when we open the client-facing slice in v2, does it live on `os.stza.io/clients/<slug>` or on a separate subdomain like `<slug>.stza.io` or on the client's own domain? Drives auth architecture. Recommend: `os.stza.io/clients/<slug>` for v2, migrate to per-client subdomains only if branding demands it.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| File watcher disconnects, portal goes stale | Health-check ping every 30s; surface "Sync down" banner in portal; status visible in Settings |
| Sync conflicts (file edited locally and via portal simultaneously) | Last-write-wins by default; full audit log so conflicts are inspectable. Optimistic locking for high-stakes actions (approvals) |
| Push notifications unreliable on iOS | SMS fallback for `pending-cfo/` events |
| Agents change file structure unexpectedly | Watcher logs unrecognised file events; portal surfaces them in a "needs attention" queue rather than silently ignoring |
| Supabase or Netlify outage | Both have strong uptime; the file system stays the source of truth so agents can keep working until services return |

## 13. Out of scope for this spec

- Time tracking and billing (could integrate FreeAgent / similar later)
- Engagement letter management
- Document collection from clients (deferred to v2 client portal)
- Multi-currency / FX (current scope is GBP-only per Feldspar; revisit with first non-UK client)
- Reporting / KPI dashboards beyond simple state badges
- Native iOS / Android apps via React Native

## 14. Next steps

1. Read this spec end-to-end. Mark sections to revise.
2. Answer the open decisions in Section 11.
3. Pick the build kickoff session date.
4. Phase 1 starting point: `npx create-next-app@latest stza-ops --typescript --tailwind --app`, set up Supabase project, paste the schema in Section 5, deploy hello-world to Netlify.

The spec lives at `C:\Users\yogim\STZA Group\portal\spec.md`. Edit freely — this document is the source of truth for the build.
