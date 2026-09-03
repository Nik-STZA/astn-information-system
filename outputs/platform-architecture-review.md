# os.stza.io - platform architecture and product review

**Date:** 2 September 2026
**Scope:** the `astn-information-system` repository at `C:\Dev\astn-information-system`, read in full at source level. Live services were not exercised; the separate `stza-finance-agents` plugin repository referenced by the runner was not available and is treated as unverified.
**Purpose:** an honest technical and commercial assessment to inform the decision between a fractional contract at ALFRD and doubling down on STZA's own platform.
**Method:** every file named in the brief was read; endpoints, tables, pages, tools and tests were counted from source rather than from documentation. Where the documentation and the code disagree, the code is treated as the truth and the disagreement is reported.

This is a code review, not legal, insurance or investment advice.

---

## 0. The short version

You have three different things in one repository, and they are at three different levels of maturity.

| Component | What it is | Maturity | Commercial value |
|---|---|---|---|
| AfricanSTN registry and publishing | 7,003-organisation registry, content pipeline, Word export | Working internal tool | Content asset, not software |
| Data-protection compliance engine (V1 and V2) | Dual-model policy assessment against POPIA, GDPR, PDPL, FADP; remediation, DSAR, breach, ROPA | Deployed, used on your own two entities and one prospect | Your own market analysis (26 July) already concluded: boutique advisory, not SaaS |
| STZA Finance module + finance-api + MCP server + runner | Xero read integration, agent job queue, audit schema, approvals mirror | Read path works; approvals are display-only; 4 of 9 pages are placeholders; no write path in this repo | The governance schema is genuinely good; the BYOAI product thesis is weak |

The most valuable thing in the repository is not a feature. It is roughly 600 lines of SQL and 1,200 lines of TypeScript in `src/modules/finance/` that encode how a Big 4-trained accountant thinks about evidence: snapshotted approver capacity, append-only notes enforced by trigger, review independence derived rather than asserted, the commercial processing path recorded on every agent run, approval routing derived from config rather than declared by the agent. That is a real, differentiated asset. It is also exactly the thing ALFRD is trying to buy by hiring fractional reviewers.

The least valuable thing is the BYOAI plan as written. Xero ships its own free MCP server. Your own scoping memo says so in section 4.1 and then does not deal with it in section 9.

Verdict, expanded in section 7: this is real work by a real practitioner, not a hobby project, but it is a practice operating system, not a product. Take the ALFRD contract with a written carve-out for the STZA finance module, stop building features, and run your own closes through what exists.

---

## 1. Architecture assessment

### 1.1 What is deployed

Three Cloud Run services in `europe-west1`, one Cloud SQL PostgreSQL 17 instance, one legacy Supabase project holding two tables.

| Service | Code | Auth | Ingress | Endpoints |
|---|---|---|---|---|
| `astn-os` (Next.js 14) | `src/` | Google IAP, IAM allowlist, header checked in middleware and layout | internal-and-cloud-load-balancing | 8 Next.js API routes + 38 pages |
| `africastn-api` (Express) | `deploy/server.js` + 15 route files | single static `X-API-Key` | public | **151** |
| `stza-finance-api` (Express) | `finance-api/server.js` | single static `X-API-Key` | **public, `--allow-unauthenticated --ingress=all`** | **28** |

Plus two out-of-cloud processes that only run on your laptop: `scripts/agent-runner.mjs` (spawns `claude -p` against the client folder) and `finance-api/runner.js` (calls the Anthropic Messages API with Xero tools). Plus `finance-api/mcp-server/index.js` (stdio MCP, 9 read-only tools).

### 1.2 Stack choices

**Sound.** Next.js 14 App Router, Express, `pg`, Cloud Run, Cloud SQL, IAP, Secret Manager, Workload Identity Federation for keyless deploys. Nothing exotic, nothing you will struggle to hire for, and every choice is the boring one. IAP as the only identity layer for a single-operator tool is the correct decision and removes an entire class of auth bugs. Pinning `DATE` columns to strings in `pg` (`types.setTypeParser(1082, ...)`) to stop year-ends drifting a day under BST is the kind of detail that shows someone has been burned and learned.

**Questionable.**

