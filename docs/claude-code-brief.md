# Claude Code brief — build the STZA Finance module inside os.stza.io

**Recipient:** Claude Code, working in a session with the os.stza.io codebase mounted
**Owner:** Nik Mladenovic (CFO, STZA)
**Date drafted:** 2026-07-29
**Status:** ready for implementation

---

## 1. Context in one paragraph

`os.stza.io` is a live Next.js platform already running three modules for STZA (Registry / Regulatory / Publishing, all AfricanSTN-focused). Feldspar Sport is already a client record in the system with POPIA compliance tabs. In parallel, a separate Python codebase (`stza-xero-reporting`) has built a working monthly-close pipeline for Feldspar: Xero MCP server, `monthly_close.py` orchestrator, formula-driven Excel management pack, PPTX board pack, FC-agent-drafted CFO commentary. **Your job is to add a fourth module — Finance — to os.stza.io that surfaces this work in the browser, gives Nik a mobile-first approval queue, and does so under an extraction-ready architecture so the module can be lifted out as a standalone product later.**

## 2. What already exists (read before touching)

**os.stza.io codebase** — pattern reference. Study the following before writing any Finance code:
- Sidebar structure: sections grouped as Home / Registry / Regulatory / Commercial / Publishing. Finance slots in as a fifth section.
- Top nav pattern: Auto / Light / Dark theme buttons, user chip, sign-out link.
- Section-label-above-page-title pattern (e.g. "AFRICANSTN · REGULATORY" → "Compliance services").
- Client detail page at `/clients/<slug>` with tabbed sub-nav (existing tabs: Engagements / Pipeline / IO registrations / Data mapping / Special categories / Tasks / Remediation / DSARs / Correspondence / Breaches). Finance adds new tabs on this same page structure — do not build a separate client page.
- Firebase Auth (Nik signed in as `nik@stza.io`) — already wired.
- Theme system (Auto / Light / Dark) — already wired. Do not rebuild.

