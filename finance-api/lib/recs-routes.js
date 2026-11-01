// The Reconciliations routes: lib/recs.js decides, this applies, in finance.*
// (migration 032).
//
// Xero is only read here: the trial balance, the chart and the manual journals.
// The one write the work leads to, a draft journal, goes through the runner's
// create_draft_journal, as any other agent draft does, and only after a person
// approves it on the screen.
//
// Until migration 032 is applied the list answers with migration_missing and
// every other route with a 503, so finance-api can deploy ahead of it.

const recs = require("./recs");
const { checkApprovalText } = require("./journal");
const { lineFor, LINES } = require("./bs-matrix");
const work = require("./work");

const MISSING = "Reconciliations are waiting for migration 032 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const money = (p) => (p === null || p === undefined ? null : recs.pounds(p));

function mountRecs(app, { route, pool, clientIdFromSlug, xeroEntityContext, xeroGet, startAgentRunner, viaInput = work.viaInput }) {
  const BASE = "/api/finance/clients/:slug/recs";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  // A transaction with the actor, their role and where the call came through.
  // out.after runs once it has committed, for what must see the committed rows.
  async function recTx(req, res, fn, { peopleOnly = false } = {}) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) return res.status(400).json({ issues: origin.issues });
    if (peopleOnly && origin.via) return res.status(403).json({ error: "only a person can do this, in os.stza.io" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const conn = await pool.connect();
    let out;
    try {
      await conn.query("BEGIN");
      const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
      if (!role) { await conn.query("ROLLBACK"); return res.status(403).json({ error: `${actorEmail} holds no engagement role for this client` }); }
      const actor = recs.actorOf(actorEmail, origin.via);
      out = await fn(conn, { client, actorEmail, role, via: origin.via, actor });
      await conn.query(out.status >= 400 ? "ROLLBACK" : "COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    if (out.after) Object.assign(out.body, await out.after());
    return res.status(out.status).json(out.body);
  }

  const event = (conn, recId, clientId, actor, action, detail = {}) => conn.query(
    "INSERT INTO finance.rec_events (rec_id, client_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)",
    [recId, clientId, actor, action, JSON.stringify(detail)]);

  const tolerance = async (db, clientId) => {
    const r = await db.query("SELECT rec_tolerance FROM finance.client_finance_config WHERE client_id = $1", [clientId]);
    return recs.pence(r.rows[0]?.rec_tolerance ?? 1);
  };

  const companies = async (db, clientId) => (await db.query(
    `SELECT id, slug, name, legal_name, accounting_system_config FROM finance.entities
      WHERE client_id = $1 AND retired_at IS NULL ORDER BY name`, [clientId])).rows;

  const itemsOf = async (db, clientId, recAccountIds) => (await db.query(
    `SELECT id, rec_account_id, entity_id, item_no, supplier, description, pl_account_code, invoice_ref, invoice_date::text,
            total_cost, service_start::text, service_end::text, amort_commenced::text, treatment, ended_period, document_ref, note
       FROM finance.rec_schedule_items
      WHERE client_id = $1 AND rec_account_id = ANY($2::uuid[]) AND deleted_at IS NULL
      ORDER BY entity_id, item_no, created_at`, [clientId, recAccountIds])).rows;

  const loadRec = async (db, clientId, id, lock = false) => (await db.query(
    `SELECT r.*, r.period_end::text AS period_end, a.account_name, a.account_key, a.line_key
       FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
      WHERE r.id = $1 AND r.client_id = $2 ${lock ? "FOR UPDATE OF r" : ""}`, [id, clientId])).rows[0];

  const balancesOf = async (db, recId) => (await db.query(
    `SELECT b.entity_id, b.account_code, b.account_name, b.opening, b.closing, b.movement, b.comment, e.name AS entity_name, e.slug AS entity_slug
       FROM finance.rec_balances b JOIN finance.entities e ON e.id = b.entity_id
      WHERE b.rec_id = $1 ORDER BY e.name`, [recId])).rows;

  const supportFor = (rec, items) => (rec.proof === "schedule" && recs.workable(rec.line_key, rec.proof)
    ? recs.scheduleTotals(items, rec.period) : null);

  // One after another: a transaction's connection runs one query at a time.
  const figuresOn = async (conn, client, rec) => {
    const balances = await balancesOf(conn, rec.id);
    const items = await itemsOf(conn, client.id, [rec.rec_account_id]);
    const tol = await tolerance(conn, client.id);
    return { balances, items, tied: recs.cover(balances, supportFor(rec, items), tol) };
  };

  // What "with" says: who has this rec now.
  const holder = (rec) => ({
    not_started: rec.owner, in_progress: rec.owner, sent_back: rec.owner, with_fc: "FC", with_cfo: "CFO", signed_off: null,
  }[rec.status] ?? null);

  // ── The month's list ────────────────────────────────────────────────────────

  // GET /recs?period=2026-10
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = String(req.query.period ?? "");
    if (!recs.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const prior = recs.priorPeriod(period);
    const base = { period, label: recs.periodLabel(period), prior: { period: prior, label: recs.periodLabel(prior), open: false } };
    try {
      const [run, rows, entities, tol, priorRecs] = await Promise.all([
        pool.query("SELECT composed_at, composed_by, entity_errors FROM finance.rec_periods WHERE client_id = $1 AND period = $2", [client.id, period]),
        pool.query(
          `SELECT r.id, r.rec_account_id, r.period, r.status, r.owner, r.challenge, r.class, r.artefact, r.proof, r.recheck_reason,
                  a.account_name, a.line_key,
                  COALESCE(json_agg(json_build_object('entity_id', b.entity_id, 'closing', b.closing, 'code', b.account_code)) FILTER (WHERE b.rec_id IS NOT NULL), '[]') AS balances
             FROM finance.recs r
             JOIN finance.rec_accounts a ON a.id = r.rec_account_id
             LEFT JOIN finance.rec_balances b ON b.rec_id = r.id
            WHERE r.client_id = $1 AND r.period = $2 AND r.dropped_at IS NULL
            GROUP BY r.id, a.id ORDER BY a.account_name`, [client.id, period]),
        companies(pool, client.id),
        tolerance(pool, client.id),
        pool.query("SELECT rec_account_id, status FROM finance.recs WHERE client_id = $1 AND period = $2 AND dropped_at IS NULL", [client.id, prior]),
      ]);
      const items = await itemsOf(pool, client.id, rows.rows.map((r) => r.rec_account_id));
      const priorBy = new Map(priorRecs.rows.map((r) => [r.rec_account_id, r.status]));
      const list = rows.rows.map((r) => {
        const support = supportFor(r, items.filter((i) => i.rec_account_id === r.rec_account_id));
        const c = recs.cover(r.balances, support, tol);
        return {
          id: r.id, account_name: r.account_name, codes: [...new Set(r.balances.map((b) => b.code).filter(Boolean))].sort(),
          line: lineFor(r.line_key)?.line ?? null, line_key: r.line_key, placed: Boolean(r.line_key),
          proof: r.proof, status: r.status, owner: r.owner, challenge: r.challenge, class: r.class, with: holder(r),
          ledger: money(c.group.gl), support: money(c.group.schedule), difference: money(c.group.variance), ties: c.ties,
          recheck_reason: r.recheck_reason, workable: recs.workable(r.line_key, r.proof), companies: r.balances.length,
          prior_status: priorBy.get(r.rec_account_id) ?? null,
        };
      });
      const errors = run.rows[0]?.entity_errors ?? [];
      res.json({
        ...base,
        prior: { ...base.prior, open: priorRecs.rows.some((r) => r.status !== "signed_off") },
        tolerance: money(tol),
        composed_at: run.rows[0]?.composed_at ?? null,
        entity_errors: errors,
        complete: Boolean(run.rows.length) && errors.length === 0,
        entities: entities.map((e) => ({ id: e.id, slug: e.slug, name: e.name })),
        counts: { total: list.length, signed_off: list.filter((r) => r.status === "signed_off").length, recheck: list.filter((r) => r.recheck_reason).length },
        lines: LINES.map((l) => ({ key: l.key, line: l.line })),
        recs: list,
      });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ ...base, migration_missing: true, recs: [], entities: [], entity_errors: [], counts: { total: 0, signed_off: 0, recheck: 0 }, lines: [] });
    }
  }));

  // One company's trial balances and chart, read from Xero one call at a time.
  async function readEntity(client, slug, period) {
    const ctx = await xeroEntityContext(client.slug, slug);
    if (!ctx) return { error: "not connected to Xero" };
    if (ctx.error) return { error: ctx.error };
    const tb = async (date) => {
      const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date });
      return data?.Reports?.[0] ?? data;
    };
    try {
      const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts"))?.Accounts ?? [];
      const closeTb = await tb(recs.monthEnd(period));
      const openTb = await tb(recs.monthEnd(recs.priorPeriod(period)));
      return { lines: recs.entityLines({ accounts, closeTb, openTb }) };
    } catch (e) {
      return { error: e.message };
    }
  }

  // Re-check flags on the recs that read this month's closing as their opening.
  async function flagNextMonth(conn, client, period, closings, names, actor) {
    const next = (await conn.query(
      `SELECT r.id, r.rec_account_id, r.prepared_snapshot, r.recheck_reason FROM finance.recs r
        WHERE r.client_id = $1 AND r.period = $2 AND r.dropped_at IS NULL`, [client.id, recs.nextPeriod(period)])).rows;
    for (const n of next) {
      const mine = closings.get(n.rec_account_id);
      if (!mine) continue;
      const bals = await balancesOf(conn, n.id);
      for (const b of bals) {
        if (mine.has(b.entity_id)) {
          b.opening = recs.pounds(mine.get(b.entity_id));
          await conn.query("UPDATE finance.rec_balances SET opening = $3, movement = closing - $3 WHERE rec_id = $1 AND entity_id = $2", [n.id, b.entity_id, b.opening]);
        }
      }
      const reason = recs.recheckReason(n.prepared_snapshot, bals, { priorLabel: recs.periodLabel(period), names });
      if (reason && reason !== n.recheck_reason) {
        await conn.query("UPDATE finance.recs SET recheck_reason = $2, recheck_at = now(), updated_at = now() WHERE id = $1", [n.id, reason]);
        await event(conn, n.id, client.id, actor, "recheck", { reason });
      }
    }
  }

  // POST /recs/compose   body: { period }   reads each company's trial balance
  // and brings the month's list up to date. Safe to repeat. It is also how a
  // moved figure is noticed. A company that cannot be read keeps what it had,
  // and the list then says it is not complete.
  app.post(`${BASE}/compose`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = String(req.body?.period ?? "");
    if (!recs.isPeriod(period)) return res.status(422).json({ issues: ["period must be a month (YYYY-MM)"] });

    // Xero first, before any pooled connection is held across it.
    const entities = await companies(pool, client.id);
    const read = [];
    const errors = [];
    for (const e of entities) {
      const r = await readEntity(client, e.slug, period);
      if (r.error) errors.push({ entity_id: e.id, entity: e.name, error: r.error });
      else read.push({ ...e, lines: r.lines });
    }
    const accounts = recs.composeAccounts(read);
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const readIds = new Set(read.map((e) => e.id));

    await recTx(req, res, async (conn, { actor }) => {
      const closings = new Map();
      const seen = new Set();
      let added = 0;
      for (const a of accounts) {
        const ra = (await conn.query(
          `INSERT INTO finance.rec_accounts (client_id, account_key, account_name, line_key, proof)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (client_id, account_key) DO UPDATE SET account_name = EXCLUDED.account_name
           RETURNING id, line_key, proof`,
          [client.id, a.key, a.name, a.line_key, a.proof])).rows[0];
        const m = recs.matrixFields(ra.line_key);
        const rec = (await conn.query(
          `INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, owner, challenge, class, artefact, proof)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (rec_account_id, period) DO UPDATE
             SET owner = EXCLUDED.owner, challenge = EXCLUDED.challenge, class = EXCLUDED.class,
                 artefact = EXCLUDED.artefact, dropped_at = NULL
           RETURNING id, prepared_snapshot, recheck_reason, (xmax = 0) AS is_new`,
          [client.id, ra.id, period, recs.monthEnd(period), m.owner, m.challenge, m.class, m.artefact, ra.proof])).rows[0];
        seen.add(rec.id);
        if (rec.is_new) { added += 1; await event(conn, rec.id, client.id, actor, "composed", { from: "trial balance" }); }
        const here = new Map();
        for (const b of a.by_entity) {
          here.set(b.entity_id, b.closing);
          await conn.query(
            `INSERT INTO finance.rec_balances (rec_id, entity_id, account_code, account_name, opening, closing, movement)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (rec_id, entity_id) DO UPDATE
               SET account_code = EXCLUDED.account_code, account_name = EXCLUDED.account_name, opening = EXCLUDED.opening,
                   closing = EXCLUDED.closing, movement = EXCLUDED.movement, read_at = now()`,
            [rec.id, b.entity_id, b.code, b.name, recs.pounds(b.opening), recs.pounds(b.closing), recs.pounds(b.movement)]);
        }
        // A company read just now that no longer has this account.
        await conn.query(
          "DELETE FROM finance.rec_balances WHERE rec_id = $1 AND entity_id = ANY($2::uuid[]) AND NOT entity_id = ANY($3::uuid[])",
          [rec.id, [...readIds], [...here.keys()]]);
        closings.set(ra.id, here);
        const reason = recs.recheckReason(rec.prepared_snapshot, await balancesOf(conn, rec.id), { priorLabel: recs.periodLabel(recs.priorPeriod(period)), names });
        if (reason !== rec.recheck_reason) {
          await conn.query("UPDATE finance.recs SET recheck_reason = $2, recheck_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, updated_at = now() WHERE id = $1", [rec.id, reason]);
          if (reason) await event(conn, rec.id, client.id, actor, "recheck", { reason });
        }
      }
      // Off the trial balance after a correction. Only safe to act on when every
      // company was read: a missing company must not look like a cleared account.
      if (!errors.length) {
        await conn.query(
          "DELETE FROM finance.recs WHERE client_id = $1 AND period = $2 AND status = 'not_started' AND NOT id = ANY($3::uuid[])",
          [client.id, period, [...seen]]);
        await conn.query(
          "UPDATE finance.recs SET dropped_at = now() WHERE client_id = $1 AND period = $2 AND dropped_at IS NULL AND NOT id = ANY($3::uuid[])",
          [client.id, period, [...seen]]);
      }
      await conn.query(
        `INSERT INTO finance.rec_periods (client_id, period, composed_by, entity_errors) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, period) DO UPDATE SET composed_at = now(), composed_by = EXCLUDED.composed_by, entity_errors = EXCLUDED.entity_errors`,
        [client.id, period, actor, JSON.stringify(errors)]);
      await flagNextMonth(conn, client, period, closings, names, actor);
      return { status: 200, body: { period, accounts: accounts.length, added, complete: errors.length === 0, entity_errors: errors } };
    });
  }));

  // PUT /recs/settings   body: { tolerance }   this client's rounding tolerance
  app.put(`${BASE}/settings`, tolerant(async (req, res) => recTx(req, res, async (conn, { client, role }) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO sets the tolerance" } };
    const t = Number(req.body?.tolerance);
    if (!Number.isFinite(t) || t < 0 || t > 1000 || recs.pence(t) / 100 !== t) {
      return { status: 422, body: { issues: ["tolerance must be between 0.00 and 1,000.00"] } };
    }
    const r = await conn.query("UPDATE finance.client_finance_config SET rec_tolerance = $2 WHERE client_id = $1 RETURNING rec_tolerance", [client.id, t]);
    if (!r.rows.length) return { status: 404, body: { error: "this client has no finance set-up" } };
    return { status: 200, body: { tolerance: r.rows[0].rec_tolerance } };
  }, { peopleOnly: true })));

  // ── One reconciliation ──────────────────────────────────────────────────────

  async function recView(client, rec) {
    const [balances, tol, items, journals, events, prior] = await Promise.all([
      balancesOf(pool, rec.id),
      tolerance(pool, client.id),
      itemsOf(pool, client.id, [rec.rec_account_id]),
      pool.query(
        `SELECT j.id, j.entity_id, e.name AS entity_name, j.state, j.journal_date::text, j.narration, j.lines, j.reason, j.proposed_by,
                j.approved_by, j.approved_at, j.rejected_by, j.xero_journal_no, j.xero_journal_id, j.drafted_at, j.created_at
           FROM finance.rec_journals j JOIN finance.entities e ON e.id = j.entity_id WHERE j.rec_id = $1 ORDER BY j.created_at DESC`, [rec.id]),
      pool.query("SELECT at, actor, action, detail FROM finance.rec_events WHERE rec_id = $1 ORDER BY at DESC, id DESC LIMIT 100", [rec.id]),
      pool.query(
        `SELECT r.id, r.status, r.recheck_reason,
                COALESCE(json_object_agg(b.entity_id, b.closing) FILTER (WHERE b.rec_id IS NOT NULL), '{}') AS closing
           FROM finance.recs r LEFT JOIN finance.rec_balances b ON b.rec_id = r.id
          WHERE r.rec_account_id = $1 AND r.period = $2 GROUP BY r.id`, [rec.rec_account_id, recs.priorPeriod(rec.period)]),
    ]);
    const support = supportFor(rec, items);
    const c = recs.cover(balances, support, tol);
    const names = new Map(balances.map((b) => [b.entity_id, b.entity_name]));
    const entities = await companies(pool, client.id);
    for (const e of entities) names.set(e.id, e.name);
    const months = rec.proof === "schedule" ? recs.scheduleMonths(items, rec.period) : [];
    const p = prior.rows[0] ?? null;
    return {
      rec: {
        id: rec.id, account_name: rec.account_name, period: rec.period, period_end: rec.period_end, label: recs.periodLabel(rec.period),
        status: rec.status, owner: rec.owner, challenge: rec.challenge, class: rec.class, artefact: rec.artefact, proof: rec.proof,
        line: lineFor(rec.line_key)?.line ?? null, line_key: rec.line_key, with: holder(rec), preparer_note: rec.preparer_note, review_note: rec.review_note,
        prepared_by: rec.prepared_by, prepared_at: rec.prepared_at, reviewed_by: rec.reviewed_by, reviewed_at: rec.reviewed_at,
        signed_off_by: rec.signed_off_by, signed_off_at: rec.signed_off_at, recheck_reason: rec.recheck_reason, recheck_at: rec.recheck_at,
        checks_at: rec.checks_at, workable: recs.workable(rec.line_key, rec.proof),
      },
      tolerance: money(tol),
      cover: {
        rows: c.rows.map((r) => {
          const b = balances.find((x) => x.entity_id === r.entity_id);
          return {
            entity_id: r.entity_id, entity: b.entity_name, code: b.account_code, gl_name: b.account_name, comment: b.comment,
            opening: b.opening, gl: money(r.gl), schedule: money(r.schedule), variance: money(r.variance), ties: r.ties,
          };
        }),
        group: { gl: money(c.group.gl), schedule: money(c.group.schedule), variance: money(c.group.variance) },
        ties: c.ties,
      },
      schedule: {
        months,
        items: items.map((i) => {
          const at = recs.itemAt(i, rec.period);
          return {
            ...i, entity_name: names.get(i.entity_id) ?? "", months: at.months, monthly: money(at.monthly), released: money(at.released),
            balance: money(at.balance), this_month: money(at.this_month), first: at.first, last: at.last,
            by_month: Object.fromEntries(months.map((m) => [m, money(recs.releaseIn(i, m))])),
          };
        }),
      },
      checks: rec.checks,
      journals: journals.rows,
      events: events.rows,
      prior: p ? {
        status: p.status, label: recs.periodLabel(recs.priorPeriod(rec.period)), recheck: Boolean(p.recheck_reason),
        opening_agrees: balances.every((b) => recs.pence(p.closing[b.entity_id]) === recs.pence(b.opening)),
      } : { status: null, label: recs.periodLabel(recs.priorPeriod(rec.period)), recheck: false, opening_agrees: null },
      entities: entities.map((e) => ({ id: e.id, slug: e.slug, name: e.name })),
      lines: LINES.map((l) => ({ key: l.key, line: l.line })),
    };
  }

  // Runner lookups by run. Before the :id routes, so "journals" is never an id.
  // GET /recs/journals/by-run/:runId   the proposal a run may create, if any
  app.get(`${BASE}/journals/by-run/:runId`, tolerant(async (req, res) => {
    if (!work.isGuid(req.params.runId)) return res.status(400).json({ error: "run id must be an id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const { rows } = await pool.query(
      `SELECT j.id, j.state, j.journal_date::text, j.narration, j.lines, e.slug AS entity_slug
         FROM finance.rec_journals j JOIN finance.entities e ON e.id = j.entity_id
        WHERE j.client_id = $1 AND j.approved_run_id = $2`, [client.id, req.params.runId]);
    if (!rows.length) return res.status(404).json({ error: "no proposal for this run" });
    res.json(rows[0]);
  }));

  // POST /recs/journals/:jid/drafted   body: { journal_id, journal_number }
  app.post(`${BASE}/journals/:jid/drafted`, tolerant(async (req, res) => recTx(req, res, async (conn, { client, actor, via }) => {
    if (!work.isGuid(req.params.jid)) return { status: 400, body: { error: "id must be an id" } };
    if (via?.kind !== "agent") return { status: 403, body: { error: "only the runner records this" } };
    const j = (await conn.query(
      `UPDATE finance.rec_journals SET state = 'draft_created', xero_journal_id = $3, xero_journal_no = $4, drafted_at = now()
        WHERE id = $1 AND client_id = $2 AND state = 'approved' AND approved_run_id = $5 RETURNING rec_id`,
      [req.params.jid, client.id, req.body?.journal_id ?? null, req.body?.journal_number != null ? String(req.body.journal_number) : null, via.run_id])).rows[0];
    if (!j) return { status: 409, body: { error: "this proposal is not waiting for this run" } };
    await event(conn, j.rec_id, client.id, actor, "journal_drafted", { journal_id: req.params.jid, number: req.body?.journal_number ?? null });
    return { status: 200, body: { ok: true } };
  })));

  // GET /recs/:id
  app.get(`${BASE}/:id`, tolerant(async (req, res) => {
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a reconciliation id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const rec = await loadRec(pool, client.id, req.params.id);
    if (!rec) return res.status(404).json({ error: "reconciliation not found" });
    res.json(await recView(client, rec));
  }));

  // Runs fn with this client's rec, locked.
  const withRec = (conn, client, id, fn) => {
    if (!work.isGuid(id)) return { status: 400, body: { error: "id must be a reconciliation id" } };
    return loadRec(conn, client.id, id, true).then((rec) => (rec ? fn(rec) : { status: 404, body: { error: "reconciliation not found" } }));
  };

  // First work on a rec moves it to In progress.
  const started = async (conn, rec) => {
    if (rec.status === "not_started") await conn.query("UPDATE finance.recs SET status = 'in_progress', updated_at = now() WHERE id = $1", [rec.id]);
  };

  const editable = (rec) => (["not_started", "in_progress", "sent_back"].includes(rec.status)
    ? null : { status: 409, body: { error: "This is past preparation. Reopen it to change the schedule." } });

  // POST /recs/:id/place   body: { line_key }   a person places an account on the
  // matrix. Owner, Challenge and Class then come from the matrix, on this rec and
  // from now on.
  app.post(`${BASE}/:id/place`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail }) => withRec(conn, client, req.params.id, async (rec) => {
    const line = lineFor(req.body?.line_key);
    if (!line) return { status: 422, body: { issues: ["choose a line of the balance sheet matrix"] } };
    await conn.query(
      "UPDATE finance.rec_accounts SET line_key = $2, proof = $3, placed_by = $4, placed_at = now() WHERE id = $1",
      [rec.rec_account_id, line.key, line.proof, actorEmail]);
    const m = recs.matrixFields(line.key);
    await conn.query(
      "UPDATE finance.recs SET owner = $2, challenge = $3, class = $4, artefact = $5, proof = $6, updated_at = now() WHERE id = $1",
      [rec.id, m.owner, m.challenge, m.class, m.artefact, line.proof]);
    await event(conn, rec.id, client.id, actor, "placed", { line: line.line });
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));

  // POST /recs/:id/comment   body: { entity_id, comment }   the Comment on the cover
  app.post(`${BASE}/:id/comment`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor }) => withRec(conn, client, req.params.id, async (rec) => {
    const stop = editable(rec);
    if (stop) return stop;
    const comment = String(req.body?.comment ?? "").trim().slice(0, 1000);
    const r = await conn.query(
      "UPDATE finance.rec_balances SET comment = $3 WHERE rec_id = $1 AND entity_id = $2 RETURNING entity_id",
      [rec.id, req.body?.entity_id, comment || null]);
    if (!r.rows.length) return { status: 404, body: { error: "that company is not on this reconciliation" } };
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "comment", { entity_id: req.body.entity_id, comment });
    return { status: 200, body: { ok: true } };
  }))));

  // POST /recs/:id/items   body: the item's fields, with entity_id
  app.post(`${BASE}/:id/items`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor }) => withRec(conn, client, req.params.id, async (rec) => {
    const stop = editable(rec);
    if (stop) return stop;
    const { issues, fields } = recs.scheduleItemInput(req.body);
    const { issues: more, row } = recs.finishItem(fields);
    issues.push(...more);
    const entity = (await conn.query("SELECT id FROM finance.entities WHERE id = $1 AND client_id = $2 AND retired_at IS NULL", [req.body?.entity_id, client.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!entity) issues.push("choose one of this client's companies");
    if (issues.length) return { status: 422, body: { issues } };
    if (row.item_no === undefined) {
      row.item_no = (await conn.query(
        "SELECT COALESCE(MAX(item_no), 0)::int + 1 AS n FROM finance.rec_schedule_items WHERE rec_account_id = $1 AND entity_id = $2",
        [rec.rec_account_id, entity.id])).rows[0].n;
    }
    const cols = Object.keys(row);
    const saved = (await conn.query(
      `INSERT INTO finance.rec_schedule_items (client_id, rec_account_id, entity_id, created_by, ${cols.join(", ")})
       VALUES ($1,$2,$3,$4,${cols.map((_, i) => `$${i + 5}`).join(",")}) RETURNING id`,
      [client.id, rec.rec_account_id, entity.id, actor, ...cols.map((c) => row[c])])).rows[0];
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "item_added", { item_id: saved.id, supplier: row.supplier });
    return { status: 201, body: { id: saved.id } };
  }))));

  // PATCH /recs/:id/items/:itemId   body: the fields to change
  app.patch(`${BASE}/:id/items/:itemId`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor }) => withRec(conn, client, req.params.id, async (rec) => {
    const stop = editable(rec);
    if (stop) return stop;
    if (!work.isGuid(req.params.itemId)) return { status: 400, body: { error: "id must be an item id" } };
    const current = (await conn.query(
      `SELECT supplier, pl_account_code, total_cost, service_start::text, service_end::text, amort_commenced::text, treatment
         FROM finance.rec_schedule_items WHERE id = $1 AND rec_account_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.itemId, rec.rec_account_id])).rows[0];
    if (!current) return { status: 404, body: { error: "item not found" } };
    const { issues, fields } = recs.scheduleItemInput(req.body, { partial: true });
    const { issues: more, row } = recs.finishItem({ ...current, ...fields });
    issues.push(...more);
    if (issues.length) return { status: 422, body: { issues } };
    if (row.amort_commenced !== current.amort_commenced) fields.amort_commenced = row.amort_commenced;
    const cols = Object.keys(fields);
    if (!cols.length) return { status: 200, body: { ok: true } };
    await conn.query(
      `UPDATE finance.rec_schedule_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [req.params.itemId, ...cols.map((c) => fields[c])]);
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "item_changed", { item_id: req.params.itemId, fields: cols });
    return { status: 200, body: { ok: true } };
  }))));

  // DELETE /recs/:id/items/:itemId   hides the item; a person's act only. An item
  // that ended stays, with its ended month, so the schedule keeps its history.
  app.delete(`${BASE}/:id/items/:itemId`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail }) => withRec(conn, client, req.params.id, async (rec) => {
    const stop = editable(rec);
    if (stop) return stop;
    if (!work.isGuid(req.params.itemId)) return { status: 400, body: { error: "id must be an item id" } };
    const r = await conn.query(
      `UPDATE finance.rec_schedule_items SET deleted_at = now(), deleted_by = $3
        WHERE id = $1 AND rec_account_id = $2 AND deleted_at IS NULL RETURNING supplier`, [req.params.itemId, rec.rec_account_id, actorEmail]);
    if (!r.rows.length) return { status: 404, body: { error: "item not found" } };
    await event(conn, rec.id, client.id, actor, "item_removed", { item_id: req.params.itemId, supplier: r.rows[0].supplier });
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));

  // POST /recs/:id/checks   reads the month's manual journals from Xero and works
  // out which monthly releases are in the ledger. Saved on the rec, so agents and
  // people see the same answer.
  app.post(`${BASE}/:id/checks`, tolerant(async (req, res) => {
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a reconciliation id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const rec = await loadRec(pool, client.id, req.params.id);
    if (!rec) return res.status(404).json({ error: "reconciliation not found" });
    if (!recs.workable(rec.line_key, rec.proof)) return res.status(409).json({ error: "Checks work only for Prepayments for now" });
    const [balances, items, tol, entities] = await Promise.all([
      balancesOf(pool, rec.id), itemsOf(pool, client.id, [rec.rec_account_id]), tolerance(pool, client.id), companies(pool, client.id),
    ]);
    const y = Number(rec.period.slice(0, 4));
    const m = Number(rec.period.slice(5, 7));
    const end = Number(recs.monthEnd(rec.period).slice(8, 10));
    const where = `Date>=DateTime(${y},${m},1)&&Date<=DateTime(${y},${m},${end})`;
    const anyCode = balances.find((b) => b.account_code)?.account_code ?? null;
    const results = [];
    for (const e of entities) {
      const mine = items.filter((i) => i.entity_id === e.id);
      if (!mine.length) continue;
      const accountCode = balances.find((b) => b.entity_id === e.id)?.account_code ?? anyCode;
      try {
        const ctx = await xeroEntityContext(client.slug, e.slug);
        if (!ctx || ctx.error) { results.push({ entity_id: e.id, entity: e.name, error: ctx?.error ?? "not connected to Xero" }); continue; }
        const journals = [];
        for (let page = 1; page <= 20; page++) {
          const got = (await xeroGet(ctx.accessToken, ctx.tenantId, "/ManualJournals", { where, page }))?.ManualJournals ?? [];
          journals.push(...got);
          if (got.length < 100) break;
        }
        results.push({ entity_id: e.id, entity: e.name, account_code: accountCode, ...recs.journalChecks({ items: mine, journals, accountCode, period: rec.period, tolerancePence: tol }) });
      } catch (err) {
        results.push({ entity_id: e.id, entity: e.name, error: err.message });
      }
    }
    const checks = { at: new Date().toISOString(), note: recs.INFERRED_NOTE, entities: results };
    await recTx(req, res, async (conn, { actor }) => {
      await conn.query("UPDATE finance.recs SET checks = $2, checks_at = now(), updated_at = now() WHERE id = $1", [rec.id, JSON.stringify(checks)]);
      await started(conn, rec);
      await event(conn, rec.id, client.id, actor, "checks", { missing: results.reduce((a, r) => a + (r.missing ?? 0), 0) });
      return { status: 200, body: checks };
    });
  }));

  // What a preparer saw, kept whatever later happens to the ledger or schedule.
  const snapshotFor = (balances, items, rec) => ({
    balances: recs.snapshotOf(balances),
    schedule: items.map((i) => ({ ...i, ...(({ released, balance, this_month }) => ({ released, balance, this_month }))(recs.itemAt(i, rec.period)) })),
  });

  // POST /recs/:id/prepare   body: { note }   hands to the FC. Clears any re-check.
  app.post(`${BASE}/:id/prepare`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const { balances, items, tied: c } = await figuresOn(conn, client, rec);
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const comments = c.rows.every((r) => r.ties || balances.find((b) => b.entity_id === r.entity_id)?.comment);
    const issues = recs.stepIssues("prepare", { rec, tied: c.ties, via, role, actor, note, comments });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      `UPDATE finance.recs SET status = 'with_fc', preparer_note = $2, prepared_snapshot = $3, prepared_by = $4, prepared_at = now(),
         recheck_reason = NULL, recheck_at = NULL, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now() WHERE id = $1`,
      [rec.id, note || null, JSON.stringify(snapshotFor(balances, items, rec)), actor]);
    await event(conn, rec.id, client.id, actor, "prepared", { ties: c.ties, difference: money(c.group.variance) });
    return { status: 200, body: { status: "with_fc" } };
  }))));

  // POST /recs/:id/review   body: { pass: true|false, note }
  app.post(`${BASE}/:id/review`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const pass = req.body?.pass === true;
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const issues = recs.stepIssues(pass ? "review_pass" : "review_back", { rec, via, role, actor, note });
    if (issues.length) return { status: 422, body: { issues } };
    const status = pass ? "with_cfo" : "sent_back";
    await conn.query(
      "UPDATE finance.recs SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() WHERE id = $1",
      [rec.id, status, note || null, actor]);
    await event(conn, rec.id, client.id, actor, pass ? "review_passed" : "sent_back", { note });
    return { status: 200, body: { status } };
  }))));

  // POST /recs/:id/sign-off   a person, the CFO, and only when it ties
  app.post(`${BASE}/:id/sign-off`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const { tied: c } = await figuresOn(conn, client, rec);
    const issues = recs.stepIssues("sign_off", { rec, tied: c.ties, via, role, actor });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      "UPDATE finance.recs SET status = 'signed_off', signed_off_by = $2, signed_off_role = $3, signed_off_at = now(), updated_at = now() WHERE id = $1",
      [rec.id, actorEmail, role]);
    await event(conn, rec.id, client.id, actor, "signed_off", { role, group_ledger: money(c.group.gl) });
    return { status: 200, body: { status: "signed_off" } };
  }), { peopleOnly: true })));

  // POST /recs/:id/send-back   body: { note }   the CFO returns it to the preparer
  app.post(`${BASE}/:id/send-back`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const issues = recs.stepIssues("send_back", { rec, via, role, actor, note });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query("UPDATE finance.recs SET status = 'sent_back', review_note = $2, updated_at = now() WHERE id = $1", [rec.id, note]);
    await event(conn, rec.id, client.id, actor, "sent_back", { note, by: "CFO" });
    return { status: 200, body: { status: "sent_back" } };
  }), { peopleOnly: true })));

  // POST /recs/:id/reopen   back to the preparer, for a re-check or a late change
  app.post(`${BASE}/:id/reopen`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const issues = recs.stepIssues("reopen", { rec, via, role, actor });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      "UPDATE finance.recs SET status = 'in_progress', signed_off_by = NULL, signed_off_role = NULL, signed_off_at = NULL, updated_at = now() WHERE id = $1", [rec.id]);
    await event(conn, rec.id, client.id, actor, "reopened", { from: rec.status });
    return { status: 200, body: { status: "in_progress" } };
  }), { peopleOnly: true })));

  // POST /recs/:id/agent   a person starts FM1 on an open rec
  app.post(`${BASE}/:id/agent`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actorEmail, actor, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.workable(rec.line_key, rec.proof)) return { status: 409, body: { error: "Agents work only on Prepayments for now" } };
    if (!["not_started", "in_progress", "sent_back"].includes(rec.status)) return { status: 409, body: { error: "This is already with a reviewer" } };
    const run = (await conn.query(
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status)
       VALUES ($1,$2,$3,'fm1',$4,'queued') RETURNING id`,
      [client.id, actorEmail, role, recs.prepareInstruction(rec)])).rows[0];
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "agent_started", { run_id: run.id });
    return { status: 201, body: { run_id: run.id }, after: async () => ({ runner: await startAgentRunner(run.id) }) };
  }), { peopleOnly: true })));

  // ── Proposed journals ───────────────────────────────────────────────────────

  // POST /recs/:id/journals   body: { entity, date, narration, lines, reason }
  // An agent's proposal. It reaches Xero only after a person approves it.
  app.post(`${BASE}/:id/journals`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via }) => withRec(conn, client, req.params.id, async (rec) => {
    if (via?.kind !== "agent" || via.agent !== "fm1") return { status: 403, body: { error: "FM1 proposes journals, from a run" } };
    const stop = editable(rec);
    if (stop) return stop;
    const entity = (await conn.query(
      "SELECT id FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL", [client.id, req.body?.entity])).rows[0];
    if (!entity) return { status: 422, body: { issues: [`no company ${req.body?.entity} for this client`] } };
    const code = (await conn.query("SELECT account_code FROM finance.rec_balances WHERE rec_id = $1 AND entity_id = $2", [rec.id, entity.id])).rows[0]?.account_code;
    const issues = recs.journalProposalIssues(req.body, { period: rec.period, recAccountCode: code });
    if (issues.length) return { status: 422, body: { issues } };
    const row = (await conn.query(
      `INSERT INTO finance.rec_journals (client_id, rec_id, entity_id, journal_date, narration, lines, reason, proposed_by, proposed_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [client.id, rec.id, entity.id, req.body.date, String(req.body.narration).trim(),
        JSON.stringify(req.body.lines.map((l) => ({ account_code: String(l.account_code), description: l.description ?? "", amount: Number(l.amount) }))),
        String(req.body.reason).trim().slice(0, 2000), actor, via.run_id])).rows[0];
    await event(conn, rec.id, client.id, actor, "journal_proposed", { journal_id: row.id });
    return { status: 201, body: { id: row.id } };
  }))));

  // POST /recs/:id/journals/:jid/approve   the CFO approves on the screen. Queues
  // the follow-up to the run that proposed it, with the plain approval that
  // lib/draft-approval.js looks for; that run may create this journal and no other.
  app.post(`${BASE}/:id/journals/:jid/approve`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO approves a journal" } };
    if (!work.isGuid(req.params.jid)) return { status: 400, body: { error: "id must be an id" } };
    const j = (await conn.query(
      `SELECT j.*, j.journal_date::text AS journal_date, e.slug, e.name, e.legal_name, e.accounting_system_config
         FROM finance.rec_journals j JOIN finance.entities e ON e.id = j.entity_id
        WHERE j.id = $1 AND j.rec_id = $2 FOR UPDATE OF j`, [req.params.jid, rec.id])).rows[0];
    if (!j) return { status: 404, body: { error: "proposal not found" } };
    // Approved already and the run failed: approving again queues a fresh one.
    if (!["proposed", "approved"].includes(j.state)) return { status: 409, body: { error: `This proposal is already ${j.state.replace("_", " ")}` } };
    const parent = (await conn.query(
      "SELECT id, output, finished_at FROM finance.agent_runs WHERE id = $1 AND client_id = $2", [j.proposed_run_id, client.id])).rows[0];
    if (!parent?.finished_at) return { status: 409, body: { error: "The run that proposed this has not finished yet" } };
    // The approval path checks the journal against the answer the run gave. If
    // the two differ that would be found after a run has been spent, so stop here.
    const names = [j.slug, j.name, j.legal_name, j.accounting_system_config?.tenant_name];
    const missing = checkApprovalText(parent.output, { entityNames: names, date: j.journal_date, lines: j.lines });
    if (missing.length) {
      return { status: 422, body: { issues: [`The agent's answer does not show this journal in full (${missing.join("; ")}). Ask FM1 to propose it again.`] } };
    }
    const run = (await conn.query(
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status, parent_run_id)
       VALUES ($1,$2,$3,'fm1',$4,'queued',$5) RETURNING id`,
      [client.id, actorEmail, role, recs.approvalInstruction(j.id), parent.id])).rows[0];
    await conn.query(
      "UPDATE finance.rec_journals SET state = 'approved', approved_by = $2, approved_at = now(), approved_run_id = $3 WHERE id = $1",
      [j.id, actorEmail, run.id]);
    await event(conn, rec.id, client.id, actor, "journal_approved", { journal_id: j.id, run_id: run.id });
    return { status: 200, body: { run_id: run.id }, after: async () => ({ runner: await startAgentRunner(run.id) }) };
  }), { peopleOnly: true })));

  // POST /recs/:id/journals/:jid/reject
  app.post(`${BASE}/:id/journals/:jid/reject`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!work.isGuid(req.params.jid)) return { status: 400, body: { error: "id must be an id" } };
    const r = await conn.query(
      `UPDATE finance.rec_journals SET state = 'rejected', rejected_by = $3, rejected_at = now()
        WHERE id = $1 AND rec_id = $2 AND state = 'proposed' RETURNING id`, [req.params.jid, rec.id, actorEmail]);
    if (!r.rows.length) return { status: 409, body: { error: "This proposal is not waiting for a decision" } };
    await event(conn, rec.id, client.id, actor, "journal_rejected", { journal_id: req.params.jid });
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));
}

module.exports = { mountRecs };
