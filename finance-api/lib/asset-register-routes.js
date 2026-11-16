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
    const tie = imp.openingTie(p, { trialBalances, namedItems: body.named_items || [], idOf: resolved.idOf, ids, tolerance: Number(cfg?.rec_tolerance ?? 0) });
    const nameOf = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const summary = {
      grouping: body.grouping, as_at: body.as_at, assets: p.assets.length, events: p.events.length, account_map: p.map.length,
      cost_lines: { total: p.lines.length, approved: p.lines.filter((l) => l.state === "approved").length,
        superseded: p.lines.filter((l) => l.state === "superseded").length, proposed: p.lines.filter((l) => l.state === "proposed").length },
      tie: tie.rows.map((r) => ({ company: nameOf[r.entity_id], account: r.account, register: r.register, ledger: r.ledger,
        difference: r.difference, named_items: r.named_items, unexplained: r.unexplained, ties: r.ties })),
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
      const snapshot = { kind: "opening_import", source: body.source, tie: summary.tie, named_items: body.named_items || [] };
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
}

module.exports = { mountAssetRegister };
