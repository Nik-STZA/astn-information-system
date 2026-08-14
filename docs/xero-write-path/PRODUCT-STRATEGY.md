# Productising the Xero–Cowork connection for Fractional FDs

Product strategy note, 14 August 2026.
Written from a commercial product-director view, not an engineering one.

---

## 1. The uncomfortable finding: the connector is not the product

Xero publishes an **official MCP server** (`XeroAPI/xero-mcp-server`). It is
free, it supports **writes including manual journals**, and it handles
multiple tenants at runtime via bearer-token auth. There are also at least
four third-party Xero MCP servers and a stack of "connect Xero to Claude"
guides.

So the proposition "we have an MCP methodology for connecting Xero to Claude"
has no moat. A prospective customer can do it this afternoon, for free, from
Xero's own repo. Any pitch built on the connection itself will be
commoditised before the first renewal — and by the incumbent whose data you
depend on.

**This is survivable, but only if the product is repositioned.** Everything
below assumes we stop selling the pipe.

---

## 2. What the product actually is

The defensible asset is not access to one Xero org. It is **running a
portfolio of client ledgers to a close cadence**. That is what a Fractional
FD does, and it is what the official connector conspicuously does not help
with.

You already own most of the differentiated pieces:

- **Multi-client model** — `clients` → `entities`, with `close_cadence`,
  `framework` (FRS 102 / FRS 105), `year_end`, `reporting_currency`.
- **Work state** — open items, P1 counts, WIP, diary, notes, agent runs.
  Feldspar alone shows 17 open items, 4 at P1. The official connector has no
  concept of an open item.
- **38 skills** in `stza-finance-agents` — close management, reconciliation,
  variance analysis, audit prep, board narrative, cashflow forecast.
- **An audit trail** (`finance.audit_log`) and an approval-gated posting
  workflow.

Reframed: **"The operating system for a fractional finance practice."** The
Xero connection is table stakes inside it, not the headline. A subscriber
buys portfolio-level close management with an AI that already knows their
clients — not an API bridge.

That framing also survives Xero shipping better MCP tooling, which they
will.

---

## 3. Xero's commercial mechanics — the numbers that govern the model

Effective **2 March 2026**, Xero moved from free API access to tiered
pricing. A "connection" is one OAuth-linked tenant, measured **at app level**.

| Tier | Connections | Monthly | Egress allowance | Overage |
|---|---|---|---|---|
| Starter | 5 | Free | n/a | n/a |
| Core | 50 | A$35 | 10 GB | A$2.40/GB |
| Plus | 1,000 | A$245 | 50 GB | A$2.40/GB |
| Advanced | 10,000 | A$1,445 | 250 GB | A$2.40/GB |
| Enterprise | Unlimited | Custom | Custom | Custom |

Ingress is unlimited; **egress is metered**. App Store sales carry a **15%
referral revenue share**. Certification historically required onboarding 3+
active connections in a 30-day window plus review.

### What this means

**Connection cost is trivial.** Plus tier is A$245 for 1,000 connections —
about **A$0.25 (~£0.13) per connected entity per month**. If an FD pays
£150/month and brings 12 client entities, connection COGS is roughly £1.56.
Immaterial.

**Egress is the real risk, and it is an AI-specific risk.** Agents are
chatty in a way dashboards are not. A human pulls a trial balance once; an
agent mid-reasoning may pull it repeatedly across a session, and every
Cowork conversation starts cold. In this very session I pulled FGH's full
trial balance twice within an hour — the same report, unchanged.

Rough shape: 50 GB on Plus across 1,000 entities is ~50 MB per entity per
month. Comfortable for scheduled reporting; **not** comfortable for
unconstrained agent access to full ledgers. Blow through it and overage is
A$2.40/GB against a ~£0.13/entity connection cost — the variable line that
kills the margin is egress, not connections.

**So caching is a margin lever, not a performance nicety.** Cache trial
balances, chart of accounts and reports server-side with sane TTLs and
explicit invalidation on write. Serve agents from cache by default. This
should be an architectural principle from day one, and it is a genuine
product advantage over pointing customers at the raw connector — you can
honestly say you make Xero-backed AI cheaper to run at scale.

**Verify before committing:** whether the old 25-connection uncertified cap
still gates anything now that tiers exist, and whether App Store listing
(and the 15% share) is optional if you sell direct. Selling direct and
skipping the App Store may be the better route to market and avoids the
revenue share — but check that certification isn't required for volume
connections regardless.

---

## 4. The biggest build gap: a tenancy level that doesn't exist

Today the hierarchy is `client → entity`, with STZA as the implicit single
practice. A subscription product needs:

```
subscriber (FD firm)  →  client  →  entity  →  Xero connection
```

That is not a schema tweak. It changes every query, every route, every
credential path, and every audit row. Consequences:

- **Isolation is the number one sales objection.** An FD is handing you
  their clients' full ledgers. "Can another subscriber ever see my clients?"
  must have a demonstrable answer — row-level security, per-subscriber
  secret paths, tenancy assertions in tests, ideally a third-party review.
- **Secret Manager pathing** must be per subscriber, not per
  `client + entity`. Current `refreshSecretName(slug, entity)` collides the
  moment two subscribers both have a client called "Smith Ltd".
- **Audit rows need subscriber scoping** for the same reason.
- **Billing needs connection counting per subscriber** to price and to
  enforce plan limits.

