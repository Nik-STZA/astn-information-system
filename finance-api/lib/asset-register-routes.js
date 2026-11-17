// Asset register routes (docs/asset-register-spec.md): the opening import, and
// a summary of what the register holds. lib/asset-import.js decides; this reads
// Xero and the database, and writes (migration 049).
//
// POST /api/finance/clients/:slug/asset-register/import
//   The payload scripts/asset-register-import.py writes, plus dry_run (default
//   true). The CFO only, as a person in os.stza.io. Refused, with the reasons,
//   unless every company has a template for its framework, every account is
//   in Xero's chart, every trial balance foots, and the register ties to the
//   ledger at the opening date after its named items. A grouping is imported
//   once: a second import of a grouping that holds assets is refused.
//   On success, in one transaction: the grouping switched on, its account map,
//   the assets, the cost lines (each with its approval row), the opening
//   events, and the opening month marked prepared with the tie as its
//   snapshot. Signing the month is a separate CFO action.
//
// GET /api/finance/clients/:slug/asset-register   counts per grouping.
//
// Until migration 049 is applied every route answers migration_missing.

const imp = require("./asset-import");
const intakeLib = require("./asset-intake");
const monthLib = require("./asset-month");
const engine = require("./asset-register");

const XERO_ASSETS_API = "https://api.xero.com/assets.xro/1.0";
const groupingNames = Object.fromEntries(Object.values(require("./asset-groupings").GROUPINGS).map((g) => [g.key, g.name]));
const { isCfo } = require("./contracts");

const MISSING = "The asset register is waiting for migration 049 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";