**External Python codebase** — `C:\Users\yogim\Feldspar_Project\XERO REPORTING\` (mirrored to shared drive). Do NOT rewrite; call from Node via subprocess or HTTP if you need to invoke a monthly close from the portal. Key entry points:
- `xero-server.py` — MCP server exposing 40+ Xero operations (`get_invoices`, `get_bank_transactions`, `get_manual_journals`, `post_journal`, `pull_trial_balance`, `get_account_transactions`, etc). Wrap these behind the `ERPAdapter` TypeScript interface (see spec §3.3).
- `scripts/monthly_close.py` — 5-stage pipeline. Portal can trigger it via a Cloud Run job or subprocess; do not port to Node.
- `configs/highlights_<YYYY-MM>.json` — CFO-curated per-month commentary and status data. Portal reads/writes this.

**Client artefact folders** — `C:\Users\yogim\STZA Group\Clients\feldspar-sport-group\` (mirrored). Contains `diary/YYYY-MM.md`, `open-items.md`, `reconciliations/*.md`, `policies/*.md`. File watcher (Phase 4) mirrors these into Cloud SQL; portal reads mirror.

**Reference documents** — read in this order before starting:
1. `portal/spec.md` (v0.3+) — authoritative technical spec, all decisions live here
2. `portal/claude-code-brief.md` — this document
3. `portal/stza_ops_approval_queue_wireframe.html` (delivered separately, in outputs folder) — visual reference for the Approvals page. Look, don't copy verbatim.
4. `XERO REPORTING/CLAUDE.md` — rules governing the Feldspar close pipeline (rules #8-12 in particular apply to any commentary the portal displays)

## 3. Goal

Ship a working Finance module that lets Nik, from a browser or phone, run the STZA fractional-FD service across all his clients. Success looks like:

- Nik opens `os.stza.io/finance/clients/feldspar-sport-group/approvals` on his phone at 6am
- Sees four items awaiting his decision in the right-hand panel stack
- Taps one, reviews context in the detail pane, taps Approve
- The action writes back to the file system, updates Cloud SQL, and (for journal / VAT / AP items) calls the Xero adapter to post to the ledger
- Push notification confirms
- Nik moves to next item

Everything else — dashboards, close orchestration, reports, diary — is scaffolding around that core loop.

## 4. Non-goals for v1

- Client-facing UI (v2, per spec §8)
- Multi-user, roles, RLS enforcement beyond `hasClientAccess()` scaffolding (v2)
- Native mobile app (PWA suffices per spec §9)
- Second ERP adapter (v2+)
- Reporting UI beyond a simple archive of past packs
- Master mapping admin UI beyond read-only (v2)

## 5. Architecture — modular monolith, extraction-ready

Enforced from day one. Written up in spec §15; summarised here:

```
src/
  shared/            ← may be imported from any module
    layout/          AppShell, Sidebar, TopNav, ThemeProvider, ClientHeader
    auth/            useUser(), requireUser(), hasClientAccess() — Firebase wrappers behind interface
    brand/           STZA wordmark, palette tokens (BRAND_CONFIG-driven)
    ui/              Buttons, cards, chips, section labels, tabs, glyphs
    clients/         Shared Client entity (name, slug, jurisdiction, status)
    lib/             utilities, types, no domain knowledge
  modules/
    registry/        ← existing (AfricanSTN registry)
    compliance/      ← existing (AfricanSTN POPIA)
    publishing/      ← existing (AfricanSTN content)
    finance/         ← NEW — build this
      pages/         Next.js routes under /finance/*
      api/           API handlers under /api/finance/*
      components/    ApprovalCard, WipDetail, StatePanels, ClientHeader-Finance, XeroConnectionsPanel, etc
      lib/           Domain logic — ERPAdapter interface, WIP state machine
      db/            Cloud SQL migrations, queries — all scoped to schema `finance.*`
      config/        Feature flags, module-local settings
```

**Enforced rule:** `finance/*` may import from `shared/*` but never from `registry/*`, `compliance/*`, or `publishing/*`. Add an ESLint boundary rule (`eslint-plugin-boundaries` or `eslint-plugin-import` with `no-restricted-paths`) to fail CI on violations.

**Postgres schemas:** `shared.*`, `registry.*`, `compliance.*`, `finance.*`. Extraction = dump `shared.*` + `finance.*`, load into new database. Confirm CREATE SCHEMA migration lands in Phase 1.

**Auth abstraction:** All Finance code depends on `shared/auth/AuthProvider` interface, not on Firebase primitives. Firebase implementation lives in `shared/auth/firebase.ts`.

**Feature flags:** `FEATURES=registry,compliance,publishing,finance` in env. Sidebar renders only listed modules. Extraction target = `FEATURES=finance` only.

## 6. Routes and pages to build

### 6.1 Sidebar section

Add to the existing sidebar (below Publishing):

```
Finance                    NEW badge
  Overview                 /finance/overview
  Clients (n)              /finance/clients — LANDING when Finance section is clicked
```

That is the entire top-level Finance section. All client-sensitive setup (Xero, chart of accounts, per-client settings) lives INSIDE each client — never at practice level.

### 6.2 Client-scoped tabs

For each client, add these tabs to `/clients/<slug>` alongside the existing POPIA tabs. Group visually with a divider between Work and Setup clusters:

**Work cluster:**
- `/finance/clients/<slug>/approvals` — Approvals (default landing when clicking a client from Finance)
- `/finance/clients/<slug>/close` — Close status
- `/finance/clients/<slug>/reports` — Pack + PPTX archive
- `/finance/clients/<slug>/diary` — Diary
- `/finance/clients/<slug>/open-items` — Open items

**Setup cluster (all client-scoped):**
- `/finance/clients/<slug>/xero` — Xero connections (masked secrets)
- `/finance/clients/<slug>/coa` — Chart of accounts + master mapping overrides
- `/finance/clients/<slug>/settings` — Client-specific finance config

### 6.3 Overview page

`/finance/overview` — cross-client summary for Nik. Small: KPI tiles per client (pending count, blocked count, cash headline, last close status), clickable to drill in. Non-invasive.

## 7. Approvals page — the primary work surface

This is the killer feature. See the wireframe HTML for visual reference. Behavioural spec:

**Layout:** two-pane grid, 1fr + 380px right.

**Left pane (default state):** activity list grouped by day (Today / Yesterday / Earlier this week). Each row: state glyph + entity tag + type tag + title (with strong emphasis on the noun) + amount + timestamp. Grouped chronologically.

**Left pane (on click of any row):** transforms to detail view. Back link at top returns to list. Detail shows: tags row (entity + type + priority), title, amount row with age, meta grid (drafted by / entity / blocks / related items), review chain (styled block, one row per reviewer with role + note), artefacts list (filename + size + last-modified), action buttons (Approve / Send back / Reject / Open in Xero).

**Right pane:** 5 always-visible state panels stacked vertically:

| Panel | Glyph | What lives here |
|---|---|---|
| Awaiting decision | ● gold filled | Pending-CFO items. P1/SLA-breach at top of panel. Ball in your court. |
| Blocked on external | ○ empty circle | HMRC callback, HSBC statement, CEO sign-off, counterparty waiting |
| In progress upstream | ↳ turn arrow | With FC / FM / clerk, they're reworking |
| Upcoming | ▲ triangle | Deadlines this week / next |
| Activity | · small dot | Background events (bank sync, journal posted, external event) |

Each panel row is a slim 3-col grid: entity tag + title + amount/meta. Click any row (in either pane) → left pane transforms to detail. Selection state syncs across both panes.

**Every item belongs to exactly one panel** (state, not category). Panel = filtered subset of the full activity list. Same rule as Gmail multi-inbox.

**Counts on the panel header pill** — Awaiting decision count is gold (attention); others are muted grey.

## 8. Behavioural specs — apply to every screen

### 8.1 Sidebar — collapse / expand

- Default: expanded (220px wide, section labels + full item names + badges visible)
- Collapsed state: 52px wide, section labels hidden, only icons + tooltips on hover
- Toggle: small chevron button at bottom of sidebar (`◀` when expanded, `▶` when collapsed) + keyboard shortcut `[`
- Preference persists per user (localStorage or user setting)

### 8.2 Client header — sticky

- The client header strip (name / picker / meta row / tab bar) stays pinned when the content below scrolls
- Uses `position: sticky; top: <topnav height>`
- Applies platform-wide, not just Finance — retrofit Compliance / Clients / other client-detail pages while you're at it (out of scope if too invasive; note as follow-up if you defer)

### 8.3 Reveal-toggle for sensitive fields

Any field carrying a client secret (Xero client secret, refresh token, HMRC OAuth token, any API key) must follow this pattern:

```
[label]                   ••••••••••••••••••••   [👁 reveal]   [🔄 rotate]   [copy]
```

Rules:
- Masked by default on page load
- Click 👁 reveals for 10 seconds then auto-hides
- Click copy copies unmasked value to clipboard without visually revealing
- Rotate triggers server-side token refresh where applicable (Xero refresh flow)
- Every reveal + rotate + copy writes an entry to `finance.audit_log` — user, action, target, timestamp, IP
- Never log the unmasked value; never put it in a URL query string
- Applies to any future integration screen (QuickBooks, Sage, HubSpot, etc)

### 8.4 Theme

Use the existing `ThemeProvider` in `shared/layout`. Auto / Light / Dark buttons in top nav, mirrored to `data-theme` attribute on `<html>`. Finance uses the STZA palette from `shared/brand/config.ts` — black + STZA gold `#DDB959`, minimal advisory-firm aesthetic. See wireframe for reference styling.

### 8.5 Glyphs

Use a small consistent icon set from `shared/ui/glyphs` (SVG or Lucide react-icons). No emoji in production UI. If Lucide covers everything cleanly, use it and set the base stroke width consistently across the module.

## 9. Phase-by-phase task breakdown

### Phase 0.5 — GCP + Firebase Auth verify (half weekend)

- Confirm Cloud SQL instance running with PostgreSQL 15+. Create schemas: `shared`, `registry`, `compliance`, `publishing`, `finance` if not present.
- Confirm Firebase Auth signed-in state includes `nik@stza.io` and any custom claims needed.
- Populate Secret Manager with the Xero client secrets + refresh tokens for Feldspar's three entities (UDL / FSL / FGH). Never commit these to repo.
- Add `FEATURES` env var to Netlify + Cloud Run configs.
- Add ESLint boundary rule (`eslint-plugin-boundaries`) to enforce no cross-module imports. Confirm CI fails on a test violation.

### Phase 1 — Scaffold + Master Mapping migration (1 weekend)

- Create `src/modules/finance/` directory structure per §5 above.
- Register the Finance module in the sidebar config (`shared/layout/Sidebar` reads a modules registry that includes Finance).
- Write SQL migrations under `modules/finance/db/migrations/` for the core tables (see spec §5.1-5.6). Wrap them in the `finance` schema.
- Write a one-shot Python migration (or Node script) that reads `Master Mapping as at <date>.csv` and populates `finance.chart_of_accounts_mapping`. Idempotent, re-runnable.
- Deploy hello-world Finance page at `/finance/overview` — just renders "Finance module active" + module version. Confirm it appears in the sidebar and routes correctly.
- Acceptance: navigate to `/finance/overview`, see the placeholder page. `SELECT * FROM finance.chart_of_accounts_mapping LIMIT 5;` returns rows.

### Phase 2 — File watcher + import script + read-only dashboard (1 weekend)

- Write a Python (or Node) script that parses `clients/feldspar-sport-group/*.md` (diary, open-items, reconciliations) and inserts rows into `finance.diary_entries`, `finance.open_items`, etc.
- Same script becomes the file watcher's core parser. For v1, run the watcher locally on Nik's machine (Node + chokidar); calls a Cloud Run endpoint to push changes to Cloud SQL.
- Build `/finance/clients/feldspar-sport-group/diary` and `/finance/clients/feldspar-sport-group/open-items` — read-only rendering of DB rows.
- Acceptance: any change in a local markdown file within a few seconds appears in Cloud SQL and the portal.

### Phase 3 — ERPAdapter interface + Xero adapter wrapper (half weekend)

- Define TypeScript `ERPAdapter` interface per spec §3.3.
- Implement `XeroAdapter` that wraps the existing `stza-xero` MCP tools (via HTTP or subprocess call to the Python MCP server, hosted on Cloud Run). Reads only in this phase.
- Build `/finance/clients/feldspar-sport-group/xero` — shows Xero connection status for each of Feldspar's three entities (UDL, FSL, FGH). Displays tenant IDs, last refresh, token expiry. Client Secret and Refresh Token fields follow the reveal-toggle pattern (§8.3).
- Acceptance: opening the Xero page shows all three Feldspar tenants with green "Connected" status, tokens masked, reveal + copy + rotate buttons all functional.

### Phase 4 — Approvals page (the killer feature) (1-2 weekends)

- Build the two-pane Approvals layout per §7 and the wireframe.
- Data source: `finance.wip_items` table populated by the file watcher (each `pending-cfo/` folder becomes a WIP row).
- Left pane defaults to activity list; on row click transforms to detail view. State persists in URL query param.
- Right pane 5 state panels; counts computed from `finance.wip_items` grouped by state.
- Detail view shows review chain from `finance.wip_review_log`, artefacts from linked storage (Cloud Storage signed URLs for now; file system paths in v1 local mode).
- Action buttons — Approve / Send back / Reject:
  - Approve: writes `finance.audit_log`, moves the WIP folder from `pending-cfo/` to `posted/`, calls `XeroAdapter.postJournal()` if the WIP is a journal/AP/VAT type, updates `finance.wip_items.status`.
  - Send back: prompts for which tier to route back to + findings text, moves folder to `sent-back/<tier>/`, populates `review.md` in the folder.
  - Reject: writes audit log, moves to `rejected/`, no Xero write.
- Keyboard shortcuts: `J`/`K` next/previous row, `A` approve, `S` send back, `R` reject, `O` open detail, `Escape` back to list.
- Acceptance: with 4 seeded WIP items in `pending-cfo/`, the page renders correctly, clicking Approve on the VAT return item triggers a Xero call and moves the folder.

### Phase 5 — PWA + push (1 weekend)

- Add `manifest.json` with STZA branding, install icons, splash screens.
- Service worker for offline caching of Approvals + Overview shells.
- Firebase Cloud Messaging integration — server dispatches a push notification when a new item lands in `pending-cfo/` (via file watcher → Cloud Run → FCM).
- Tapping notification deep-links to `/finance/clients/<slug>/approvals?item=<id>`.
- Acceptance: install PWA on Nik's phone; new WIP appearing on his laptop triggers a phone notification within 30 seconds; tap opens the correct item.

### Phase 6 — Client picker, remaining tabs, overview, polish (1 weekend)

- Client picker component in the client header (dropdown of finance clients from `shared.clients` filtered by finance flag).
- `/finance/overview` — small cross-client summary (pending counts, blocked counts, last close per client, cash headline). Non-invasive.
- `/finance/clients/<slug>/reports` — pack + PPTX archive (list of past close outputs from Cloud Storage).
- `/finance/clients/<slug>/close` — current close status (which stage, when triggered, when completed).
- `/finance/clients/<slug>/coa` — read-only chart of accounts view with search + filter.
- `/finance/clients/<slug>/settings` — client-specific finance config (materiality thresholds, cash floor, close cadence).
- Sticky client header behaviour (§8.2), sidebar collapse (§8.1) verified across all pages.
- Acceptance: all tabs functional at read-level for Feldspar; no cross-module contamination visible.

## 10. Enforcement rules — automated

- **ESLint boundary rule** — CI fails if `finance/*` imports from any other module directly
- **TypeScript strict mode** — no `any` in Finance module
- **Postgres schema separation** — CI runs a check that all Finance-related migrations create tables in `finance.*` schema, not `public`
- **Secret linting** — CI scan (gitleaks or similar) ensures no Xero tokens, HMRC OAuth, or API keys committed
- **Encoding rule** — all file reads use UTF-8 explicitly (Python side inherited from XERO REPORTING CLAUDE.md rule #12; port to Node/TS as an ESLint rule)
- **No em dashes in UI copy** — inherited rule from Feldspar pack (CLAUDE.md rule #4)

## 11. Testing criteria per phase

- Unit tests on all `finance/lib/*` utility functions
- Integration tests on ERPAdapter (mock Xero responses, assert transformations)
- E2E smoke test on Approvals page: seed 4 WIP items, load page, verify all 4 appear in correct panels, click one, verify detail loads, click Approve, verify audit log entry and folder move
- Manual visual QA against the wireframe (dark + light themes, mobile 375px + desktop 1440px)

## 12. Definition of done for v1

- Nik logs into `os.stza.io` on his phone
- Clicks Finance in the sidebar (either expanded or collapsed state) → lands on Clients list
- Taps Feldspar Sports → lands on Approvals tab
- Sees the four pending items in the right-hand state panels
- Taps one, reviews context, taps Approve
- Sees the Xero write confirmation in-line and a push notification confirms
- The item vanishes from the state panel, appears in "Activity" panel as "approved", the WIP folder moves from `pending-cfo/` to `posted/`, the diary gains a new entry, and Cloud SQL reflects all state changes
- All of this on a 375px screen with the sidebar collapsed
- Round-trip time from tap to confirmation < 2 seconds

If that loop works end-to-end for Feldspar, v1 is done and Nik has a working CFO cockpit. Everything else — additional clients, second ERP adapter, richer overview, client-facing v2 — is a follow-on release.

## 13. Where to pick up next

Once v1 ships:
- Second STZA client onboarded (validates the multi-client pattern)
- File watcher moved from Nik's laptop to a Cloud Run job with a mounted volume (so it works when laptop asleep)
- Second ERP adapter — probably QuickBooks Online — following the same interface
- v2 client-facing scope (spec §8) — Alvina (Feldspar CEO) logs in, sees only Feldspar data via `hasClientAccess()` filter

## 14. Questions before you start

If any of the following is unclear, ask before writing code:
1. Exact os.stza.io repo location + branch strategy (feature branch → PR to main? trunk-based? existing PR conventions?)
2. Existing ESLint config — is `eslint-plugin-boundaries` already installed, or do you need to add it?
3. Existing CI pipeline — GitHub Actions? Netlify build hooks?
4. Which Cloud Run service (or new one) hosts the Node bridge to the `stza-xero` MCP server?
5. Migration runner in use (Prisma / Kysely / raw SQL via `pg-migrate` / other)?
6. Icon library in use (Lucide / Radix / Heroicons / other) — align with existing rather than introduce new
7. Component library (shadcn/ui per spec §4, or something else already established in the codebase?)

Ask Nik in chat before making any of these decisions unilaterally.

---

**End of brief.** Cross-reference points: `portal/spec.md`, `portal/stza_ops_approval_queue_wireframe.html` (in outputs), `XERO REPORTING/CLAUDE.md`, and `os.stza.io` codebase itself. Report back after Phase 0.5 verification before starting Phase 1.