Retrofitting tenancy after launch is one of the most expensive mistakes in
B2B SaaS. Do it before the first paying customer, not after the fifth.

---

## 5. Trust and liability — the gating commercial risk

You are selling software that **posts journals to client ledgers**, to
regulated professionals, whose PII exposure is their clients' entire
financial position.

- **Draft-by-default, always.** Never auto-post. The default flip from
  `POSTED` to `DRAFT` in the remediation plan is not a technical detail —
  it is a liability posture, and it should be in the marketing.
- **Immutable, exportable audit.** An FD facing a client dispute or a
  practising-certificate review must be able to produce who approved what,
  when, and what the balances were either side. Make audit export a
  first-class feature; it is also a retention hook.
- **Professional indemnity.** Terms must be explicit that the FD is the
  responsible party and the tool is an instrument. Get this drafted properly
  — it is cheaper than the alternative.
- **ICAEW / ACCA expectations.** Many fractional FDs are members. Whether
  AI-assisted posting sits comfortably with their practice requirements is
  worth confirming, and being able to say "yes, and here's why" is a sales
  asset.
- **Security posture.** Accountants will ask for SOC 2 or ISO 27001 sooner
  than most buyers. You will not have it at launch; have a credible
  roadmap and a security page.

### The credibility problem you must fix first

This product's own Xero integration was **silently dead for five weeks**,
held **plaintext client secrets on a laptop**, had **no locking on token
refresh**, and possibly **committed real credentials to git**. None of that
is sellable, and none of it is theoretical — it is what today's
investigation found.

The remediation plan is not tech debt to fit around the roadmap. **It is the
licence to sell.** A single incident where a subscriber's client ledger is
touched wrongly, or a credential leaks, ends the product.

---

## 6. Onboarding — where subscriptions actually die

The hard part is not the first connection; it is the twelfth.

An FD with 15 clients must get 15 Xero orgs authorised. Each needs someone
with the right Xero role to consent. Friction here is the single biggest
predictor of churn in the first 30 days, because value is zero until
connections exist.

- Investigate **Xero practice/adviser access** — an accountant with adviser
  rights may be able to authorise on the client's behalf, collapsing 15
  consent journeys into far fewer. If that works, it is a major onboarding
  advantage and worth designing around.
- Build **bulk connect** with clear progress state, not one-at-a-time.
- Build **connection health monitoring** into the product surface. Every FD
  will eventually hit what you hit today. Visible status plus proactive
  alerts turns your worst incident into a differentiating feature.
- **Time-to-first-value target:** a real close insight within one working
  day of signup.

---

## 7. Pricing

Connection COGS is negligible, so price on value, not usage.

Recommended: **per-subscriber base + per-connected-entity tiers.**

| | Solo | Practice | Multi-FD |
|---|---|---|---|
| Entities | up to 10 | up to 40 | 40+ |
| Indicative | £99–149/mo | £299–399/mo | custom |

Rationale:

- Entities are the natural value metric — more clients, more work managed.
- Per-seat pricing punishes exactly the multi-FD firms you most want.
- Keep an egress fair-use clause. You will need it eventually, and
  retrofitting one to existing customers is painful.
- Annual billing to offset the onboarding cost of acquisition.

Do **not** price on AI usage. Customers cannot forecast it, and it makes
them ration the behaviour that creates the habit.

---

## 8. Readiness gate — what must be true before selling

Sequenced, and honest about the order:

**Before any paying customer**
1. Remediation plan P0 and P1 complete — credentials, locking, error
   surfacing, alerting.
2. Subscriber tenancy layer with tested isolation.
3. Draft-by-default posting with approval gates and exportable audit.
4. Connection health monitoring visible to the customer.
5. Xero tier appropriate to forecast connections; certification question
   resolved.

**Before scaling past ~10 subscribers**
6. Server-side caching with invalidation — margin protection.
7. Self-serve onboarding including bulk connect.
8. Billing, plan limits, connection counting.
9. Support SLA and a status page.
10. Security page with a documented SOC 2 path.

**Design partners, not a launch.** Three to five fractional FDs, discounted
or free, in exchange for weekly feedback and reference rights. They will
tell you which of the 38 skills actually get used — my expectation is that
a small number carry nearly all the value, and knowing which changes the
roadmap.

---

## 9. The strategic risk to hold in view

Xero ships its own MCP server and is actively investing in it. Anything you
build that lives *at the connection layer* is on their roadmap. Anything you
build *above* it — practice workflow, portfolio close management, the
institutional memory of a specific client's ledger and its quirks — is not.

Stay above the line. When Xero's connector improves, it should make your
product cheaper to run, not less necessary.

---

## Sources

- [Pricing — Xero Developer](https://developer.xero.com/pricing)
- [Official Xero MCP Server](https://mcpservers.org/servers/XeroAPI/xero-mcp-server)
- [Becoming a Xero App partner — Apideck](https://developers.apideck.com/connectors/xero/docs/application_owner+oauth_credentials)
- [Xero shifts to tiered pricing model for developers — Accounting Today](https://www.accountingtoday.com/news/xero-shifts-to-tiered-pricing-model-for-developers)
- [Xero API Pricing Changes 2026 — Truto](https://truto.one/blog/xero-api-pricing-changes-2026-costs-tiers-and-how-to-minimize-egress/)