function mountAssetRegister(app, { route, pool, audit, clientIdFromSlug, xeroEntityContext, xeroGet, viaInput }) {
  const BASE = "/api/finance/clients/:slug/asset-register";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  function person(req, res) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    if (origin.via) { res.status(403).json({ error: "only the CFO imports the asset register, in os.stza.io" }); return null; }
    return { actorEmail };
  }

  const roleOf = async (db, clientId, email) => (await db.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [clientId, email])).rows[0].role;

  app.get(BASE, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const rows = (await pool.query(
      `SELECT g.grouping, g.enabled, g.paused,
              (SELECT count(*)::int FROM finance.assets a WHERE a.client_id = g.client_id AND a.grouping = g.grouping) AS assets,
              (SELECT count(*)::int FROM finance.asset_cost_lines l WHERE l.client_id = g.client_id AND l.grouping = g.grouping) AS cost_lines,
              (SELECT count(*)::int FROM finance.asset_events e WHERE e.client_id = g.client_id AND e.grouping = g.grouping) AS events,
              (SELECT json_agg(json_build_object('period', p.period, 'status', p.status) ORDER BY p.period)
                 FROM finance.asset_register_periods p WHERE p.client_id = g.client_id AND p.grouping = g.grouping) AS periods
         FROM finance.asset_groupings_client g WHERE g.client_id = $1 ORDER BY g.grouping`, [client.id])).rows;
    res.json({ groupings: rows });
  }));

  app.post(`${BASE}/import`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO imports the asset register" });
    const body = req.body || {};
    const dryRun = !(body.dry_run === false || body.dry_run === "false");

    const companies = (await pool.query(
      `SELECT id, slug, name, reporting_framework FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name`, [client.id])).rows;
    const issues = imp.payloadIssues(body, companies);
    if (issues.length) return res.status(422).json({ issues });
    const already = (await pool.query("SELECT count(*)::int AS n FROM finance.assets WHERE client_id = $1 AND grouping = $2", [client.id, body.grouping])).rows[0].n;
    if (already) return res.status(409).json({ error: `The ${body.grouping} register already holds ${already} assets; an opening is imported once.` });

    // Xero, read before any connection is held: each company's chart, and its
    // trial balance at the opening date.
    const used = [...new Set([...body.assets.map((a) => a.entity), ...body.account_map.map((m) => m.entity), ...body.cost_lines.map((l) => l.owning_entity)])];
    const chart = {};
    const trialBalances = {};
    const ids = Object.fromEntries(companies.map((c) => [c.slug, c.id]));
    for (const slug of used) {
      const ctx = await xeroEntityContext(req.params.slug, slug);
      if (!ctx || ctx.error) return res.status(503).json({ error: `Xero could not be read for ${slug}: ${ctx?.error ?? "not connected"}` });
      try {
        const [accounts, tb] = await Promise.all([
          xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", {}),
          xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: body.as_at }),
        ]);
        chart[slug] = accounts?.Accounts ?? [];
        trialBalances[ids[slug]] = tb?.Reports?.[0] ?? tb;
      } catch (e) {
        return res.status(503).json({ error: `Xero could not be read for ${slug}: ${e.message}` });
      }
    }
    const resolved = imp.resolveAccounts(body, chart);
    if (resolved.issues.length) return res.status(422).json({ issues: resolved.issues });
    const cfg = (await pool.query("SELECT rec_tolerance FROM finance.client_finance_config WHERE client_id = $1", [client.id])).rows[0];
    const p = imp.plan(body, { idOf: resolved.idOf, ids });
    const tie = imp.openingTie(p, { trialBalances, namedItems: body.named_items || [], idOf: resolved.idOf, ids, tolerance: Number(cfg?.rec_tolerance ?? 0),
      tbAcknowledgements: body.tb_acknowledgements || [] });
    const nameOf = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const summary = {
      grouping: body.grouping, as_at: body.as_at, assets: p.assets.length, events: p.events.length, account_map: p.map.length,
      cost_lines: { total: p.lines.length, approved: p.lines.filter((l) => l.state === "approved").length,
        superseded: p.lines.filter((l) => l.state === "superseded").length, proposed: p.lines.filter((l) => l.state === "proposed").length },
      tie: tie.rows.map((r) => ({ company: nameOf[r.entity_id], account: r.account, register: r.register, ledger: r.ledger,
        difference: r.difference, named_items: r.named_items, unexplained: r.unexplained, ties: r.ties })),
      trial_balances: Object.entries(tie.footing).map(([id, f]) => ({ company: nameOf[id], debits: f.debits, credits: f.credits,
        xero_totals: f.xero_totals, difference: f.difference, acknowledged: f.acknowledged, foots: f.foots })),
      findings: body.findings || [],
    };
    if (!tie.ties) return res.status(422).json({ issues: tie.issues, ...summary });
    if (dryRun) return res.json({ dry_run: true, would_import: true, ...summary });

    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      if (!isCfo(await roleOf(conn, client.id, who.actorEmail))) throw Object.assign(new Error("only the CFO imports the asset register"), { status: 403 });
      const again = (await conn.query("SELECT 1 FROM finance.assets WHERE client_id = $1 AND grouping = $2 LIMIT 1", [client.id, body.grouping])).rows[0];
      if (again) throw Object.assign(new Error(`The ${body.grouping} register already holds assets`), { status: 409 });
      const actor = who.actorEmail;
      await conn.query(
        `INSERT INTO finance.asset_groupings_client (client_id, grouping, enabled, enabled_by, enabled_at, created_by)
         VALUES ($1,$2,true,$3,now(),$3)
         ON CONFLICT (client_id, grouping) DO UPDATE SET enabled = true, enabled_by = COALESCE(finance.asset_groupings_client.enabled_by, $3),
           enabled_at = COALESCE(finance.asset_groupings_client.enabled_at, now()), updated_at = now()`, [client.id, body.grouping, actor]);
      for (const m of p.map) {
        await conn.query(
          `INSERT INTO finance.asset_account_map (client_id, entity_id, grouping, role, xero_account_id, account_code, amortised_by, effective_from, effective_to, set_by, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [client.id, m.entity_id, m.grouping, m.role, m.xero_account_id, m.account_code, m.amortised_by, m.effective_from, m.effective_to, actor, m.note]);
      }
      const assetId = {};
      for (const a of p.assets) {
        assetId[a.key] = (await conn.query(
          `INSERT INTO finance.assets (client_id, entity_id, grouping, asset_no, name, status, cost_account_id, accum_account_id,
             filing_date, registration_date, expiry_date, completion_date, registration_no, jurisdiction, ipo_url, wipo_url, ip_category,
             fields, source_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
          [client.id, a.entity_id, a.grouping, a.asset_no, a.name, a.status, a.cost_account_id, a.accum_account_id,
            a.filing_date, a.registration_date, a.expiry_date, a.completion_date, a.registration_no, a.jurisdiction, a.ipo_url, a.wipo_url,
            a.ip_category, JSON.stringify(a.fields), JSON.stringify(a.source_ref), actor])).rows[0].id;
      }
      // Brought-forward and live lines first, so evidence lines can point at them.
      const order = [...p.lines].sort((x, y) => (x.state === "superseded") - (y.state === "superseded"));
      const bfOf = {};
      for (const l of order) {
        const superseded = l.state === "superseded" ? (bfOf[l.superseded_by_asset_key] ?? null) : null;
        const id = (await conn.query(
          `INSERT INTO finance.asset_cost_lines (client_id, grouping, source_type, billed_entity_id, owning_entity_id, supplier, invoice_no,
             line_date, source_net, source_vat, source_gross, proposal_no, phase, phase_name, work_description, item, item_type, jurisdiction,
             rd_milestone, ipo_status, fields, asset_id, amount, percent_info, treatment, reason_text, posted_account_id, posted_account_code,
             state, superseded_by, source_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING id`,
          [client.id, l.grouping, l.source_type, l.billed_entity_id, l.owning_entity_id, l.supplier, l.invoice_no, l.line_date,
            l.source_net, l.source_vat, l.source_gross, l.proposal_no, l.phase, l.phase_name, l.work_description, l.item, l.item_type,
            l.jurisdiction, l.rd_milestone, l.ipo_status, JSON.stringify(l.fields), l.asset_key ? assetId[l.asset_key] : null,
            l.amount, l.percent_info, l.treatment, l.reason_text, l.posted_account_id, l.posted_account_code, l.state, superseded,
            JSON.stringify(l.source_ref), actor])).rows[0].id;
        if (l.kind === "brought_forward") bfOf[l.asset_key] = id;
        await conn.query(
          `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
           VALUES ($1,'cost_line',$2,NULL,$3,$4,$5,$6,$7)`,
          [client.id, id, l.state, actor, role, `Opening import at ${body.as_at}`, JSON.stringify({ source: body.source })]);
      }
      for (const e of p.events) {
        await conn.query(
          `INSERT INTO finance.asset_events (client_id, entity_id, asset_id, grouping, kind, basis, period, event_date, amount, accounts, reason,
             evidence_ref, detail, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [client.id, e.entity_id, assetId[e.asset_key], body.grouping, e.kind, e.basis, e.period, e.event_date, e.amount,
            JSON.stringify(e.accounts), e.reason, e.evidence_ref, JSON.stringify({ source_ref: e.source_ref }), actor]);
      }
      const snapshot = { kind: "opening_import", source: body.source, tie: summary.tie, named_items: body.named_items || [],
        trial_balances: summary.trial_balances };
      await conn.query(
        `INSERT INTO finance.asset_register_periods (client_id, grouping, period, status, snapshot, trial_balance, prepared_by, prepared_at)
         VALUES ($1,$2,$3,'prepared',$4,$5,$6,now())
         ON CONFLICT (client_id, grouping, period) DO NOTHING`,
        [client.id, body.grouping, p.period, JSON.stringify(snapshot), JSON.stringify({ as_at: body.as_at, read_at: new Date().toISOString() }), actor]);
      await audit(conn, {
        actorEmail: actor, actorRole: role, action: "asset_register_imported", targetType: "asset_register", targetId: body.grouping, clientId: client.id,
        payload: { grouping: body.grouping, as_at: body.as_at, source: body.source, assets: p.assets.length, cost_lines: p.lines.length, events: p.events.length },
        ip: req.get("X-Forwarded-For") || req.ip,
      });
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    } finally {
      conn.release();
    }
    res.status(201).json({ imported: true, ...summary });
  }));

  // ── The month's intake from Xero ───────────────────────────────────────────
  //
  // POST .../asset-register/intake   { grouping, period: YYYY-MM, dry_run (default true),
  //   rules: [{ account_code, when_counterpart_code, belongs_to }], hints: [{ invoice_no, slices }] }
  // Every line Xero posted in the month to an account the grouping uses becomes
  // a proposed cost line, once (a line already held is skipped). The CFO only.

  const XERO_PAGES = 20;
  async function readMonth(ctx, period) {
    const [y, m] = period.split("-").map(Number);
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    const range = `Date >= DateTime(${y}, ${m}, 1) AND Date < DateTime(${next[0]}, ${next[1]}, 1)`;
    const paged = async (path, key, where) => {
      const out = [];
      for (let page = 1; page <= XERO_PAGES; page++) {
        const got = await xeroGet(ctx.accessToken, ctx.tenantId, path, { where, page });
        const items = got?.[key] ?? [];
        out.push(...items);
        if (items.length < 100) break;
      }
      return out;
    };
    return {
      bills: await paged("/Invoices", "Invoices", `Type=="ACCPAY" AND ${range}`),
      credit_notes: await paged("/CreditNotes", "CreditNotes", `Type=="ACCPAYCREDIT" AND ${range}`),
      bank_transactions: await paged("/BankTransactions", "BankTransactions", range),
      manual_journals: await paged("/ManualJournals", "ManualJournals", range),
    };
  }

  app.post(`${BASE}/intake`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO takes in the asset register's month" });
    const b = req.body || {};
    const dryRun = !(b.dry_run === false || b.dry_run === "false");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.period ?? ""))) return res.status(422).json({ issues: ["period must be YYYY-MM"] });
    const grouping = String(b.grouping ?? "");
    const g = (await pool.query("SELECT enabled, paused FROM finance.asset_groupings_client WHERE client_id = $1 AND grouping = $2", [client.id, grouping])).rows[0];
    if (!g?.enabled) return res.status(422).json({ issues: [`${grouping} is not switched on for this client`] });
    if (g.paused) return res.status(422).json({ issues: [`${grouping} is paused: no intake`] });
    const signed = (await pool.query("SELECT 1 FROM finance.asset_register_periods WHERE client_id = $1 AND grouping = $2 AND period = $3 AND status = 'signed'", [client.id, grouping, b.period])).rows[0];
    if (signed) return res.status(409).json({ error: `The ${grouping} register is signed for ${b.period}.` });

    const map = (await pool.query(
      `SELECT m.*, m.effective_from::text AS effective_from, m.effective_to::text AS effective_to, e.slug
         FROM finance.asset_account_map m JOIN finance.entities e ON e.id = m.entity_id
        WHERE m.client_id = $1 AND m.grouping = $2 AND m.ended_at IS NULL`, [client.id, grouping])).rows;
    const assets = (await pool.query("SELECT id, entity_id, asset_no, name, status, cost_account_id FROM finance.assets WHERE client_id = $1 AND grouping = $2", [client.id, grouping])).rows;
    // A Xero line is held while a line for it is proposed, approved or
    // rejected. Once withdrawn (with a split's original, superseded), it is
    // taken in again as it now stands in Xero.
    const existing = new Set((await pool.query(
      "SELECT source_type, xero_source_id, xero_line_id FROM finance.asset_cost_lines WHERE client_id = $1 AND xero_source_id IS NOT NULL AND state IN ('proposed', 'approved', 'rejected')", [client.id])).rows
      .map((r) => `${r.source_type}|${r.xero_source_id}|${r.xero_line_id}`));
    const docs = [];
    for (const slug of [...new Set(map.map((m) => m.slug))]) {
      const ctx = await xeroEntityContext(req.params.slug, slug);
      if (!ctx || ctx.error) return res.status(503).json({ error: `Xero could not be read for ${slug}: ${ctx?.error ?? "not connected"}` });
      try {
        docs.push({ entity_id: map.find((m) => m.slug === slug).entity_id, ...(await readMonth(ctx, b.period)) });
      } catch (e) {
        return res.status(503).json({ error: `Xero could not be read for ${slug}: ${e.message}` });
      }
    }
    const out = intakeLib.intake({ period: b.period, grouping, map, assets, docs, existing, rules: b.rules || [], hints: b.hints || [] });
    const assetNo = Object.fromEntries(assets.map((a) => [a.id, a.asset_no]));
    const view = {
      grouping, period: b.period,
      lines: out.lines.map((l) => ({ invoice_no: l.invoice_no, supplier: l.supplier, date: l.line_date, account: l.posted_account_code, amount: l.amount,
        asset: assetNo[l.asset_id] ?? null, treatment: l.treatment, reason: l.reason_text, question: l.fields.question ?? null })),
      set_aside: out.set_aside, findings: out.findings,
    };
    if (dryRun) return res.json({ dry_run: true, ...view });

    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      for (const l of out.lines) {
        const id = (await conn.query(
          `INSERT INTO finance.asset_cost_lines (client_id, grouping, source_type, xero_source_id, xero_line_id, billed_entity_id, owning_entity_id,
             supplier, invoice_no, line_date, source_net, source_vat, source_gross, currency, work_description, asset_id, amount, treatment,
             reason_text, posted_account_id, posted_account_code, state, fields, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'proposed',$22,$23) RETURNING id`,
          [client.id, grouping, l.source_type, l.xero_source_id, l.xero_line_id, l.billed_entity_id, l.owning_entity_id, l.supplier, l.invoice_no,
            l.line_date, l.source_net, l.source_vat, l.source_gross, l.currency, l.work_description, l.asset_id, l.amount, l.treatment,
            l.reason_text, l.posted_account_id, l.posted_account_code, JSON.stringify(l.fields), who.actorEmail])).rows[0].id;
        await conn.query(
          `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
           VALUES ($1,'cost_line',$2,NULL,'proposed',$3,$4,$5,$6)`,
          [client.id, id, who.actorEmail, role, `Intake from Xero for ${b.period}`, JSON.stringify({ allocation: l.fields.allocation ?? null })]);
      }
      await audit(conn, { actorEmail: who.actorEmail, actorRole: role, action: "asset_register_intake", targetType: "asset_register", targetId: grouping,
        clientId: client.id, payload: { period: b.period, lines: out.lines.length, set_aside: out.set_aside }, ip: req.get("X-Forwarded-For") || req.ip });
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    res.status(201).json({ taken_in: out.lines.length, ...view });
  }));

  // ── Deciding cost lines ────────────────────────────────────────────────────
  //
  // POST .../asset-register/cost-lines/decide
  //   { decisions: [{ id, action: "approve" | "reject" | "split" | "attach" | "withdraw", asset_no?, treatment?, reason }] }
  // The CFO decides proposed lines: approve (with the asset and treatment, and
  // a reason), or reject. All or none; every decision is an approval row.

  const TREATMENTS = ["capitalise", "expense_research", "expense_admin", "training", "marketing", "inventory", "other_register"];
  app.post(`${BASE}/cost-lines/decide`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    if (!decisions.length) return res.status(422).json({ issues: ["decisions is required"] });
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = await roleOf(conn, client.id, who.actorEmail);
      if (!isCfo(role)) { await conn.query("ROLLBACK"); return res.status(403).json({ error: "only the CFO decides cost lines" }); }
      const issues = [];
      const withdrawn = [];
      for (const [i, d] of decisions.entries()) {
        const where = `decision ${i + 1}`;
        const line = (await conn.query("SELECT * FROM finance.asset_cost_lines WHERE client_id = $1 AND id = $2 FOR UPDATE", [client.id, d.id])).rows[0];
        if (!line) { issues.push(`${where}: no cost line ${d.id}`); continue; }
        if (d.action === "withdraw") {
          // The source document changed in Xero after the line was taken in
          // (recoded, credited, voided). The line leaves the register, kept
          // for the record; the next intake takes the document in again as it
          // now stands. Every slice of the source line goes together, so no
          // part of a split is left behind. A signed month refuses it (the
          // period lock): reopen first.
          if (!["proposed", "approved"].includes(line.state)) { issues.push(`${where}: the line is ${line.state}; only a proposed or approved line can be withdrawn`); continue; }
          if (!line.xero_source_id) { issues.push(`${where}: only a line taken in from Xero can be withdrawn; a workbook line is history`); continue; }
          if (String(d.reason ?? "").trim().length < 10) { issues.push(`${where}: say what changed in Xero (at least 10 characters)`); continue; }
          await conn.query("UPDATE finance.asset_cost_lines SET state = 'withdrawn', updated_at = now() WHERE id = $1", [line.id]);
          await conn.query(
            `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
             VALUES ($1,'cost_line',$2,$3,'withdrawn',$4,$5,$6,$7)`,
            [client.id, line.id, line.state, who.actorEmail, role, String(d.reason).trim(),
              JSON.stringify({ source_type: line.source_type, xero_source_id: line.xero_source_id, xero_line_id: line.xero_line_id })]);
          withdrawn.push(line);
          continue;
        }
        if (line.state !== "proposed") { issues.push(`${where}: the line is ${line.state}, not proposed`); continue; }
        if (String(d.reason ?? "").trim().length < 3) { issues.push(`${where}: a reason is required`); continue; }
        if (d.action === "attach") {
          // A line dated on or before the opening is history: the opening's
          // brought-forward cost already holds it (the opening tied to the
          // ledger without it). It is kept as evidence on its asset, replaced
          // by that asset's brought-forward line, never counted again.
          const opening = (await conn.query(
            `SELECT period FROM finance.asset_register_periods WHERE client_id = $1 AND grouping = $2 AND snapshot->>'kind' = 'opening_import'`,
            [client.id, line.grouping])).rows[0];
          const asAt = opening ? engine.monthEnd(opening.period) : null;
          if (!asAt || String(line.line_date.toISOString?.().slice(0, 10) ?? line.line_date) > asAt) { issues.push(`${where}: only a line dated on or before the opening can be attached as evidence`); continue; }
          const a = d.asset_no ? (await conn.query("SELECT id FROM finance.assets WHERE client_id = $1 AND grouping = $2 AND asset_no = $3", [client.id, line.grouping, d.asset_no])).rows[0] : null;
          if (!a) { issues.push(`${where}: attach needs the asset it belongs to`); continue; }
          const bf = (await conn.query(
            `SELECT id FROM finance.asset_cost_lines WHERE client_id = $1 AND asset_id = $2 AND state = 'approved' AND source_type = 'workbook' AND line_date = $3
              ORDER BY created_at LIMIT 1`, [client.id, a.id, asAt])).rows[0];
          if (!bf) { issues.push(`${where}: ${d.asset_no} has no brought-forward line at ${asAt} to hold it`); continue; }
          const treatment = d.treatment ?? "capitalise";
          if (!TREATMENTS.includes(treatment)) { issues.push(`${where}: treatment ${treatment} is not allowed`); continue; }
          await conn.query(
            `UPDATE finance.asset_cost_lines SET state = 'superseded', superseded_by = $2, asset_id = $3, treatment = $4, reason_text = $5,
               fields = (fields - 'question') || '{"attached_as_evidence": true}'::jsonb, updated_at = now() WHERE id = $1`,
            [line.id, bf.id, a.id, treatment, String(d.reason).trim()]);
          await conn.query(
            `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
             VALUES ($1,'cost_line',$2,'proposed','superseded',$3,$4,$5,$6)`,
            [client.id, line.id, who.actorEmail, role, String(d.reason).trim(), JSON.stringify({ attached_to: d.asset_no, brought_forward_line: bf.id })]);
          continue;
        }
        if (d.action === "split") {
          // One line into slices across assets: the slices must make the line.
          const slices = Array.isArray(d.slices) ? d.slices : [];
          const total = engine.r2(slices.reduce((t, x) => t + Number(x.amount), 0));
          if (slices.length < 2) { issues.push(`${where}: a split needs at least two slices`); continue; }
          if (total !== engine.r2(line.amount)) { issues.push(`${where}: slices make ${total.toFixed(2)}, the line is ${Number(line.amount).toFixed(2)}`); continue; }
          let firstId = null;
          let bad = false;
          for (const sl of slices) {
            const treatment = sl.treatment ?? "capitalise";
            if (!TREATMENTS.includes(treatment)) { issues.push(`${where}: treatment ${treatment} is not allowed`); bad = true; break; }
            const a = sl.asset_no ? (await conn.query("SELECT id FROM finance.assets WHERE client_id = $1 AND grouping = $2 AND asset_no = $3", [client.id, line.grouping, sl.asset_no])).rows[0] : null;
            if (sl.asset_no && !a) { issues.push(`${where}: no asset ${sl.asset_no} in ${line.grouping}`); bad = true; break; }
            if (treatment === "capitalise" && !a) { issues.push(`${where}: capitalised cost needs its asset`); bad = true; break; }
            const sliceReason = String(sl.reason ?? d.reason).trim();
            const id = (await conn.query(
              `INSERT INTO finance.asset_cost_lines (client_id, grouping, source_type, xero_source_id, xero_line_id, billed_entity_id, owning_entity_id,
                 supplier, invoice_no, line_date, source_net, source_vat, source_gross, currency, work_description, asset_id, amount, treatment,
                 reason_text, posted_account_id, posted_account_code, state, fields, source_ref, created_by)
               SELECT client_id, grouping, source_type, xero_source_id, xero_line_id, billed_entity_id, owning_entity_id, supplier, invoice_no, line_date,
                 source_net, source_vat, source_gross, currency, work_description, $2, $3, $4, $5, posted_account_id, posted_account_code, 'approved',
                 (fields - 'question') || jsonb_build_object('source_key', COALESCE(fields->>'source_key', xero_source_id || '|' || xero_line_id), 'split_from', id::text),
                 source_ref, $6
                 FROM finance.asset_cost_lines WHERE id = $1 RETURNING id`,
              [line.id, a?.id ?? null, engine.r2(sl.amount), treatment, sliceReason, who.actorEmail])).rows[0].id;
            firstId = firstId ?? id;
            await conn.query(
              `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
               VALUES ($1,'cost_line',$2,NULL,'approved',$3,$4,$5,$6)`,
              [client.id, id, who.actorEmail, role, sliceReason, JSON.stringify({ split_from: line.id })]);
          }
          if (bad) continue;
          await conn.query("UPDATE finance.asset_cost_lines SET state = 'superseded', superseded_by = $2, updated_at = now() WHERE id = $1", [line.id, firstId]);
          await conn.query(
            `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
             VALUES ($1,'cost_line',$2,'proposed','superseded',$3,$4,$5,$6)`,
            [client.id, line.id, who.actorEmail, role, String(d.reason).trim(), JSON.stringify({ split_into: slices.length })]);
          continue;
        }
        if (d.action === "reject") {
          await conn.query("UPDATE finance.asset_cost_lines SET state = 'rejected', updated_at = now() WHERE id = $1", [line.id]);
        } else if (d.action === "approve") {
          const treatment = d.treatment ?? line.treatment;
          if (!TREATMENTS.includes(treatment)) { issues.push(`${where}: treatment must be one of ${TREATMENTS.join(", ")}`); continue; }
          let assetId = line.asset_id;
          if (d.asset_no) {
            const a = (await conn.query("SELECT id FROM finance.assets WHERE client_id = $1 AND grouping = $2 AND asset_no = $3", [client.id, line.grouping, d.asset_no])).rows[0];
            if (!a) { issues.push(`${where}: no asset ${d.asset_no} in ${line.grouping}`); continue; }
            assetId = a.id;
          }
          if (treatment === "capitalise" && !assetId) { issues.push(`${where}: capitalised cost needs its asset`); continue; }
          await conn.query(
            `UPDATE finance.asset_cost_lines SET state = 'approved', treatment = $2, asset_id = $3, reason_text = $4,
               fields = fields - 'question', updated_at = now() WHERE id = $1`, [line.id, treatment, assetId, String(d.reason).trim()]);
        } else { issues.push(`${where}: action must be approve, split, attach, reject or withdraw`); continue; }
        await conn.query(
          `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason, detail)
           VALUES ($1,'cost_line',$2,'proposed',$3,$4,$5,$6,$7)`,
          [client.id, line.id, d.action === "approve" ? "approved" : "rejected", who.actorEmail, role, String(d.reason).trim(),
            JSON.stringify({ asset_no: d.asset_no ?? null, treatment: d.treatment ?? null })]);
      }
      for (const w of withdrawn) {
        const left = (await conn.query(
          `SELECT id FROM finance.asset_cost_lines WHERE client_id = $1 AND source_type = $2 AND xero_source_id = $3
              AND xero_line_id IS NOT DISTINCT FROM $4 AND state IN ('proposed', 'approved')`,
          [client.id, w.source_type, w.xero_source_id, w.xero_line_id])).rows;
        if (left.length) issues.push(`withdrawing ${w.id} leaves ${left.length} other slice(s) of the same Xero line in the register (${left.map((x) => x.id).join(", ")}): withdraw them together`);
      }
      if (issues.length) { await conn.query("ROLLBACK"); return res.status(422).json({ issues }); }
      await conn.query("COMMIT");
      res.json({ decided: decisions.length });
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      if (e.code === "23514" && /signed/.test(e.message)) return res.status(409).json({ error: e.message });
      throw e;
    } finally {
      conn.release();
    }
  }));


  // ── New assets ─────────────────────────────────────────────────────────────
  //
  // POST .../asset-register/assets   { grouping, dry_run (default true), assets: [{ entity, asset_no, name,
  //   status, cost_account, accum_account?, parent_asset_no?, filing_date?, registration_date?, expiry_date?,
  //   registration_no?, jurisdiction?, ipo_url?, wipo_url?, ip_category?, fields?, source_ref? }] }
  // The CFO adds assets that came after the opening (a new filing, a new
  // component). Accounts are codes in the grouping's own account map.

  const STATUSES = ["research", "wip", "pending", "available", "registered", "impaired", "disposed", "lapsed"];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  app.post(`${BASE}/assets`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO adds assets to the register" });
    const b = req.body || {};
    const dryRun = !(b.dry_run === false || b.dry_run === "false");
    const grouping = String(b.grouping ?? "");
    const list = Array.isArray(b.assets) ? b.assets : [];
    if (!list.length) return res.status(422).json({ issues: ["assets is required"] });
    const g = (await pool.query("SELECT enabled FROM finance.asset_groupings_client WHERE client_id = $1 AND grouping = $2", [client.id, grouping])).rows[0];
    if (!g?.enabled) return res.status(422).json({ issues: [`${grouping} is not switched on for this client`] });
    const map = (await pool.query(
      `SELECT m.xero_account_id, m.account_code, m.role, e.slug, e.id AS entity_id FROM finance.asset_account_map m JOIN finance.entities e ON e.id = m.entity_id
        WHERE m.client_id = $1 AND m.grouping = $2 AND m.ended_at IS NULL`, [client.id, grouping])).rows;
    const held = new Set((await pool.query("SELECT entity_id, asset_no FROM finance.assets WHERE client_id = $1", [client.id])).rows.map((r) => `${r.entity_id}|${r.asset_no}`));
    const parents = Object.fromEntries((await pool.query("SELECT id, asset_no FROM finance.assets WHERE client_id = $1 AND grouping = $2", [client.id, grouping])).rows.map((r) => [r.asset_no, r.id]));
    const issues = [];
    const rows = list.map((a, i) => {
      const where = `asset ${a.asset_no ?? i + 1}`;
      const acc = (code, roles) => map.find((m) => m.slug === a.entity && String(m.account_code) === String(code) && roles.includes(m.role));
      const cost = acc(a.cost_account, ["cost", "wip"]);
      const accum = a.accum_account ? acc(a.accum_account, ["accumulated"]) : null;
      if (!String(a.asset_no ?? "").trim() || !String(a.name ?? "").trim()) issues.push(`${where}: needs a number and a name`);
      if (!map.some((m) => m.slug === a.entity)) issues.push(`${where}: ${a.entity} has no accounts in this grouping`);
      if (!STATUSES.includes(a.status)) issues.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
      if (!cost) issues.push(`${where}: cost account ${a.cost_account} is not a cost or WIP account of this grouping for ${a.entity}`);
      if (a.accum_account && !accum) issues.push(`${where}: accumulated account ${a.accum_account} is not in this grouping's map for ${a.entity}`);
      if (a.parent_asset_no && !parents[a.parent_asset_no]) issues.push(`${where}: no parent ${a.parent_asset_no}`);
      for (const k of ["filing_date", "registration_date", "expiry_date"]) if (a[k] && !DAY.test(String(a[k]))) issues.push(`${where}: ${k} must be YYYY-MM-DD`);
      const entityId = cost?.entity_id ?? map.find((m) => m.slug === a.entity)?.entity_id;
      if (entityId && held.has(`${entityId}|${a.asset_no}`)) issues.push(`${where}: already in the register`);
      return { ...a, entity_id: entityId, cost_account_id: cost?.xero_account_id ?? null, accum_account_id: accum?.xero_account_id ?? null,
        parent_asset_id: a.parent_asset_no ? parents[a.parent_asset_no] ?? null : null };
    });
    if (issues.length) return res.status(422).json({ issues });
    if (dryRun) return res.json({ dry_run: true, would_add: rows.map((r) => ({ asset_no: r.asset_no, entity: r.entity, status: r.status, cost_account: r.cost_account })) });
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      for (const a of rows) {
        await conn.query(
          `INSERT INTO finance.assets (client_id, entity_id, grouping, asset_no, name, parent_asset_id, status, cost_account_id, accum_account_id,
             filing_date, registration_date, expiry_date, registration_no, jurisdiction, ipo_url, wipo_url, ip_category, fields, source_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [client.id, a.entity_id, grouping, a.asset_no, a.name, a.parent_asset_id, a.status, a.cost_account_id, a.accum_account_id,
            a.filing_date ?? null, a.registration_date ?? null, a.expiry_date ?? null, a.registration_no ?? null, a.jurisdiction ?? null,
            a.ipo_url ?? null, a.wipo_url ?? null, a.ip_category ?? null, JSON.stringify(a.fields || {}), a.source_ref ? JSON.stringify(a.source_ref) : null, who.actorEmail]);
      }
      await audit(conn, { actorEmail: who.actorEmail, actorRole: role, action: "asset_register_assets_added", targetType: "asset_register", targetId: grouping,
        clientId: client.id, payload: { assets: rows.map((r) => r.asset_no) }, ip: req.get("X-Forwarded-For") || req.ip });
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    res.status(201).json({ added: rows.length });
  }));

  // ── Preparing and signing a month ──────────────────────────────────────────
  //
  // POST .../asset-register/periods/prepare  { grouping, period, dry_run (default true), rules, tb_acknowledgements: [{ entity, difference, reason }] }
  // POST .../asset-register/periods/sign     { grouping, period }
  // Months are prepared and signed in order after the opening. A signed month
  // refuses any change dated in it (migration 049).

  const periodRows = async (db, clientId, grouping) => (await db.query(
    "SELECT period, status, snapshot FROM finance.asset_register_periods WHERE client_id = $1 AND grouping = $2 ORDER BY period", [clientId, grouping])).rows;

  app.post(`${BASE}/periods/prepare`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO prepares the asset register's month" });
    const b = req.body || {};
    const dryRun = !(b.dry_run === false || b.dry_run === "false");
    const grouping = String(b.grouping ?? "");
    const period = String(b.period ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(422).json({ issues: ["period must be YYYY-MM"] });
    const periods = await periodRows(pool, client.id, grouping);
    const opening = periods.find((p) => p.snapshot?.kind === "opening_import");
    if (!opening) return res.status(422).json({ issues: [`${grouping} has no opening; import it first`] });
    if (period <= opening.period) return res.status(422).json({ issues: [`${period} is not after the opening (${opening.period})`] });
    const prev = periods.find((p) => p.period === engine.addMonths(period, -1));
    if (!prev || !["prepared", "signed"].includes(prev.status)) return res.status(422).json({ issues: [`Prepare ${engine.addMonths(period, -1)} first.`] });
    if (periods.find((p) => p.period === period)?.status === "signed") return res.status(409).json({ error: `${period} is signed.` });

    const map = (await pool.query(
      `SELECT m.*, m.effective_from::text AS effective_from, m.effective_to::text AS effective_to, e.slug, e.name AS company
         FROM finance.asset_account_map m JOIN finance.entities e ON e.id = m.entity_id
        WHERE m.client_id = $1 AND m.grouping = $2 AND m.ended_at IS NULL`, [client.id, grouping])).rows;
    const assets = (await pool.query("SELECT id, entity_id, asset_no, name, status, cost_account_id, accum_account_id FROM finance.assets WHERE client_id = $1 AND grouping = $2", [client.id, grouping])).rows;
    const lines = (await pool.query(
      `SELECT id, state, asset_id, owning_entity_id, amount::float AS amount, source_net::float AS source_net, line_date::text AS line_date, treatment,
              posted_account_id, expected_account_id, source_type, xero_source_id, xero_line_id, source_ref, fields, invoice_no
         FROM finance.asset_cost_lines WHERE client_id = $1 AND grouping = $2 AND state IN ('proposed', 'approved')`, [client.id, grouping])).rows;
    const events = (await pool.query(
      `SELECT id, asset_id, entity_id, kind, period, amount::float AS amount, accounts, detail, reverses_event_id
         FROM finance.asset_events WHERE client_id = $1 AND grouping = $2`, [client.id, grouping])).rows;
    const nameOf = Object.fromEntries(map.map((m) => [m.entity_id, m.company]));
    const end = engine.monthEnd(period);
    const asAt = opening.snapshot?.trial_balance_as_at ?? engine.monthEnd(opening.period);
    const trialBalances = {};
    const openingTrialBalances = {};
    const lastDepreciation = {};
    const setAside = {};
    const months = monthLib.monthsAfter(opening.period, period);
    for (const slug of [...new Set(map.map((m) => m.slug))]) {
      const ctx = await xeroEntityContext(req.params.slug, slug);
      if (!ctx || ctx.error) return res.status(503).json({ error: `Xero could not be read for ${slug}: ${ctx?.error ?? "not connected"}` });
      const id = map.find((m) => m.slug === slug).entity_id;
      const xeroOwned = map.some((m) => m.slug === slug && m.role === "accumulated" && m.amortised_by === "xero");
      try {
        const tb = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: end });
        trialBalances[id] = tb?.Reports?.[0] ?? tb;
        if (xeroOwned) {
          const otb = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date: asAt });
          openingTrialBalances[id] = otb?.Reports?.[0] ?? otb;
          const settings = await xeroGet(ctx.accessToken, ctx.tenantId, `${XERO_ASSETS_API}/Settings`, {});
          lastDepreciation[id] = settings?.lastDepreciationDate ?? null;
        }
        if ((b.rules || []).length) {
          for (const m of months) {
            const out = intakeLib.intake({ period: m, grouping, map, assets, docs: [{ entity_id: id, ...(await readMonth(ctx, m)) }], rules: b.rules });
            for (const s of out.set_aside) {
              const k = `${s.entity_id}|${s.account_code}|${s.belongs_to}`;
              setAside[k] = engine.r2((setAside[k] ?? 0) + s.amount);
            }
          }
        }
      } catch (e) {
        return res.status(503).json({ error: `Xero could not be read for ${slug}: ${e.message}` });
      }
    }
    const idOf = (slug, code) => map.find((m) => m.slug === slug && String(m.account_code) === String(code))?.xero_account_id;
    const entityOf = (slug) => map.find((m) => m.slug === slug)?.entity_id;
    const namedItems = (opening.snapshot?.named_items || []).map((n) => ({ entity_id: entityOf(n.entity), account_id: idOf(n.entity, n.account), label: n.label, amount: Number(n.amount) }))
      .concat(Object.entries(setAside).map(([k, amount]) => {
        const [entityId, code, belongs] = k.split("|");
        return { entity_id: entityId, account_id: map.find((m) => m.entity_id === entityId && String(m.account_code) === code)?.xero_account_id,
          label: `${belongs}'s share, set aside at intake ${months[0]} to ${period}`, amount };
      }));
    const acks = (b.tb_acknowledgements || []).map((t) => ({ entity_id: entityOf(t.entity), difference: Number(t.difference), reason: t.reason }));
    const cfg = (await pool.query("SELECT rec_tolerance FROM finance.client_finance_config WHERE client_id = $1", [client.id])).rows[0];
    const result = monthLib.prepareMonth({ period, map, assets, lines, events, trialBalances, openingTrialBalances, namedItems, lastDepreciation,
      tbAcknowledgements: acks, tolerance: Number(cfg?.rec_tolerance ?? 0), nameOf });
    if (!result.prepared) return res.status(422).json(result);
    if (dryRun) return res.json({ dry_run: true, ...result });
    await pool.query(
      `INSERT INTO finance.asset_register_periods (client_id, grouping, period, status, snapshot, trial_balance, prepared_by, prepared_at)
       VALUES ($1,$2,$3,'prepared',$4,$5,$6,now())
       ON CONFLICT (client_id, grouping, period) DO UPDATE SET status = 'prepared', snapshot = EXCLUDED.snapshot, trial_balance = EXCLUDED.trial_balance,
         prepared_by = EXCLUDED.prepared_by, prepared_at = now(), updated_at = now()
       WHERE finance.asset_register_periods.status <> 'signed'`,
      [client.id, grouping, period, JSON.stringify({ kind: "month", ...result, named_items: namedItems }), JSON.stringify({ as_at: end, read_at: new Date().toISOString() }), who.actorEmail]);
    res.status(201).json({ prepared: true, ...result });
  }));

  // POST .../asset-register/periods/reopen   { grouping, period, reason }
  // The CFO reopens a signed month: only the latest signed one (a later
  // signed month would stand on it), with a reason, audited. It goes back to
  // open, keeping its last snapshot for comparison; it is then prepared and
  // signed again as any month.
  app.post(`${BASE}/periods/reopen`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const b = req.body || {};
    const reason = String(b.reason ?? "").trim();
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = await roleOf(conn, client.id, who.actorEmail);
      if (!isCfo(role)) { await conn.query("ROLLBACK"); return res.status(403).json({ error: "only the CFO reopens a signed month" }); }
      if (reason.length < 10) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: ["Say why the month is reopened, in at least 10 characters"] }); }
      const periods = await periodRows(conn, client.id, String(b.grouping ?? ""));
      const p = periods.find((x) => x.period === b.period);
      if (!p) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`no ${b.period} for ${b.grouping}`] }); }
      if (p.status !== "signed") { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`${b.period} is ${p.status}, not signed`] }); }
      const later = periods.filter((x) => x.period > b.period && x.status === "signed");
      if (later.length) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`Reopen ${later.map((x) => x.period).reverse().join(", ")} first: a later signed month stands on this one.`] }); }
      const row = (await conn.query(
        `UPDATE finance.asset_register_periods SET status = 'open', reopened_by = $4, reopened_at = now(), reopen_reason = $5, updated_at = now()
          WHERE client_id = $1 AND grouping = $2 AND period = $3 RETURNING id`, [client.id, b.grouping, b.period, who.actorEmail, reason])).rows[0];
      await conn.query(
        `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason)
         VALUES ($1,'period',$2,'signed','open',$3,$4,$5)`, [client.id, row.id, who.actorEmail, role, reason]);
      await audit(conn, { actorEmail: who.actorEmail, actorRole: role, action: "asset_register_period_reopened", targetType: "asset_register", targetId: `${b.grouping} ${b.period}`,
        clientId: client.id, payload: { reason }, ip: req.get("X-Forwarded-For") || req.ip });
      await conn.query("COMMIT");
      res.json({ reopened: true, grouping: b.grouping, period: b.period });
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }));

  app.post(`${BASE}/periods/sign`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const b = req.body || {};
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = await roleOf(conn, client.id, who.actorEmail);
      if (!isCfo(role)) { await conn.query("ROLLBACK"); return res.status(403).json({ error: "only the CFO signs the asset register's month" }); }
      const periods = await periodRows(conn, client.id, String(b.grouping ?? ""));
      const p = periods.find((x) => x.period === b.period);
      if (!p) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`no ${b.period} for ${b.grouping}`] }); }
      const reopenedOpening = p.status === "open" && p.snapshot?.kind === "opening_import";
      if (p.status !== "prepared" && !reopenedOpening) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`${b.period} is ${p.status}; prepare it first`] }); }
      const earlier = periods.filter((x) => x.period < b.period && x.status !== "signed");
      if (earlier.length) { await conn.query("ROLLBACK"); return res.status(422).json({ issues: [`Sign ${earlier.map((x) => x.period).join(", ")} first.`] }); }
      const row = (await conn.query(
        `UPDATE finance.asset_register_periods SET status = 'signed', signed_by = $4, signed_at = now(), updated_at = now()
          WHERE client_id = $1 AND grouping = $2 AND period = $3 RETURNING id`, [client.id, b.grouping, b.period, who.actorEmail])).rows[0];
      await conn.query(
        `INSERT INTO finance.asset_approvals (client_id, subject_kind, subject_id, from_state, to_state, actor, role, reason)
         VALUES ($1,'period',$2,'prepared','signed',$3,$4,$5)`, [client.id, row.id, who.actorEmail, role, `Signed ${b.grouping} ${b.period}`]);
      await conn.query("COMMIT");
      res.json({ signed: true, grouping: b.grouping, period: b.period });
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }));

  // ── Export for the workbook ────────────────────────────────────────────────
  //
  // GET .../asset-register/export?grouping=&period=   the register for one
  // grouping at a prepared or signed month, in the shape pack_engine/assets.py
  // writes: assets, approved cost lines and event effects up to the month end,
  // and the month's ledger, named items and Xero's own movement from its
  // snapshot. Read only.
  app.get(`${BASE}/export`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const grouping = String(req.query.grouping ?? "");
    const period = String(req.query.period ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(422).json({ issues: ["period must be YYYY-MM"] });
    const periods = (await pool.query(
      `SELECT period, status, snapshot, signed_by, signed_at, prepared_at FROM finance.asset_register_periods
        WHERE client_id = $1 AND grouping = $2 ORDER BY period`, [client.id, grouping])).rows;
    const opening = periods.find((p) => p.snapshot?.kind === "opening_import");
    const row = periods.find((p) => p.period === period);
    if (!opening || !row) return res.status(422).json({ issues: [`${grouping} has no ${period}`] });
    if (!["prepared", "signed"].includes(row.status)) return res.status(422).json({ issues: [`${period} is ${row.status}: prepare it first`] });
    const end = engine.monthEnd(period);
    const months = [opening.period, ...monthLib.monthsAfter(opening.period, period)];

    const map = (await pool.query(
      `SELECT m.entity_id, m.xero_account_id, m.account_code, e.name AS company FROM finance.asset_account_map m
         JOIN finance.entities e ON e.id = m.entity_id WHERE m.client_id = $1 AND m.grouping = $2`, [client.id, grouping])).rows;
    const codeOf = (entityId, accountId) => map.find((m) => m.entity_id === entityId && String(m.xero_account_id).toLowerCase() === String(accountId ?? "").toLowerCase())?.account_code ?? null;
    const companyOf = Object.fromEntries((await pool.query("SELECT id, name FROM finance.entities WHERE client_id = $1", [client.id])).rows.map((e) => [e.id, e.name]));
    const assets = (await pool.query(
      `SELECT id, entity_id, asset_no, name, status, cost_account_id, accum_account_id, registration_date::text AS registration_date,
              expiry_date::text AS expiry_date, available_for_use_date::text AS available_for_use_date, jurisdiction
         FROM finance.assets WHERE client_id = $1 AND grouping = $2 ORDER BY asset_no`, [client.id, grouping])).rows;
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const lines = (await pool.query(
      `SELECT id, owning_entity_id, asset_id, line_date::text AS line_date, supplier, invoice_no, amount::float AS amount, source_net::float AS source_net,
              treatment, reason_text, posted_account_id, posted_account_code, source_type, xero_source_id, xero_line_id, source_ref, fields
         FROM finance.asset_cost_lines WHERE client_id = $1 AND grouping = $2 AND state = 'approved' AND line_date <= $3
        ORDER BY line_date, invoice_no`, [client.id, grouping, end])).rows;
    const events = (await pool.query(
      `SELECT id, asset_id, entity_id, kind, period, event_date::text AS event_date, amount::float AS amount, accounts, detail, reverses_event_id, reason
         FROM finance.asset_events WHERE client_id = $1 AND grouping = $2 AND period <= $3 ORDER BY event_date`, [client.id, grouping, period])).rows;
    const eventById = new Map(events.map((e) => [e.id, e]));

    const snapshotRows = row.snapshot?.accounts
      ? row.snapshot.accounts.map((a) => ({ company: a.company, account: codeOf(a.entity_id, a.account_id) ?? (/\((\w+)\)\s*$/.exec(a.account ?? "")?.[1] ?? null),
          account_name: a.account, ledger: a.ledger, register: a.register, named: (a.named_items || []).reduce((s, n) => s + Number(n.amount), 0),
          named_labels: (a.named_items || []).map((n) => n.label), by_xero: a.by_xero ?? 0 }))
      : (row.snapshot?.tie || []).map((t) => ({ company: t.company, account: /\((\w+)\)\s*$/.exec(t.account ?? "")?.[1] ?? null, account_name: t.account,
          ledger: t.ledger, register: t.register, named: (t.named_items || []).reduce((s, n) => s + Number(n.amount), 0),
          named_labels: (t.named_items || []).map((n) => n.label), by_xero: 0 }));

    res.json({
      client: req.params.slug, grouping, grouping_name: groupingNames[grouping] ?? grouping, period, months,
      status: row.status, signed_by: row.signed_by, signed_at: row.signed_at, read_at: new Date().toISOString(),
      assets: assets.map((a) => ({ asset_no: a.asset_no, name: a.name, company: companyOf[a.entity_id], status: a.status,
        cost_account: codeOf(a.entity_id, a.cost_account_id), accum_account: codeOf(a.entity_id, a.accum_account_id),
        registration_date: a.registration_date, available_for_use_date: a.available_for_use_date, expiry_date: a.expiry_date, jurisdiction: a.jurisdiction })),
      lines: lines.map((l) => {
        const a = assetById.get(l.asset_id);
        return { id: l.id, date: l.line_date, period: l.line_date.slice(0, 7), company: companyOf[l.owning_entity_id], asset_no: a?.asset_no ?? null,
          account: l.posted_account_code ?? codeOf(l.owning_entity_id, l.posted_account_id ?? a?.cost_account_id),
          supplier: l.supplier, invoice_no: l.invoice_no, amount: l.amount, treatment: l.treatment, reason: l.reason_text,
          source: l.xero_source_id ? `Xero ${l.source_type} ${l.xero_source_id}` : (l.source_ref ? `${l.source_ref.sheet ?? ""} row ${l.source_ref.row ?? ""}`.trim() : null),
          source_key: l.fields?.source_key ?? (l.xero_source_id ? `${l.xero_source_id}|${l.xero_line_id}` : null), source_net: l.source_net };
      }),
      events: events.flatMap((e) => engine.eventEffects(e, assetById.get(e.asset_id), eventById).map((x) => ({
        date: e.event_date, period: e.period, company: companyOf[e.entity_id], asset_no: assetById.get(e.asset_id)?.asset_no ?? null, kind: e.kind,
        account: codeOf(e.entity_id, x.account), side: x.side, amount: x.amount, reason: e.reason }))),
      ledger: snapshotRows,
      file_stem: `Asset register - ${groupingNames[grouping] ?? grouping} - ${period}`,
    });
  }));

  // GET .../asset-register/cost-lines?state=proposed   lines waiting on the CFO.
  app.get(`${BASE}/cost-lines`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const state = ["proposed", "approved", "rejected", "superseded"].includes(req.query.state) ? req.query.state : "proposed";
    const rows = (await pool.query(
      `SELECT l.id, l.grouping, l.invoice_no, l.supplier, l.line_date::text AS line_date, l.amount::float AS amount, l.posted_account_code,
              l.treatment, l.reason_text, l.fields->>'question' AS question, a.asset_no, e.name AS company
         FROM finance.asset_cost_lines l JOIN finance.entities e ON e.id = l.owning_entity_id LEFT JOIN finance.assets a ON a.id = l.asset_id
        WHERE l.client_id = $1 AND l.state = $2 ORDER BY l.grouping, l.line_date, l.invoice_no`, [client.id, state])).rows;
    res.json({ state, lines: rows });
  }));
}

module.exports = { mountAssetRegister };