- **Three route-loading conventions in one repo.** `africastn-api` loads routes by `require()` of files that mutate `global.app` and `global.pool`. That is a 2012 pattern; it works, but it means every route file has invisible dependencies, none can be unit-tested in isolation, and the CI copy step (`cp server-*-routes.js server-lib-*.js deploy/`) is load-bearing. The `deploy/` directory in the repo is stale: it is missing `server-remediation-v2-routes.js`, `server-assessment-v2-routes.js`, `server-document-gen-routes.js` and `server-content-routes.js`, all of which `deploy/server.js` requires. CI papers over it; a manual deploy from the checked-in `deploy/` would crash on start.
- **Two agent runners with different architectures.** `finance-api/runner.js` is a direct Anthropic SDK tool-use loop with 7 Xero tools. `scripts/agent-runner.mjs` shells out to Claude Code with a plugin directory and scrapes the transcript for tool usage. They post to the same `complete` endpoint with different payloads (`agent-runner.mjs` sends `processingPath`, which `server.js` ignores, so migration 008's column is never populated by the API). The docs describe the Claude Code runner; the BYOAI memo describes the SDK runner and says it is "demoted". Pick one.
- **Tailwind installed, not used.** Inline style objects reading CSS variables throughout ~19,000 lines of page and component code. It is consistent, which matters more than which convention, but it is a real cost the day anyone else touches the UI.
- **Next.js server as a blind proxy.** `src/app/api/proxy/[...path]/route.ts` forwards any method on any path to `africastn-api` with the API key attached. Any IAP-authenticated user has the full 151-endpoint surface including `DELETE`. Fine for one operator; it is the first thing to remove before a second user.

### 1.3 Separation of concerns

The module boundary work is the best structural decision in the repo. `src/modules/finance` may import `src/shared` and nothing else, enforced by `eslint-plugin-boundaries` and gated in CI. `scripts/check-finance-schema.mjs` fails CI if a finance migration creates anything outside the `finance` schema. `stza-finance-api` reads only `shared.*` and `finance.*`. The stated goal - "extraction should be take this service plus a dump of shared.* and finance.*" - is actually achievable today, which is rare.

The compliance and registry code has none of this discipline: 8,110 lines of route files sharing globals, 16,800 lines under `src/app` with data access in `src/lib/data/`, and a V1 pipeline the project's own principles document says is legacy and must not be extended, but which is still mounted and still has 12 endpoints.

### 1.4 Production readiness

**Solid**

- Secrets: nothing sensitive in the repo, Secret Manager for the DB password and both API keys, Xero refresh tokens as individually named secrets with IAM name-scoped read access (decision 6). Every reveal of a secret, including failed attempts, is audited with actor, capacity and IP.
- Xero OAuth: the tenant-selection bug (Feldspar mapped to Ultraspeed because it was first in `/connections`) was fixed properly with `authentication_event_id` matching, then the over-correction that discarded tokens was fixed too. `lib/xero.js` isolates the decision logic and has tests. The one-organisation-cannot-serve-two-entities check exists.
- Job queue: `FOR UPDATE SKIP LOCKED` claim, immutable-once-finished trigger on `agent_runs`, advisory locks on file sync. This is correct concurrency work.
- CI: lint, boundaries, schema isolation, typecheck, unit tests, build, all before deploy. Keyless WIF auth. `env_vars_update_strategy: overwrite` with a comment explaining the production incident that motivated it.

**Held together with tape**

- **`API_KEY` unset means the API is open.** `deploy/server.js` line 57: `if (!apiKey) return next(); // No key configured = open (dev only)`. If the secret mount ever fails on a deploy, `africastn-api` serves 151 endpoints to the internet with no auth. The finance API correctly returns 500 in the same situation. Make them match.
- **Every Xero read rotates the refresh token.** `xeroEntityContext()` calls `refreshAccessToken()` on every request, which hits Xero's token endpoint, then writes a new Secret Manager version. There is no access-token cache and no lock. Xero refresh tokens are single-use, which the code comments know. Two concurrent reads on the same entity (the MCP server and the runner at the same time, or two Claude tool calls in one turn) race: the second refresh presents an already-used token, Xero returns 400, `ErpUnavailable` fires, and the connection is dead until someone reconnects. This is the single most likely thing to break the moment a second user appears, and it also means Secret Manager versions grow by one per read. A 30-minute in-memory access-token cache keyed on secret name, plus a per-secret mutex, fixes it in ~40 lines.
- **Aged receivables and payables** are computed from an `/Invoices` call with no pagination loop; only a pass-through `page` parameter. Verify Xero's behaviour when more than 100 invoices are outstanding before anyone relies on the bucket totals. The bucket labels ("30" meaning 1-30 days overdue) are consistent but will confuse anyone reading raw output.
- **Xero rate limits** (60 calls per minute per tenant, 5,000 per day) are not handled anywhere. The MCP server translates a 429 into a message; nothing backs off.
- **No integration or end-to-end tests.** 10 test files exist, all pure-logic unit tests (parsers, money, routing, processing path, tenant selection). Zero tests cover any of the 179 HTTP endpoints. Decision 10 in the decisions log notes that the duplicate-rows defect "is exactly the class an integration test would have caught first". It still has none.
- **Single environment.** Merge to `main` deploys to production. The governance note records a config error that hid three modules in production and was caught by looking, not by a gate.
- **Cold starts.** All three services run `min-instances=0`. First request after idle pays a Cloud Run cold start plus a `pg` pool connect; for the finance API it then pays a Secret Manager read and a Xero token refresh.

---

## 2. Product scope audit

### 2.1 Counts

| Thing | Count | Notes |
|---|---|---|
| Lines of code (TS, TSX, JS, MJS, SQL, excluding node_modules and stale `deploy/` copies) | ~49,500 | `src/app` 16,803; route files 8,110; `src/modules/finance` 6,804; `src/lib` 5,263; migrations 4,410 + finance migrations; scripts 3,273; `finance-api` 2,643; `multi-jurisdiction-engine.js` 818 (orphaned at repo root) |
| Development span | 25 May 2026 to 2 September 2026 | ~100 days, one author (Nik, 96 of 97 reflog entries) |
| Cloud Run services | 3 | |
| HTTP endpoints | 187 | 151 africastn-api + 28 finance-api + 8 Next.js routes |
| Database tables created by migrations | 52 | 40 `public`, 11 `finance.*`, 1 `shared.*`. Plus pre-migration tables (`organizations`, `classified_items`, `partnerships`, `lookup_*`) and two still in Supabase |
| Migrations | 35 | 25 in `migrations/` (with a duplicated `014` and `015` number), 10 in the finance module |
| Frontend pages | 38 | 36 authenticated; 4 of the 9 finance client pages render `ComingSoon` |
| MCP tools | 9 | all read-only |
| Runner tools | 8 | all read-only |
| Agent role prompts | 4 | fc, fpa, fm2, ap-clerk, each ~8 lines |
| Test files | 10 | ~0 endpoint coverage |
| Docs | 18 files in `docs/`, 6 in `outputs/` | unusually good; see 2.4 |

### 2.2 What actually works in production today

Based on code paths with a complete request-to-response chain, not on documentation.

**Registry and publishing (AfricanSTN)**
- Organisation registry browse, filter, paginate, detail, edit with change history (`server-registry-routes.js`, 27 endpoints, migration 014 audit triggers)
- Registry verification queue, Word profile report and bulk export via `docx`
- Content pipeline: sources, classified items, briefs, review queue, LinkedIn drafts (`server-content-routes.js`, 10 endpoints, migrations 014-017)
- Data-protection landscape pages reading `dp_jurisdictions` and `dp_editions`

**Compliance (STZA advisory)**
- Prospect pipeline with document fields and prospect-to-client link
- Client management with regulator registrations, IR verification, processor register, processing activities, special categories, breach register, DSAR tracking, remediation board (V1 and V2), resolutions, audit trail
- V1 keyword assessment (legacy, still mounted)
- V2 dual-model assessment: Gemini + Claude judge each requirement independently, verbatim quote verified against the corpus, conservative adjudication on disagreement, flagged for human review
- Dual-model resolution generation tagged Statutory vs Enhancement
- Amendment schedule (redline pack) generation as `.docx`
- Knowledge base seeded for POPIA, GDPR, Swiss FADP, UAE PDPL

**Finance (STZA practice)**
- Client and entity model, Feldspar (3 entities) and STZA (1 entity) seeded
- Xero OAuth connect, tenant selection, organisation picker, secret reveal/copy with audit
- 7 live Xero reads per entity: trial balance, P&L, balance sheet, bank summary, aged receivables, aged payables, chart of accounts
- Diary and open-items mirrors synced from markdown by a local file watcher
- WIP items and review log mirrored from the folder convention, with routing class derived at import
- Agent run queue: portal queues, local runner claims and completes, output rendered as markdown with cost and tools used
- Append-only notes on WIP and open items
- MCP server usable from Claude Desktop or Cowork against the deployed finance API

### 2.3 What does not work, or does not exist, despite being described

| Claim | Where claimed | Reality in this repo |
|---|---|---|
| "Journal posting: prepare and post manual journals with audit trail" listed under "What's live today" | `STZA_Finance_Platform_One_Pager.docx` | No write endpoint in `finance-api/server.js`. `ERPAdapter.postJournal` is an interface with **no implementation** anywhere in `src/`. `accounting.manualjournals` scope is requested but nothing uses it. A `post_journal` tool exists in the separate `stza-xero-live` plugin, which is outside this repository and could not be reviewed. |
| "Journal posting is built" | `hackathon-demo-script.md` backup Q&A | Same |
| Approvals: approve, reject, send back | Migrations 001, 004, 007; `wip-state.ts` state machine with tests | `ApprovalsBoard.tsx` has no approve, reject or send-back action. Its only `onClick` handlers select and go back. There is no approval endpoint in the finance API. The `wip_review_log` is populated only by parsing markdown review logs written by agents or by hand. The "approval gate" is a folder move on your laptop. |
| Close, chart of accounts, reports, settings pages | Nav in `src/modules/finance/config/nav.ts` | All four render `ComingSoon` |
| "Agent job queue... queue, claim, execute, complete pattern" | BYOAI memo | Correct, but `agent_runs.processing_path` (migration 008) is never written because `complete` ignores the field |
| `ANTHROPIC_API_KEY` removed from the Cloud Run service | `CLAUDE.md` security constraints | `deploy-cloud-run.yml` mounts `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`; the dual-model engine requires both |
| 8 MCP tools, v0.1 | `CLAUDE.md` | `index.js` declares 9 tools and version 0.2.0; `package.json` says 0.1.0 |
| Netlify deployment, Supabase Auth, `ALLOWED_EMAILS` | `README.md` | All obsolete since the IAP and Cloud SQL moves; the CORS allowlist in `deploy/server.js` still names the Netlify origin |

### 2.4 Novel versus commodity

**Genuinely novel (worth protecting)**

1. **The finance governance schema.** `finance.client_engagement_roles` with `role_at()` and snapshotting onto `audit_log.actor_role`; `finance.notes` append-only by trigger; `has_independent_review()` returning false on unknown identity; `agent_runs` immutable once finished with the instruction captured as a required field; `processing_path` as a first-class audit column; `routing_class` derived from config with BigInt threshold comparison so a float never decides whether a human reads an item. None of this is technically hard. All of it is the product of someone who has sat across from an auditor. It is the encoded form of a control environment, and most agentic-finance products have nothing like it.
2. **The decisions log and governance note.** `docs/finance-module-decisions.md` (22 decisions with cost and what-would-change-it) and `docs/finance-module-governance.md` (a gap register that names Anthropic as an undisclosed sub-processor and says so in bold) are better than the documentation at most Series A companies. A due-diligence team would read decision 22 - "more design review will not find the next one; using the system will" - and take you seriously.
3. **Processing-path enforcement in `processing-path.ts` and the runner.** Refusing to run a third-party ledger over a consumer subscription, and refusing a half-configured Vertex path rather than silently falling back, is a control most people would not think to build.
4. **The verbatim-quote verification in the compliance engine.** Small, but it is the correct anti-hallucination primitive: the model may only claim "present" if the quoted substring exists in the source after normalisation.

**Commodity**

- The Xero read integration. Seven proxied report endpoints. Xero's own MCP server, Syft, Fathom, Joiin and a dozen others do this.
- The MCP server. 544 lines, thin wrapper over REST. Any developer produces this in a day from the SDK examples.
- The agent runner loop. See section 3.1.
- Registry CRUD, pipeline CRUD, client-management CRUD: 24 + 27 + 12 + 23 endpoints of table maintenance.
- The dual-model assessment pattern. Your own market analysis already says this is "replicable in an afternoon" and should be treated as hygiene.

### 2.5 What a technical due-diligence team would say

**Impressive:** the migration commentary, the module-boundary enforcement in CI, the secret handling, the honesty of the governance note, the concurrency correctness on the queue and sync, the fact that the same person can explain every decision.

**Flags, in the order they would raise them:**

1. **Bus factor of one, and the runner only executes on that one person's laptop.** Nothing agentic happens if the machine is off.
2. **Zero endpoint tests across 187 endpoints.**
3. **Public finance API protected by one static key, no rate limiting, no per-user identity.** `X-Actor-Email` is trusted from the caller, so a leaked key lets anyone write any actor name into the audit log.
4. **Marketing documents claim features the code does not have** (journal posting, approvals). For a business whose pitch is auditability, this is the flag that hurts most.
5. **Three different surnames for the same author across outward documents:** "Nik Mladenovic" in the governance note and engagement scopes, "Nik Sobey" in the hackathon script, "Nik Sheridan" in the BYOAI memo v2. These are AI-generated documents where the model hallucinated the author's name and nobody caught it. Your own `CLAUDE.md` says the practice exists to ensure "no hallucination from AI". Fix this before any of these documents leave the building.
6. **Stale `deploy/` directory and stale `README.md`** describing an architecture that no longer exists.
7. **Orphaned code:** `multi-jurisdiction-engine.js` (818 lines, July) at the repo root, `INTEGRATION-GUIDE-server-auth-patch.js`, `netlify.toml`, two CVs and a proposal `.docx` committed at the top level.
8. **The V1 compliance pipeline** the principles document says must not be extended is still mounted with 12 endpoints and a `name`-matching generator the lessons log describes as a landmine.

---

## 3. Finance module deep dive

### 3.1 The agent runner

`finance-api/runner.js`, 440 lines. The loop, in full:

- Poll `/agent-runs/claim` every 5 seconds.
- List connected entities, build 8 tool schemas with the entity slugs as an enum (nice touch: the model cannot invent an entity).
- Up to 25 turns of `messages.create` with `max_tokens: 4096`, tools, and one of four system prompts of about eight bullet points each.
- On each `tool_use`, call the finance API and stringify the full JSON response into the tool result.
- Stop on `end_turn`. Sum tokens, multiply by hardcoded Sonnet prices, post the last text block as output.

This is the textbook tool-use loop from the SDK documentation. What it does not have:

- Prompt caching (every turn resends the full history at full price)
- Any truncation or summarisation of tool results (an 11-period P&L or a 400-line trial balance goes into context verbatim, repeatedly)
- Retry or backoff on 429 or 529 from Anthropic, or on Xero rate limits
- A per-job timeout or token budget
- Structured output (the "working paper" is whatever prose the model emitted last)
- Any memory across runs, any access to the client's files, registers, prior findings or the chart-of-accounts mapping table that migration 001 built specifically as "the source of truth for what an account contains"
- Any connection to the WIP folder convention: a run cannot produce a WIP item; `wip_ref` is never set

It is a competent demo. "Sophisticated" is not the word. The second runner, `scripts/agent-runner.mjs`, delegates the entire agentic problem to Claude Code plus a plugin you keep elsewhere, which is a more capable approach (it has the files, the skills and the MCP) and a less controllable one. The docs and the BYOAI memo disagree about which of these is the product.

### 3.2 The MCP server versus what is commercially available

`finance-api/mcp-server/index.js`: 9 tools, stdio only, single static API key, explicit `client` parameter required on every call (good), friendly error translation (good), no per-user identity, no SSE or Streamable HTTP transport, no OAuth, no rate limiting, no telemetry of who called what (the "audit trail" in the hackathon Q&A does not exist for MCP calls; the finance API logs nothing on the read endpoints).

Comparison:

| | STZA MCP v0.2 | Xero official MCP server | Typical funded competitor (Syft, Fathom AI, Digits, Puzzle) |
|---|---|---|---|
| Xero reads | 7 reports | Full accounting API surface, read and write | Reads plus their own analytics layer |
| Multi-tenant | via your client/entity model | native (Xero tenants) | native |
| Auth | shared static key | OAuth per user | OAuth per user |
| Transport | stdio | remote | remote, plus hosted UI |
| Audit of tool calls | none | Xero's own API history | product-specific |
| Price | proposed £49 to £99 per entity per month | free with a Xero subscription | £20 to £150 per month |

The honest reading: the only thing the STZA MCP server offers that Xero's does not is the mapping from "a fractional CFO's client" to "a set of Xero tenants", and the safety rule that every call names its client. That is a good rule. It is not £588 a year per entity.

### 3.3 The Xero integration

**Read path:** works. Token exchange in the finance API so the client secret never reaches Next.js. Scopes are the new granular set and are requested up front, including `accounting.manualjournals` for a write path that is not yet built. The governance gap register notes that `accounting.reports.read` and `accounting.journals.read` are absent, so GL drill-down 401s on all four connections and widening scopes means reconnecting every entity.

**Write path:** does not exist in this repository. `ERPAdapter` is a well-designed interface (money as integer minor units with currency, ISO date strings, capabilities flags so the UI can hide what an adapter cannot do) with zero implementations. Decisions 1, 2 and 3 describe a draft-then-post pattern with bidirectional traceability that would be genuinely good if built.

**OAuth handling:** the best-engineered part of the finance API. Refresh token stored before the database transaction so a failure between the two reports as not-connected rather than falsely healthy; tenant identified by `authentication_event_id` intersection rather than list position; unmapped authorisations stored for later selection rather than discarded. The one gap is the concurrent-refresh race described in 1.4.

### 3.4 The compliance engine

**V1** is keyword counting that marked every POPIA domain present at a flat 70. The project's own principles document calls it legacy. It still runs.

**V2** is real. `server-lib-assessment.js` and `server-lib-resolution.js` are ~400 lines that do what they say: two models, temperature zero, JSON schema output, verbatim-quote verification, conservative adjudication, human review flag. The knowledge base is data-driven (jurisdiction, domain, requirement, `legislation_ref`) and the acceptance test in the principles doc - a new country must be a pure seed with no code change - is the right invariant.

Is it a prototype? It is past prototype and short of product. It has run on your own two entities and produced findings a human reviewer then corrected (lessons log, 26 July: statutory versus best-practice conflation, wrong instrument, absolute role statements). The pipeline still guesses URLs from `company_website` rather than using the prospect's `privacy_policy_url`. There is no upload UI. And the market analysis you commissioned on 26 July concluded, with sources, that the technology is not the moat, the SME market will not pay, and the liability exposure of a non-lawyer auto-drafting legal documents cross-border is "potentially fatal". That analysis is correct and it is already in your repo.

---

## 4. Commercial viability

### 4.1 Could this serve multiple clients as SaaS?

The data model could. `shared.clients`, `finance.entities`, `finance.client_engagement_roles` and the client-scoped finance API were designed for it. The infrastructure cannot, today:

- No user model. Identity is an IAP email on the frontend and a shared key everywhere else.
- No authorisation. Every authenticated user sees every client.
- No tenant isolation on the compliance side beyond `client_id` columns in queries.
- No multi-user concurrency handling on the Xero token (1.4).
- Execution requires your laptop.
- No non-production environment, no release process, no rollback.
- No terms, no DPA, no ICO registration, no PI cover confirmed for AI-drafted work (gap register items 1 and 10, both High).

### 4.2 The gap between internal tool and product

Counting only what the BYOAI memo's own phase 1 to 4 roadmap lists, and adding what it omits:

| Work item | Memo estimate | Realistic |
|---|---|---|
| Per-user API keys, bcrypt, rotation, client scoping middleware | 2 weeks | 2 weeks |
| Audit logging middleware on all read endpoints | in phase 1 | 3 days |
| Remote MCP transport with OAuth (Streamable HTTP, not SSE, which is deprecated in the spec) | 1 week | 2 weeks including auth server |
| Access-token cache and refresh mutex | not listed | 2 days, must precede any second user |
| Rate limiting, Xero backoff | listed as a risk | 3 days |
| Endpoint test suite covering finance API | not listed | 2 weeks |
| Staging environment, release process | governance gap 6 | 1 week |
| Sign-up, onboarding, Xero consent, key display | phase 4 | 2 weeks |
| Terms, privacy policy, DPA, ICO registration | phase 4 | 1 week plus lawyer |
| Journal write path via `ERPAdapter` with draft-then-post and bidirectional trace | "already built" per one-pager | 2 weeks |
| Approve, reject, send-back actions in the portal with audit rows | implied by the schema | 1 week |
| Runner off your laptop (always-on VM or Cloud Run job with the plugin) | governance gap 7 | 1 week |

Roughly 14 to 16 weeks of one person's full-time work to reach a minimum viable multi-user product, before any sales, support or the compliance side. The memo says 5.

### 4.3 What would make it investable

Nothing on the technical list above. Investability would require evidence that someone other than you pays for it, and the repository contains no such evidence: `engagement_revenue` and `client_engagements` tables exist (migration 015) but the only clients seeded are Feldspar (your existing fractional FD engagement), STZA itself and a sandbox. The compliance side has one prospect (ProTouch) with five versions of an engagement scope and no recorded fee.

Your own 26 July action list says it plainly: "who pays, how much, how often, and who's liable" before another month of engine polishing. Six weeks later the repository shows a BYOAI memo, an MCP server, an OpenAPI spec, a hackathon script and a one-pager. The action list's checkboxes are still empty.

### 4.4 BYOAI versus full SaaS

BYOAI is the right instinct for the wrong reason. The instinct - do not host inference, do not absorb token cost, do not become the party generating financial commentary - is sound. But it removes the only place STZA could add value in the interaction (the agent prompts, the roles, the working-paper structure, the controls) and leaves a data proxy that Xero gives away. Under BYOAI, the user's Claude Desktop talks to Xero through you; under Xero's MCP, it talks to Xero directly. You are a toll booth on a road with a free lane.

Where BYOAI does have a defensible form: not "connect your AI to Xero" but "connect your AI to a governed finance workspace" where the tools are `create_wip_item`, `submit_for_review`, `record_finding`, `request_approval`, `post_approved_journal`, and every call lands in the audit schema you already built. The plumbing nobody wants to build is the control environment, not the token refresh.

---

## 5. Honest weaknesses

### 5.1 Bus factor

One. Every credential, every role in the four-tier review chain, every deploy, every agent execution, and the only copy of the agents plugin. The governance note says so. Mitigation in place: good docs, `CLAUDE.md`, decisions log, remote repo, PITR backups. Not mitigated: anything at all happening if you are unavailable for a week.

### 5.2 What any serious finance platform would need that is missing

- Users, roles and authorisation
- A write path to the ledger, with the draft-then-post pattern designed in decision 3
- An approval action (not a folder move)
- Bank feed or bank statement ingestion and reconciliation (the thing ALFRD, Numeric, Puzzle and Digits all lead with)
- Document ingestion (parked, correctly, in favour of Hubdoc)
- Period locking and close checklist (the `close` page is a placeholder)
- Multi-currency handling above the `Money` type
- Anything that runs when your laptop is closed
- Monitoring, alerting, error tracking (there is `console.error` and nothing else)
- Tests

### 5.3 Security gaps, ranked

1. `africastn-api` falls open if `API_KEY` is unset (`deploy/server.js` line 57).
2. `stza-finance-api` is public with one static key, no rate limit, no IP restriction, and `X-Actor-Email` trusted from the caller. A leaked key equals full read of every client's Xero data plus the ability to forge audit rows. Cloud Run can restrict ingress to the load balancer or require IAM invoker identity from `astn-os`; either closes this.
3. `/api/proxy/[...path]` hands every IAP user every method on every endpoint.
4. The secret reveal endpoint returns the Xero app client secret to the browser. Audited, but the value then lives in a browser tab.
5. `ALTER TABLE classified_items ADD COLUMN ${col} ${def}` in `server-content-routes.js` line 425. Check that `col` and `def` are constants, not request input.
6. No CSRF protection on the Next.js finance routes beyond IAP session cookies (acceptable for one user).
7. Audit `ip_address` is taken from `X-Forwarded-For`, which the caller controls.

Nothing here is a leaked secret or an injection; the sort and filter interpolations in the registry and content routes are allowlisted. The pattern is "correct for one trusted user, wrong for two".

### 5.4 What breaks under load or with multiple users

- The Xero refresh race (1.4). Deterministic failure with two concurrent readers of one entity.
- `pg` pool `max: 5` on each service with `max-instances` 2 to 3; Cloud SQL default connection limits will be reached before Cloud Run scales.
- The runner processes one job at a time on one laptop; queue depth grows unbounded and `agent_runs` has no timeout, so a runner crash mid-job leaves a row in `running` forever (the runner tries to close it, but not if the process is killed).
- Full-file replace on every diary sync and full Xero report bodies in every tool result; both are O(n) per call and fine at your scale, not at fifty clients.
- Secret Manager version growth of one per Xero read.

### 5.5 Technical debt accumulating

- Two runners, two compliance engines, two remediation boards, two assessment report pages, a legacy Supabase project, a stale `deploy/`, an orphaned engine file, a README for a different architecture, a `netlify.toml`.
- Duplicate migration numbers (`014-registry-audit-triggers.sql` and `014-content-pipeline.sql`; two `015`s) with no migration runner in production ("applied manually").
- Global-mutating route files that cannot be tested.
- Every UI file carrying its own inline style objects.
- Version and tool-count drift between `CLAUDE.md`, `index.js` and `package.json`.
- Marketing documents ahead of code, and author names that do not match.

---

## 6. Comparison to ALFRD (public information only)

From `alfrdhq.com`, read on 2 September 2026: ALFRD describes itself as "finance transformation" for accounting firms, in-house teams and fractional CFOs. Its process is map the operation, build a "financial operating model", deploy agents "while a qualified accountant reviews outputs", expand. It lists advisor and alumni logos (Cambridge, Yale, Octopus Investments, Algbra), hires "finance transformation advisors" and an "accountant-in-residence", and routes contact to a Cal.com booking. The site contains no product screenshots, no pricing, no integration list and no public beta page that rendered. Per your brief: pre-seed, Palantir Foundry, journal entries only, fractional reviewers as the quality gate.

### 6.1 Scope comparison

| Dimension | STZA (this repo) | ALFRD (public) |
|---|---|---|
| Stage | Solo practitioner, ~100 days, live on own books and one client | Pre-seed, team, advisors, hiring |
| Data platform | Cloud SQL, hand-written schema | Palantir Foundry (ontology-first, expensive, enterprise-grade lineage) |
| Ledger integration | Xero read, OAuth done properly | Not stated publicly |
| Agent scope | 4 prompt roles, read-only reports; separate plugin with journal tools (unverified) | Journal entries: matching, categorisation, anomaly detection, evidence retrieval |
| Human quality gate | Designed into the schema; the record refuses to imply independence that does not exist | Hiring people to be the gate |
| Governance and audit | Snapshotted roles, append-only notes, processing path recorded, DPA gap register | Not visible publicly |
| Compliance engine | Multi-jurisdiction data-protection assessment | None |
| Sector data asset | 7,003-organisation African sports registry | None |
| Go-to-market | Hackathon demo, one-pager, no pricing page | Services-led ("we map your operation"), booking link, no pricing |

### 6.2 What STZA has built that ALFRD has not (publicly)

- A working, correct Xero OAuth and secret-rotation layer.
- An audit and accountability schema written by someone who will have to defend it to an auditor.
- The processing-path and sub-processor thinking, in code.
- A second product line (compliance) with its own knowledge base.
- An unrelated but real content and registry asset.

### 6.3 ALFRD's likely advantages

- **Foundry.** Whatever one thinks of Palantir, an ontology with lineage, versioned datasets and access controls is the entire "record plane" you would otherwise have to build. Using it at pre-seed suggests either a partnership or a founder who came from that world; either way, it is a platform decision you cannot match solo.
- **A team and money.** Every gap in section 5 is a headcount problem.
- **Focus.** One workflow (journals) done deeply beats nine read tools done thinly. Your own decision 20 - "scripts compute, agents interpret" - is the right philosophy for exactly what ALFRD is building.
- **Distribution motion.** Services-led "map your operation" is a consulting sale that lands logos and context. It is also the motion your market analysis recommended for the compliance product and you have not run.

### 6.4 Partnership or integration rather than competition

Yes, and the fit is specific. ALFRD says it deploys agents "while a qualified accountant reviews outputs, checks exceptions and keeps finance judgement in the loop", and it is hiring fractional reviewers to do that. What it does not appear to have, and what you have already designed, is the evidence layer that makes a reviewer's work defensible: who reviewed, in what capacity, whether the review was independent of preparation, what instruction the agent was given, which commercial path processed the data, and an immutable record of all of it. That is `finance.client_engagement_roles`, `wip_review_log`, `has_independent_review()`, `agent_runs`, migration 008.

A fractional contract that puts you inside their review loop gives you: income, a look at Foundry, a funded team's view of the same problem, and standing to propose that your accountability model becomes their reviewer record. That is a better outcome for the IP than a £49-per-entity MCP server.

The risk in the other direction: a fractional contract with standard IP-assignment and non-compete language could capture the STZA finance module if you keep developing it while engaged. Get the carve-out in writing, by name, before signing: the `astn-information-system` repository, the `stza-finance-agents` plugin, and the compliance engine as pre-existing IP; any improvements you make to your own tools on your own time remain yours; and a non-compete narrow enough to exclude your existing fractional FD practice.

---

## 7. Verdict

**Is this real or a hobby project?** Real. It is used on your own books and on a paying fractional FD client, it is deployed with proper secrets and CI, and the parts that are unusual are unusual because of your professional training rather than despite it. Hobby projects do not have gap registers that name their own sub-processor breach in bold.

**Is it a product?** No. It is a well-built practice operating system with a product-shaped marketing layer laid over it in the last four weeks. The marketing layer claims features the code does not have, and the product thesis (BYOAI over Xero reads) competes with a free offering from Xero that your own memo acknowledges and then ignores. The compliance product has the same shape: your own commissioned analysis concluded "boutique advisory, not SaaS" on 26 July and the recommended validation steps have not been started.

**Should you take the ALFRD contract?** Yes. The reasons, in order:

1. Income and a funded team's view of the exact problem you are solving alone.
2. Foundry exposure. The record plane is the hardest part of what you are building, and they have bought one.
3. Your differentiated asset - the accountability and evidence model - is worth more inside a company that is hiring reviewers than as a feature of an MCP server nobody has paid for.
4. You will learn in weeks whether "agents draft, accountants sign" has willingness-to-pay at scale, which is the single question your market analysis said to answer before writing more code.

**Should you keep STZA?** Yes, in a specific form. Keep the finance module as your own practice tool and run every close through it. Do not build the BYOAI product. Do not add pages. Fix the six things below, then stop.

**Do both?** Yes, with a written split: ALFRD two to three days a week under a contract with the IP carve-out in section 6.4; STZA as the practice you already run, using the tools you already built; no new product surface until someone who is not you has paid for one.

### What to do this month, in priority order

1. Correct the author names and remove the journal-posting and approvals claims from every outward document. A firm whose pitch is auditability cannot circulate documents with hallucinated names.
2. Close the `API_KEY`-unset fallthrough in `deploy/server.js` and lock `stza-finance-api` ingress to the load balancer or an IAM invoker identity.
3. Add the access-token cache and per-secret refresh mutex before any second reader touches Xero.
4. Delete the stale `deploy/` copies, the Netlify config, the orphaned engine, the CVs and the proposal from the repository root; rewrite `README.md` to match `CLAUDE.md`.
5. Pick one runner. If the answer is Claude Code plus the plugin, delete `finance-api/runner.js` and make `complete` accept `processingPath` so migration 008 does something.
6. Write one integration test that boots `stza-finance-api` against a test database and hits every endpoint. Then stop building until it is green in CI.

### The number that matters

In roughly 100 days you produced ~49,500 lines of working code, 187 endpoints, 52 tables, 3 services and 24 documents, alone. That is a productive engineer with excellent judgement about controls. It is not evidence of a business. The evidence of a business is a fee, from a party that is not you, for the software rather than for your time. The repository does not contain one. Go and get one - and the fastest route to finding out whether one exists is inside a company that has already raised money to look.

---

*Files referenced: `C:\Dev\astn-information-system\CLAUDE.md`, `finance-api\server.js`, `finance-api\runner.js`, `finance-api\lib\xero.js`, `finance-api\mcp-server\index.js`, `deploy\server.js`, `scripts\agent-runner.mjs`, `src\modules\finance\db\migrations\001-010`, `src\modules\finance\lib\routing.ts`, `src\modules\finance\lib\processing-path.ts`, `src\modules\finance\lib\erp-adapter.ts`, `src\modules\finance\components\ApprovalsBoard.tsx`, `src\app\api\proxy\[...path]\route.ts`, `server-lib-assessment.js`, `docs\finance-module-decisions.md`, `docs\finance-module-governance.md`, `docs\market-analysis-2026-07.md`, `docs\repositioning-and-liability-actions.md`, `docs\compliance-engine-principles.md`, `docs\compliance-status.md`, `outputs\STZA_BYOAI_Architecture_Scoping_Memo_v2.docx`, `outputs\STZA_Finance_Platform_One_Pager.docx`, `outputs\hackathon-demo-script.md`, `.github\workflows\*.yml`.*
