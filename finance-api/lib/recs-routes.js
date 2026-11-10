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
const { jnlRef } = require("./journals");
const { lineFor, LINES } = require("./bs-matrix");
const work = require("./work");

const MISSING = "Reconciliations are waiting for migration 032 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const money = (p) => (p === null || p === undefined ? null : recs.pounds(p));

function mountRecs(app, { route, pool, audit, clientIdFromSlug, xeroEntityContext, xeroGet, startAgentRunner, viaInput = work.viaInput }) {
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

  // Who is asking, before anything is read from Xero. Answers and returns null
  // when they cannot.
  async function preflight(req, res) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) { res.status(404).json({ error: "client not found" }); return null; }
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
    if (!role) { res.status(403).json({ error: `${actorEmail} holds no engagement role for this client` }); return null; }
    return { client, role, actorEmail };
  }

  // The acts an auditor would ask for, in the same log as the journals.
  const auditRec = (conn, req, { client, actorEmail, role, action, id, payload }) => audit(conn, {
    actorEmail, actorRole: role, action, targetType: "reconciliation", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const event = (conn, recId, clientId, actor, action, detail = {}) => conn.query(
    "INSERT INTO finance.rec_events (rec_id, client_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)",
    [recId, clientId, actor, action, JSON.stringify(detail)]);

  const tolerance = async (db, clientId) => {
    const r = await db.query("SELECT rec_tolerance FROM finance.client_finance_config WHERE client_id = $1", [clientId]);
    return recs.pence(r.rows[0]?.rec_tolerance ?? 0);
  };

  const companies = async (db, clientId) => (await db.query(
    `SELECT id, slug, name, legal_name, accounting_system_config FROM finance.entities
      WHERE client_id = $1 AND retired_at IS NULL ORDER BY name`, [clientId])).rows;

  const itemsOf = async (db, clientId, recAccountIds) => (await db.query(
    `SELECT id, rec_account_id, entity_id, item_no, supplier, description, pl_account_code, invoice_ref, invoice_date::text,
            total_cost, service_start::text, service_end::text, amort_commenced::text, treatment, ended_period, document_ref, note
       FROM finance.rec_schedule_items
      WHERE client_id = $1 AND rec_account_id = ANY($2::uuid[]) AND deleted_at IS NULL
        AND entity_id IN (SELECT id FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL)
      ORDER BY entity_id, item_no, created_at`, [clientId, recAccountIds])).rows;

  const loadRec = async (db, clientId, id, lock = false) => (await db.query(
    `SELECT r.*, r.period_end::text AS period_end, a.account_name, a.account_key,
            -- Read through jsonb so a database without migration 034 still answers.
            COALESCE((to_jsonb(a)->>'releases_on')::boolean, false) AS releases_on,
            to_jsonb(a)->>'releases_by' AS releases_by, to_jsonb(a)->>'releases_at' AS releases_at,
            to_jsonb(a)->>'counterpart_account_id' AS counterpart_account_id
       FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
      WHERE r.id = $1 AND r.client_id = $2 ${lock ? "FOR UPDATE OF r" : ""}`, [id, clientId])).rows[0];

  const balancesOf = async (db, recId) => (await db.query(
    `SELECT b.entity_id, b.account_code, b.account_name, b.currency, b.opening, b.closing, b.movement, b.comment, e.name AS entity_name, e.slug AS entity_slug
       FROM finance.rec_balances b JOIN finance.entities e ON e.id = b.entity_id
      WHERE b.rec_id = $1 ORDER BY e.name`, [recId])).rows;

  // Evidence held on recs: an amount per company with its source and document.
  const evidenceOf = async (db, recIds) => (recIds.length ? (await db.query(
    `SELECT v.id, v.rec_id, v.entity_id, e.name AS entity_name, v.kind, v.amount, v.source, v.document_ref, v.note, v.added_by, v.added_at,
            to_jsonb(v)->>'method' AS method
       FROM finance.rec_evidence v JOIN finance.entities e ON e.id = v.entity_id
      WHERE v.rec_id = ANY($1::uuid[]) ORDER BY e.name, v.added_at`, [recIds])).rows : []);

  // What supports the ledger: the schedule for Prepayments, the evidence for
  // an evidence rec (none held is none, so it does not tie), else nothing.
  const supportFor = (rec, items, evidence = []) => {
    if (rec.proof === "schedule" && recs.workable(rec.line_key, rec.proof)) return recs.scheduleTotals(items, rec.period);
    if (recs.usesEvidence(rec.line_key, rec.proof)) return recs.evidenceTotals(evidence);
    return null;
  };

  // The companies on an evidence rec with no evidence yet.
  const missingEvidenceFor = (rec, balances, evidence) => (recs.usesEvidence(rec.line_key, rec.proof)
    ? balances.filter((b) => !evidence.some((v) => v.entity_id === b.entity_id)).map((b) => b.entity_name ?? "a company")
    : []);

  // One after another: a transaction's connection runs one query at a time.
  const figuresOn = async (conn, client, rec) => {
    const balances = await balancesOf(conn, rec.id);
    const items = await itemsOf(conn, client.id, [rec.rec_account_id]);
    const tol = await tolerance(conn, client.id);
    const evidence = await evidenceOf(conn, [rec.id]);
    return { balances, items, evidence, tol, tied: recs.cover(balances, supportFor(rec, items, evidence), tol) };
  };

  // Re-works a rec's flag against the ledger and schedule as they are now.
  async function reflag(conn, client, rec, actor, names) {
    const period = rec.period;
    const items = await itemsOf(conn, client.id, [rec.rec_account_id]);
    const reason = recs.recheckReason(rec.prepared_snapshot, await balancesOf(conn, rec.id),
      { priorLabel: recs.periodLabel(recs.priorPeriod(period)), names, items, period });
    if (reason === (rec.recheck_reason ?? null)) return;
    await conn.query("UPDATE finance.recs SET recheck_reason = $2, recheck_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, updated_at = now() WHERE id = $1", [rec.id, reason]);
    if (reason) await event(conn, rec.id, client.id, actor, "recheck", { reason });
  }

  // A schedule is shared across months, so an edit from one month reaches every
  // month prepared from it. Each is checked against what its preparer saw.
  async function reflagSchedule(conn, client, recAccountId, actor) {
    const names = new Map((await companies(conn, client.id)).map((e) => [e.id, e.name]));
    const others = (await conn.query(
      `SELECT id, rec_account_id, period, prepared_snapshot, recheck_reason FROM finance.recs
        WHERE rec_account_id = $1 AND prepared_snapshot IS NOT NULL AND dropped_at IS NULL`, [recAccountId])).rows;
    for (const r of others) await reflag(conn, client, r, actor, names);
  }

  // What "with" says: who has this rec now.
  const holder = (rec) => ({
    not_started: rec.owner, in_progress: rec.owner, sent_back: rec.owner, with_fc: "FC", with_cfo: "CFO", signed_off: null,
  }[rec.status] ?? null);

  // â”€â”€ The month's list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        pool.query("SELECT composed_at, composed_by, entity_errors, notes FROM finance.rec_periods WHERE client_id = $1 AND period = $2", [client.id, period]),
        pool.query(
          `SELECT r.id, r.rec_account_id, r.period, r.status, r.owner, r.challenge, r.class, r.artefact, r.proof, r.recheck_reason,
                  r.sole_reviewer, r.signed_snapshot, r.line_key, a.account_name,
                  COALESCE(json_agg(json_build_object('entity_id', b.entity_id, 'closing', b.closing, 'code', b.account_code, 'currency', b.currency)) FILTER (WHERE b.rec_id IS NOT NULL), '[]') AS balances
             FROM finance.recs r
             JOIN finance.rec_accounts a ON a.id = r.rec_account_id
             LEFT JOIN finance.rec_balances b ON b.rec_id = r.id
            WHERE r.client_id = $1 AND r.period = $2 AND r.dropped_at IS NULL
            GROUP BY r.id, a.id ORDER BY a.account_name`, [client.id, period]),
        companies(pool, client.id),
        tolerance(pool, client.id),
        pool.query("SELECT rec_account_id, status, recheck_reason, dropped_at FROM finance.recs WHERE client_id = $1 AND period = $2", [client.id, prior]),
      ]);
      const items = await itemsOf(pool, client.id, rows.rows.map((r) => r.rec_account_id));
      const evidence = await evidenceOf(pool, rows.rows.map((r) => r.id));
      const priorBy = new Map(priorRecs.rows.map((r) => [r.rec_account_id, r.status]));
      const list = rows.rows.map((r) => {
        // A signed rec shows what was signed, not the ledger since.
        const signed = r.status === "signed_off" ? r.signed_snapshot : null;
        const mine = signed ? signed.items : items.filter((i) => i.rec_account_id === r.rec_account_id);
        const support = supportFor(r, mine, signed?.evidence ?? evidence.filter((v) => v.rec_id === r.id));
        const balances = signed ? signed.balances.map((b) => ({ ...b, code: b.account_code })) : r.balances;
        const c = recs.cover(balances, support, signed ? signed.tolerance : tol);
        return {
          id: r.id, account_name: r.account_name, codes: [...new Set(balances.map((b) => b.code).filter(Boolean))].sort(),
          line: lineFor(r.line_key)?.line ?? null, line_key: r.line_key, placed: Boolean(r.line_key),
          proof: r.proof, status: r.status, owner: r.owner, challenge: r.challenge, class: r.class, with: holder(r),
          ledger: money(c.group.gl), support: money(c.group.schedule), difference: money(c.group.variance), ties: c.ties, mixed_currency: c.mixed_currency,
          sole_reviewer: r.sole_reviewer, recheck_reason: r.recheck_reason, workable: recs.workable(r.line_key, r.proof), companies: balances.length,
          prior_status: priorBy.get(r.rec_account_id) ?? null,
        };
      });
      const errors = run.rows[0]?.entity_errors ?? [];
      res.json({
        ...base,
        prior: { ...base.prior, open: priorRecs.rows.some((r) => r.recheck_reason || (r.status !== "signed_off" && !r.dropped_at)) },
        tolerance: money(tol),
        notes: run.rows[0]?.notes ?? [],
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
      res.json({ ...base, migration_missing: true, recs: [], entities: [], entity_errors: [], notes: [], counts: { total: 0, signed_off: 0, recheck: 0 }, lines: [] });
    }
  }));

  // One company's trial balances and chart, read from Xero one call at a time.
  async function readEntity(client, slug, period) {
    try {
      const ctx = await xeroEntityContext(client.slug, slug);
      if (!ctx) return { error: "not connected to Xero" };
      if (ctx.error) return { error: ctx.error };
      const tb = async (date) => {
        const data = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date });
        return data?.Reports?.[0] ?? data;
      };
      const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts"))?.Accounts ?? [];
      if (!accounts.length) return { error: "Xero returned an empty chart of accounts, so this company could not be read" };
      const org = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Organisation"))?.Organisations?.[0];
      const closeTb = await tb(recs.monthEnd(period));
      const priorEnd = recs.monthEnd(recs.priorPeriod(period));
      const openTb = await tb(priorEnd);
      if (!recs.hasRows(closeTb)) return { error: "Xero returned a trial balance with no rows, so this company could not be read" };
      if (!recs.hasRows(openTb)) {
        return { error: `Xero has no trial balance rows at ${priorEnd}. If this company started this month that is expected, and it still holds up group sign-off, because nothing proves it opened at nil. Post its opening position in Xero dated ${priorEnd} or earlier. If it should not be here, retire it from the client's profile. Then refresh.` };
      }
      return {
        lines: recs.entityLines({ accounts, closeTb, openTb }),
        currency: org?.BaseCurrency ?? null,
        unidentified: [...recs.unidentifiedRows(closeTb), ...recs.unidentifiedRows(openTb)],
      };
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
      const reason = recs.recheckReason(n.prepared_snapshot, bals, { priorLabel: recs.periodLabel(period), names, items: await itemsOf(conn, client.id, [n.rec_account_id]), period: recs.nextPeriod(period) });
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
    const who = await preflight(req, res);
    if (!who) return;
    const { client } = who;
    const period = String(req.body?.period ?? "");
    if (!recs.isPeriod(period)) return res.status(422).json({ issues: ["period must be a month (YYYY-MM)"] });

    // Xero first, before any pooled connection is held across it.
    const entities = await companies(pool, client.id);
    const read = [];
    const errors = [];
    for (const e of entities) {
      const r = await readEntity(client, e.slug, period);
      if (r.error) errors.push({ entity_id: e.id, entity: e.name, error: r.error });
      else read.push({ ...e, lines: r.lines, currency: r.currency, unidentified: r.unidentified });
    }
    const { accounts, notes } = recs.composeAccounts(read);
    for (const e of read) {
      for (const label of new Set(e.unidentified)) notes.push(`${e.name}: the trial balance has a row with no account id, so it is not on this list: ${label}.`);
    }
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const readIds = new Set(read.map((e) => e.id));

    await recTx(req, res, async (conn, { actor, actorEmail, role }) => {
      const closings = new Map();
      const seen = new Set();
      let added = 0;
      // The month's rec for an account. A signed month keeps what the matrix
      // said when it was signed.
      const monthRec = async (ra) => {
        const m = recs.matrixFields(ra.line_key);
        const rec = (await conn.query(
          `INSERT INTO finance.recs (client_id, rec_account_id, period, period_end, line_key, owner, challenge, class, artefact, proof)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (rec_account_id, period) DO UPDATE
             SET line_key = CASE WHEN recs.status = 'signed_off' THEN recs.line_key ELSE EXCLUDED.line_key END,
                 owner = CASE WHEN recs.status = 'signed_off' THEN recs.owner ELSE EXCLUDED.owner END,
                 challenge = CASE WHEN recs.status = 'signed_off' THEN recs.challenge ELSE EXCLUDED.challenge END,
                 class = CASE WHEN recs.status = 'signed_off' THEN recs.class ELSE EXCLUDED.class END,
                 artefact = CASE WHEN recs.status = 'signed_off' THEN recs.artefact ELSE EXCLUDED.artefact END,
                 proof = CASE WHEN recs.status = 'signed_off' THEN recs.proof ELSE EXCLUDED.proof END,
                 dropped_at = NULL
           RETURNING id, rec_account_id, period, prepared_snapshot, recheck_reason, (xmax = 0) AS is_new`,
          [client.id, ra.id, period, recs.monthEnd(period), ra.line_key, m.owner, m.challenge, m.class, m.artefact, ra.proof])).rows[0];
        seen.add(rec.id);
        if (rec.is_new) { added += 1; await event(conn, rec.id, client.id, actor, "composed", { from: "trial balance" }); }
        return rec;
      };
      // A company read just now that no longer has this account. A row holding
      // a person's comment stays, at nil, so the comment is not lost.
      const clearGone = async (recId, here) => {
        await conn.query(
          `UPDATE finance.rec_balances SET opening = 0, closing = 0, movement = 0, read_at = now()
            WHERE rec_id = $1 AND entity_id = ANY($2::uuid[]) AND NOT entity_id = ANY($3::uuid[]) AND comment IS NOT NULL`,
          [recId, [...readIds], [...here.keys()]]);
        await conn.query(
          "DELETE FROM finance.rec_balances WHERE rec_id = $1 AND entity_id = ANY($2::uuid[]) AND NOT entity_id = ANY($3::uuid[]) AND comment IS NULL",
          [recId, [...readIds], [...here.keys()]]);
      };
      // A retired company is not read, so its rows would otherwise stay for
      // ever, on every month not yet signed.
      await conn.query(
        `DELETE FROM finance.rec_balances b USING finance.recs r, finance.entities e
          WHERE b.rec_id = r.id AND b.entity_id = e.id AND r.client_id = $1 AND r.period = $2
            AND r.status <> 'signed_off' AND e.retired_at IS NOT NULL`, [client.id, period]);
      for (const a of accounts) {
        const ra = (await conn.query(
          `INSERT INTO finance.rec_accounts (client_id, account_key, account_name, line_key, proof)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (client_id, account_key) DO UPDATE SET account_name = EXCLUDED.account_name
           RETURNING id, line_key, proof`,
          [client.id, a.key, a.name, a.line_key, a.proof])).rows[0];
        const rec = await monthRec(ra);
        const here = new Map();
        for (const b of a.by_entity) {
          here.set(b.entity_id, b.closing);
          await conn.query(
            `INSERT INTO finance.rec_balances (rec_id, entity_id, account_code, account_name, currency, opening, closing, movement)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (rec_id, entity_id) DO UPDATE
               SET account_code = EXCLUDED.account_code, account_name = EXCLUDED.account_name, currency = EXCLUDED.currency,
                   opening = EXCLUDED.opening, closing = EXCLUDED.closing, movement = EXCLUDED.movement, read_at = now()`,
            [rec.id, b.entity_id, b.code, b.name, b.currency, recs.pounds(b.opening), recs.pounds(b.closing), recs.pounds(b.movement)]);
        }
        await clearGone(rec.id, here);
        closings.set(ra.id, here);
        await reflag(conn, client, rec, actor, names);
      }
      // A schedule still holding a balance with nothing in the ledger is the
      // variance a rec exists to show. The trial balance alone would hide it.
      const held = (await conn.query(
        `SELECT DISTINCT a.id, a.line_key, a.proof FROM finance.rec_accounts a
           JOIN finance.rec_schedule_items i ON i.rec_account_id = a.id AND i.deleted_at IS NULL
          WHERE a.client_id = $1`, [client.id])).rows;
      for (const ra of held) {
        if (closings.has(ra.id)) continue;
        const items = await itemsOf(conn, client.id, [ra.id]);
        if (![...recs.scheduleTotals(items, period).values()].some((p) => p !== 0)) continue;
        const rec = await monthRec(ra);
        await clearGone(rec.id, new Map());
        closings.set(ra.id, new Map());
        await reflag(conn, client, rec, actor, names);
      }
      // Off the trial balance after a correction. Only safe to act on when every
      // company was read: a missing company must not look like a cleared account.
      if (!errors.length) {
        // Removed only when nothing has touched it: a journal, evidence, or any
        // history beyond being listed keeps it, as dropped.
        await conn.query(
          `DELETE FROM finance.recs r
            WHERE r.client_id = $1 AND r.period = $2 AND r.status = 'not_started' AND NOT r.id = ANY($3::uuid[])
              AND NOT EXISTS (SELECT 1 FROM finance.rec_journals j WHERE j.rec_id = r.id)
              AND NOT EXISTS (SELECT 1 FROM finance.rec_evidence v WHERE v.rec_id = r.id)
              AND NOT EXISTS (SELECT 1 FROM finance.rec_events e WHERE e.rec_id = r.id AND e.action <> 'composed')`,
          [client.id, period, [...seen]]);
        // A signed rec is never quietly dropped: someone signed for that figure.
        const gone = (await conn.query(
          `SELECT r.id, r.recheck_reason, a.account_name FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
            WHERE r.client_id = $1 AND r.period = $2 AND r.status = 'signed_off' AND NOT r.id = ANY($3::uuid[])`,
          [client.id, period, [...seen]])).rows;
        const reason = "This account is no longer on the trial balance for the month, after it was signed off.";
        for (const g of gone) {
          if (g.recheck_reason === reason) continue;
          await conn.query("UPDATE finance.recs SET recheck_reason = $2, recheck_at = now(), updated_at = now() WHERE id = $1", [g.id, reason]);
          await event(conn, g.id, client.id, actor, "recheck", { reason });
          await auditRec(conn, req, { client, actorEmail, role, action: "rec_left_trial_balance", id: g.id, payload: { period, account: g.account_name } });
        }
        await conn.query(
          "UPDATE finance.recs SET dropped_at = now() WHERE client_id = $1 AND period = $2 AND dropped_at IS NULL AND status <> 'signed_off' AND NOT id = ANY($3::uuid[])",
          [client.id, period, [...seen]]);
      }
      await conn.query(
        `INSERT INTO finance.rec_periods (client_id, period, composed_by, entity_errors, notes) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (client_id, period) DO UPDATE SET composed_at = now(), composed_by = EXCLUDED.composed_by, entity_errors = EXCLUDED.entity_errors, notes = EXCLUDED.notes`,
        [client.id, period, actor, JSON.stringify(errors), JSON.stringify(notes)]);
      await flagNextMonth(conn, client, period, closings, names, actor);
      return { status: 200, body: { period, accounts: accounts.length, added, complete: errors.length === 0, entity_errors: errors, notes } };
    });
  }));

  // PUT /recs/settings   body: { tolerance }   this client's rounding tolerance
  app.put(`${BASE}/settings`, tolerant(async (req, res) => recTx(req, res, async (conn, { client, role, actorEmail }) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO sets the tolerance" } };
    const t = Number(req.body?.tolerance);
    if (!Number.isFinite(t) || t < 0 || t > 1000 || recs.pence(t) / 100 !== t) {
      return { status: 422, body: { issues: ["tolerance must be between 0.00 and 1,000.00"] } };
    }
    const was = await tolerance(conn, client.id);
    const r = await conn.query("UPDATE finance.client_finance_config SET rec_tolerance = $2 WHERE client_id = $1 RETURNING rec_tolerance", [client.id, t]);
    if (!r.rows.length) return { status: 404, body: { error: "this client has no finance set-up" } };
    await auditRec(conn, req, { client, actorEmail, role, action: "rec_tolerance_changed", id: client.id, payload: { from: money(was), to: r.rows[0].rec_tolerance } });
    return { status: 200, body: { tolerance: r.rows[0].rec_tolerance } };
  }, { peopleOnly: true })));

  // â”€â”€ One reconciliation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function recView(client, rec) {
    const [liveBalances, liveTol, liveItems, journals, events, prior] = await Promise.all([
      balancesOf(pool, rec.id),
      tolerance(pool, client.id),
      itemsOf(pool, client.id, [rec.rec_account_id]),
      pool.query(
        `SELECT j.id, j.jnl_no, j.entity_id, e.name AS entity_name, j.state, j.journal_date::text, j.narration, j.lines, j.reason, j.proposed_by,
                j.approved_by, j.approved_at, j.rejected_by, j.xero_journal_no, j.xero_journal_id, j.drafted_at, j.created_at,
                to_jsonb(j)->>'xero_status' AS xero_status, to_jsonb(j)->>'xero_checked_at' AS xero_checked_at,
                r.status AS run_status, r.queued_at AS run_queued_at, p.outcome AS post_outcome, p.response_body->>'http_status' AS post_http
           FROM finance.rec_journals j
           JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.agent_runs r ON r.id = j.approved_run_id
           LEFT JOIN finance.journal_posts p ON p.client_id = j.client_id AND p.entity_id = j.entity_id
             AND p.idempotency_key = 'rec-journal-' || j.id || '-' || j.attempts
          WHERE j.rec_id = $1 ORDER BY j.created_at DESC`, [rec.id]),
      pool.query("SELECT at, actor, action, detail FROM finance.rec_events WHERE rec_id = $1 ORDER BY at DESC, id DESC LIMIT 100", [rec.id]),
      pool.query(
        `SELECT r.id, r.status, r.recheck_reason,
                COALESCE(json_object_agg(b.entity_id, b.closing) FILTER (WHERE b.rec_id IS NOT NULL), '{}') AS closing
           FROM finance.recs r LEFT JOIN finance.rec_balances b ON b.rec_id = r.id
          WHERE r.rec_account_id = $1 AND r.period = $2 GROUP BY r.id`, [rec.rec_account_id, recs.priorPeriod(rec.period)]),
    ]);
    // A signed rec shows what was signed: the schedule is shared with later
    // months, and the ledger read carries on.
    const signed = rec.status === "signed_off" ? rec.signed_snapshot : null;
    const balances = signed?.balances ?? liveBalances;
    const items = signed?.items ?? liveItems;
    const tol = signed?.tolerance ?? liveTol;
    const liveEvidence = await evidenceOf(pool, [rec.id]);
    const evidence = signed?.evidence ?? liveEvidence;
    const support = supportFor(rec, items, evidence);
    const c = recs.cover(balances, support, tol);
    const names = new Map(balances.map((b) => [b.entity_id, b.entity_name]));
    const entities = await companies(pool, client.id);
    for (const e of entities) names.set(e.id, e.name);
    const evidenceBlock = recs.usesEvidence(rec.line_key, rec.proof)
      ? await evidenceView(client, rec, balances, signed ? evidence.map((v) => ({ ...v, entity_name: names.get(v.entity_id) })) : liveEvidence, names)
      : null;
    const months = rec.proof === "schedule" ? recs.scheduleMonths(items, rec.period) : [];
    const p = prior.rows[0] ?? null;
    // The latest FM1 run on this rec, so the page can say it is working and
    // show what it said when it finished.
    const lastRun = (await pool.query(
      `SELECT id, status, queued_at, started_at, finished_at, error, output FROM finance.agent_runs
        WHERE rec_id = $1 ORDER BY queued_at DESC LIMIT 1`, [rec.id])).rows[0] ?? null;
    // This month's releases made from the schedule, on the Journals page. None
    // before migration 034.
    let releaseRows = [];
    try {
      releaseRows = (await pool.query(
        `SELECT j.id, j.jnl_no, j.entity_id, e.name AS entity_name, j.schedule_item_id AS item_id, i.supplier, i.item_no,
                j.state, j.journal_date::text AS journal_date, j.lines, j.xero_journal_no, j.last_error
           FROM finance.journals j JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.rec_schedule_items i ON i.id = j.schedule_item_id
          WHERE j.rec_account_id = $1 AND j.period = $2 AND j.source = 'schedule' AND j.state <> 'superseded'
          ORDER BY e.name, i.item_no, j.created_at DESC`, [rec.rec_account_id, rec.period])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    return {
      releases: {
        on: Boolean(rec.releases_on), by: rec.releases_by ?? null, at: rec.releases_at ?? null,
        journals: releaseRows.map(({ lines, ...j }) => ({ ...j, jnl: jnlRef(j.jnl_no), total: money(recs.pence(lines.reduce((a, l) => a + Math.max(Number(l.amount) || 0, 0), 0))) })),
      },
      agent_run: lastRun ? {
        id: lastRun.id, status: lastRun.status, queued_at: lastRun.queued_at, started_at: lastRun.started_at,
        finished_at: lastRun.finished_at, error: lastRun.error, output: lastRun.output,
        live: recs.runIsLive({ status: lastRun.status, queued_at: lastRun.queued_at }),
      } : null,
      rec: {
        id: rec.id, account_name: rec.account_name, period: rec.period, period_end: rec.period_end, label: recs.periodLabel(rec.period),
        status: rec.status, owner: rec.owner, challenge: rec.challenge, class: rec.class, artefact: rec.artefact, proof: rec.proof,
        line: lineFor(rec.line_key)?.line ?? null, line_key: rec.line_key, with: holder(rec), preparer_note: rec.preparer_note, review_note: rec.review_note,
        prepared_by: rec.prepared_by, prepared_at: rec.prepared_at, reviewed_by: rec.reviewed_by, reviewed_at: rec.reviewed_at,
        signed_off_by: rec.signed_off_by, signed_off_at: rec.signed_off_at, recheck_reason: rec.recheck_reason, recheck_at: rec.recheck_at,
        checks_at: rec.checks_at, workable: recs.workable(rec.line_key, rec.proof),
        sole_reviewer: rec.sole_reviewer, shown_as_signed: Boolean(signed), signed_before: (rec.signed_history ?? []).length,
        accepted_variance: signed?.accepted ? {
          reason: signed.accepted.reason, by: signed.accepted.by, group: signed.accepted.group,
          by_company: (signed.accepted.by_company ?? []).map((x) => ({ ...x, entity: names.get(x.entity_id) ?? "A company" })),
        } : null,
      },
      tolerance: money(tol),
      evidence: evidenceBlock,
      cover: {
        rows: c.rows.map((r) => {
          const b = balances.find((x) => x.entity_id === r.entity_id);
          return {
            entity_id: r.entity_id, entity: names.get(r.entity_id) ?? "A company", code: b?.account_code ?? null, gl_name: b?.account_name ?? rec.account_name,
            comment: b?.comment ?? null, opening: b?.opening ?? "0.00", gl: money(r.gl), schedule: money(r.schedule), variance: money(r.variance),
            ties: r.ties, currency: r.currency, no_ledger: r.no_ledger,
          };
        }),
        group: { gl: money(c.group.gl), schedule: money(c.group.schedule), variance: money(c.group.variance) },
        ties: c.ties,
        mixed_currency: c.mixed_currency,
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
      journals: journals.rows.map(({ run_status, run_queued_at, post_outcome, post_http, ...j }) => {
        const state = j.state === "approved"
          ? recs.retryState({ runLive: recs.runIsLive({ status: run_status, queued_at: run_queued_at }), post: post_outcome ? { outcome: post_outcome, http_status: post_http } : null })
          : null;
        return { ...j, jnl: jnlRef(j.jnl_no), retry_state: state, can_retry: ["go", "retry"].includes(state) };
      }),
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
      `SELECT j.id, j.state, j.attempts, j.journal_date::text, j.narration, j.lines, e.slug AS entity_slug
         FROM finance.rec_journals j JOIN finance.entities e ON e.id = j.entity_id
        WHERE j.client_id = $1 AND j.approved_run_id = $2`, [client.id, req.params.runId]);
    if (!rows.length) return res.status(404).json({ error: "no proposal for this run" });
    res.json({ ...rows[0], key: recs.recJournalKey(rows[0]) });
  }));

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
  app.post(`${BASE}/:id/place`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO places an account on the matrix" } };
    const stop = editable(rec);
    if (stop) return { status: 409, body: { error: "This is past preparation. Reopen it to place the account." } };
    const line = lineFor(req.body?.line_key);
    if (!line) return { status: 422, body: { issues: ["choose a line of the balance sheet matrix"] } };
    await conn.query(
      "UPDATE finance.rec_accounts SET line_key = $2, proof = $3, placed_by = $4, placed_at = now() WHERE id = $1",
      [rec.rec_account_id, line.key, line.proof, actorEmail]);
    // Every month still being prepared follows. A month that has reached review
    // or sign-off keeps the line it was reviewed on.
    const m = recs.matrixFields(line.key);
    await conn.query(
      `UPDATE finance.recs SET line_key = $2, owner = $3, challenge = $4, class = $5, artefact = $6, proof = $7, updated_at = now()
        WHERE rec_account_id = $1 AND status IN ('not_started', 'in_progress', 'sent_back')`,
      [rec.rec_account_id, line.key, m.owner, m.challenge, m.class, m.artefact, line.proof]);
    await event(conn, rec.id, client.id, actor, "placed", { line: line.line });
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));

  // POST /recs/:id/comment   body: { entity_id, comment }   the Comment on the cover
  app.post(`${BASE}/:id/comment`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor }) => withRec(conn, client, req.params.id, async (rec) => {
    const stop = editable(rec);
    if (stop) return stop;
    const comment = String(req.body?.comment ?? "").trim().slice(0, 1000);
    if (!work.isGuid(req.body?.entity_id)) return { status: 400, body: { error: "entity_id must be a company id" } };
    const r = await conn.query(
      "UPDATE finance.rec_balances SET comment = $3 WHERE rec_id = $1 AND entity_id = $2 RETURNING entity_id",
      [rec.id, req.body.entity_id, comment || null]);
    if (!r.rows.length) {
      // A company on the schedule with nothing in the ledger has a variance to
      // explain, and so needs somewhere to hold the comment.
      const has = (await conn.query(
        "SELECT 1 FROM finance.rec_schedule_items WHERE rec_account_id = $1 AND entity_id = $2 AND deleted_at IS NULL LIMIT 1", [rec.rec_account_id, req.body.entity_id])).rows[0];
      if (!has) return { status: 404, body: { error: "that company is not on this reconciliation" } };
      await conn.query("INSERT INTO finance.rec_balances (rec_id, entity_id, account_name, comment) VALUES ($1,$2,$3,$4)", [rec.id, req.body.entity_id, rec.account_name, comment || null]);
    }
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
    if (!work.isGuid(req.body?.entity_id)) return { status: 400, body: { error: "entity_id must be a company id" } };
    const entity = (await conn.query("SELECT id FROM finance.entities WHERE id = $1 AND client_id = $2 AND retired_at IS NULL", [req.body.entity_id, client.id])).rows[0];
    if (!entity) issues.push("choose one of this client's companies");
    if (issues.length) return { status: 422, body: { issues } };
    // The same invoice twice is refused, whoever adds it: a second run or a
    // second person reading the same bill would otherwise double the schedule.
    // Same company, supplier and cost, and the same invoice reference (or,
    // without one, the same service start).
    const twin = (await conn.query(
      `SELECT id, item_no FROM finance.rec_schedule_items
        WHERE rec_account_id = $1 AND entity_id = $2 AND deleted_at IS NULL
          AND lower(btrim(supplier)) = lower(btrim($3)) AND total_cost = $4
          AND (CASE WHEN $5::text IS NOT NULL THEN lower(btrim(invoice_ref)) = lower(btrim($5::text))
                    ELSE invoice_ref IS NULL AND service_start IS NOT DISTINCT FROM $6::date END)
        LIMIT 1`,
      [rec.rec_account_id, entity.id, row.supplier, row.total_cost, row.invoice_ref || null, row.service_start ?? null])).rows[0];
    if (twin) return { status: 409, body: { error: `This invoice is already on the schedule as item ${twin.item_no}. Change that item instead.`, item_id: twin.id } };
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
    await reflagSchedule(conn, client, rec.rec_account_id, actor);
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
    await reflagSchedule(conn, client, rec.rec_account_id, actor);
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
    await reflagSchedule(conn, client, rec.rec_account_id, actor);
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));

  // POST /recs/:id/checks   reads the month's manual journals from Xero and works
  // out which monthly releases are in the ledger. Saved on the rec, so agents and
  // people see the same answer.
  app.post(`${BASE}/:id/checks`, tolerant(async (req, res) => {
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a reconciliation id" });
    const who = await preflight(req, res);
    if (!who) return;
    const { client } = who;
    const rec = await loadRec(pool, client.id, req.params.id);
    if (!rec) return res.status(404).json({ error: "reconciliation not found" });
    if (!recs.workable(rec.line_key, rec.proof)) return res.status(409).json({ error: "Checks work only for Prepayments for now" });
    if (rec.status === "signed_off") return res.status(409).json({ error: "This is signed off, so its checks stay as they were. Reopen it to run them again." });
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
    await recTx(req, res, async (conn, { actor, actorEmail, role }) => {
      const saved = await conn.query("UPDATE finance.recs SET checks = $2, checks_at = now(), updated_at = now() WHERE id = $1 AND status <> 'signed_off' RETURNING id", [rec.id, JSON.stringify(checks)]);
      if (!saved.rows.length) return { status: 409, body: { error: "This was signed off while the checks ran." } };
      await started(conn, rec);
      await event(conn, rec.id, client.id, actor, "checks", { missing: results.reduce((a, r) => a + (r.missing ?? 0), 0) });
      if (rec.releases_on) {
        checks.releases = await proposeReleases(conn, req, { client, rec, results, items, entities, actor, actorEmail, role });
        await conn.query("UPDATE finance.recs SET checks = $2 WHERE id = $1", [rec.id, JSON.stringify(checks)]);
      }
      return { status: 200, body: checks };
    });
  }));

  // The monthly releases, proposed on the Journals page, one journal per item
  // whose release the checks found missing from Xero (lib/recs.js
  // releaseJournals), so one supplier's release can be reversed on its own. In
  // the checks' own transaction, so the releases and the checks they rest on
  // agree. A release still waiting is replaced when its item has changed since,
  // and withdrawn when Xero now has that month's release; one already approved
  // or in Xero is left alone.
  async function proposeReleases(conn, req, { client, rec, results, items, entities, actor, actorEmail, role }) {
    const out = [];
    for (const r of results) {
      const name = entities.find((e) => e.id === r.entity_id)?.name ?? r.entity;
      const say = (state, why, extra = {}) => out.push({ entity_id: r.entity_id, entity: name, state, why, ...extra });
      if (r.error) { say("skipped", `Xero could not be read: ${r.error}`); continue; }
      const due = recs.releaseJournals({ items: items.filter((i) => i.entity_id === r.entity_id), check: r, accountCode: r.account_code, period: rec.period });

      // A waiting release whose item no longer needs one (Xero has it now, or
      // the item ended) is withdrawn, so it cannot be approved into a double.
      const waiting = (await conn.query(
        `SELECT id, schedule_item_id FROM finance.journals
          WHERE rec_account_id = $1 AND entity_id = $2 AND period = $3 AND source = 'schedule' AND state = 'proposed' FOR UPDATE`,
        [rec.rec_account_id, r.entity_id, rec.period])).rows;
      for (const w of waiting.filter((x) => !due.some((d) => d.item_id === x.schedule_item_id))) {
        await conn.query("UPDATE finance.journals SET state = 'superseded', updated_at = now() WHERE id = $1", [w.id]);
        await event(conn, rec.id, client.id, actor, "release_withdrawn", { entity_id: r.entity_id, journal_id: w.id });
        const it = items.find((i) => i.id === w.schedule_item_id);
        say("withdrawn", "Xero now has this month's release, or the item no longer releases, so the waiting release was withdrawn.", { item_id: w.schedule_item_id, supplier: it?.supplier ?? null, id: w.id });
      }

      if (!due.length) { say("none", r.in_draft ? "Every release due is already in Xero, some as drafts." : "Every release due is already in Xero."); continue; }
      const onRec = (await conn.query(
        "SELECT id FROM finance.rec_journals WHERE rec_id = $1 AND entity_id = $2 AND state IN ('proposed', 'approved')", [rec.id, r.entity_id])).rows[0];
      if (onRec) { say("skipped", "A journal proposed on this reconciliation is waiting for this company. Decide that one first, then run the checks again."); continue; }

      for (const j of due) {
        const about = { item_id: j.item_id, supplier: j.supplier, total: j.total };
        const prior = (await conn.query(
          `SELECT id, state, lines, narration FROM finance.journals
            WHERE schedule_item_id = $1 AND period = $2 AND source = 'schedule'
              AND state IN ('proposed', 'approved', 'draft_created', 'posted') FOR UPDATE`, [j.item_id, rec.period])).rows[0];
        if (prior && (prior.state !== "proposed" || (recs.amountsKey(prior.lines) === recs.amountsKey(j.lines) && prior.narration === j.narration))) {
          say("kept", prior.state === "proposed" ? "This month's release is already waiting on the Journals page." : "This month's release is already approved or in Xero.", { ...about, id: prior.id });
          continue;
        }
        // The same journal proposed by hand on the Journals page is the same journal.
        const byHand = (await conn.query(
          `SELECT id, lines FROM finance.journals WHERE client_id = $1 AND entity_id = $2 AND journal_date = $3
              AND state IN ('proposed', 'approved', 'draft_created', 'posted') AND source <> 'schedule'`, [client.id, r.entity_id, j.date])).rows
          .find((x) => recs.amountsKey(x.lines) === recs.amountsKey(j.lines));
        if (byHand) { say("kept", "The same journal is already on the Journals page.", { ...about, id: byHand.id }); continue; }
        if (prior) await conn.query("UPDATE finance.journals SET state = 'superseded', updated_at = now() WHERE id = $1", [prior.id]);
        const row = (await conn.query(
          `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by, rec_account_id, rec_id, schedule_item_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'schedule',$8,$9,$10,$11) RETURNING id, jnl_no`,
          [client.id, r.entity_id, rec.period, j.date, j.narration, JSON.stringify(j.lines), j.reason, actor, rec.rec_account_id, rec.id, j.item_id])).rows[0];
        await audit(conn, {
          actorEmail, actorRole: role, action: "journal_proposed", targetType: "journal", targetId: row.id, clientId: client.id,
          ip: req.get("X-Forwarded-For") || req.ip,
          payload: { jnl: jnlRef(row.jnl_no), from: "schedule", rec: rec.id, entity: r.entity_id, item: j.item_id, date: j.date, narration: j.narration, lines: j.lines, replaces: prior?.id ?? null },
        });
        await event(conn, rec.id, client.id, actor, "release_proposed", { entity_id: r.entity_id, item_id: j.item_id, journal_id: row.id, jnl: jnlRef(row.jnl_no), total: j.total });
        say("proposed", `${jnlRef(row.jnl_no)}: ${prior ? "the item changed, so its waiting release was replaced." : `release ${j.release} of ${j.of}.`}`, { ...about, id: row.id, jnl: jnlRef(row.jnl_no) });
      }
    }
    return out;
  }

  // PUT /recs/:id/releases   body: { on }   the CFO switches the monthly release
  // on or off for this account. It carries to every month: the schedule is the
  // account's, not the month's.
  app.put(`${BASE}/:id/releases`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO switches the monthly release on or off" } };
    if (!recs.workable(rec.line_key, rec.proof)) return { status: 409, body: { error: "Monthly releases work only for Prepayments for now" } };
    if (typeof req.body?.on !== "boolean") return { status: 400, body: { error: "on must be true or false" } };
    const on = req.body.on;
    await conn.query("UPDATE finance.rec_accounts SET releases_on = $2, releases_by = $3, releases_at = now() WHERE id = $1", [rec.rec_account_id, on, actorEmail]);
    await event(conn, rec.id, client.id, actor, on ? "releases_on" : "releases_off", {});
    await auditRec(conn, req, { client, actorEmail, role, action: on ? "rec_releases_on" : "rec_releases_off", id: rec.id, payload: { account: rec.account_name } });
    return { status: 200, body: { on } };
  }), { peopleOnly: true })));

  // What a preparer saw, kept whatever later happens to the ledger or schedule.
  const snapshotFor = (balances, items, rec, evidence = []) => ({
    balances: recs.snapshotOf(balances),
    evidence: evidence.map((v) => ({ entity_id: v.entity_id, amount: v.amount, source: v.source, document_ref: v.document_ref, method: v.method })),
    schedule: items.map((i) => ({ ...i, ...(({ released, balance, this_month }) => ({ released, balance, this_month }))(recs.itemAt(i, rec.period)) })),
  });

  // POST /recs/:id/prepare   body: { note }   hands to the FC. Clears any re-check.
  app.post(`${BASE}/:id/prepare`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const { balances, items, evidence, tied: c } = await figuresOn(conn, client, rec);
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const comments = c.rows.every((r) => r.ties || balances.find((b) => b.entity_id === r.entity_id)?.comment);
    const issues = recs.stepIssues("prepare", { rec, tied: c.ties, via, role, actor, note, comments, missingEvidence: missingEvidenceFor(rec, balances, evidence) });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      `UPDATE finance.recs SET status = 'with_fc', preparer_note = $2, prepared_snapshot = $3, prepared_by = $4, prepared_by_person = $5, prepared_at = now(),
         recheck_reason = NULL, recheck_at = NULL, review_note = NULL, reviewed_by = NULL, reviewed_by_person = NULL, reviewed_at = NULL,
         sole_reviewer = false, signed_snapshot = NULL, updated_at = now() WHERE id = $1`,
      [rec.id, note || null, JSON.stringify(snapshotFor(balances, items, rec, evidence)), actor, actorEmail]);
    await event(conn, rec.id, client.id, actor, "prepared", { ties: c.ties, difference: money(c.group.variance) });
    return { status: 200, body: { status: "with_fc" } };
  }))));

  // POST /recs/:id/review   body: { pass: true|false, note }
  app.post(`${BASE}/:id/review`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const pass = req.body?.pass === true;
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const sole = !via && req.body?.sole_reviewer === true;
    const issues = recs.stepIssues(pass ? "review_pass" : "review_back", { rec, via, role, actor, person: actorEmail, sole, note });
    if (issues.length) return { status: 422, body: { issues } };
    const status = pass ? "with_cfo" : "sent_back";
    await conn.query(
      `UPDATE finance.recs SET status = $2, review_note = $3, reviewed_by = $4, reviewed_by_person = $5, reviewed_at = now(),
         sole_reviewer = sole_reviewer OR $6, updated_at = now() WHERE id = $1`,
      [rec.id, status, note || null, actor, actorEmail, sole && recs.needsSoleReviewer(rec, actorEmail)]);
    await event(conn, rec.id, client.id, actor, pass ? "review_passed" : "sent_back", { note });
    if (pass) return { status: 200, body: { status } };
    const again = await restartFm1(conn, { client, rec, actorEmail, role, actor, note, by: "FC", automatic: Boolean(via) });
    return { status: 200, body: { status, fm1: again.said }, after: again.after };
  }))));

  // POST /recs/:id/sign-off   a person, the CFO, and only when it ties
  app.post(`${BASE}/:id/sign-off`, tolerant(async (req, res) => {
    // Xero is read first, outside the transaction, and only for someone who
    // could sign this.
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a reconciliation id" });
    const who = await preflight(req, res);
    if (!who) return;
    let reads = null;
    const first = await loadRec(pool, who.client.id, req.params.id);
    if (first && !req.get("X-Work-Via") && recs.CFO_ROLE.test(who.role) && first.status === "with_cfo") {
      reads = await readIssuesAtSignOff(who.client, first);
    }
    return recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
      const { balances, items, evidence, tol, tied: c } = await figuresOn(conn, client, rec);
      const sole = req.body?.sole_reviewer === true;
      const reason = String(req.body?.accept_variance ?? "").trim().slice(0, 2000);
      const issues = recs.stepIssues("sign_off", { rec, tied: c.ties, via, role, actor, person: actorEmail, sole, reads, accept: reason });
      // A journal still waiting here is a fix for the same difference: decide
      // it first, rather than accept the difference beside it.
      if (!c.ties && reason) {
        const waiting = (await conn.query(
          "SELECT jnl_no FROM finance.rec_journals WHERE rec_id = $1 AND state IN ('proposed', 'approved') ORDER BY jnl_no", [rec.id])).rows;
        if (waiting.length) issues.push(`${waiting.map((w) => jnlRef(w.jnl_no)).join(", ")} is waiting on this reconciliation. Approve or reject it before accepting the difference`);
      }
      if (issues.length) return { status: 422, body: { issues } };
      const flagged = rec.sole_reviewer || recs.needsSoleReviewer(rec, actorEmail);
      // A difference signed off stays on the record with its reason and the
      // amount by company, kept with what was signed.
      const accepted = c.ties ? null : {
        reason, by: actorEmail, role, group: money(c.group.variance),
        by_company: c.rows.filter((r) => !r.ties).map((r) => ({ entity_id: r.entity_id, variance: money(r.variance), currency: r.currency })),
      };
      await conn.query(
        `UPDATE finance.recs SET status = 'signed_off', signed_off_by = $2, signed_off_role = $3, signed_off_at = now(),
           sole_reviewer = $4, signed_snapshot = $5, updated_at = now() WHERE id = $1`,
        [rec.id, actorEmail, role, flagged, JSON.stringify({ balances, items, evidence, tolerance: tol, accepted, at: new Date().toISOString() })]);
      const payload = { period: rec.period, account: rec.account_name, group_ledger: money(c.group.gl), sole_reviewer: flagged, accepted_variance: accepted };
      if (accepted) await event(conn, rec.id, client.id, actor, "variance_accepted", { reason, group: accepted.group });
      await event(conn, rec.id, client.id, actor, "signed_off", { role, ...payload });
      await auditRec(conn, req, { client, actorEmail, role, action: "rec_signed_off", id: rec.id, payload });
      return { status: 200, body: { status: "signed_off" } };
    }), { peopleOnly: true });
  }));

  // The list may be an hour old, and may be missing a company. Signing needs
  // every company read cleanly, and this account unchanged in Xero right now.
  async function readIssuesAtSignOff(client, rec) {
    const run = (await pool.query("SELECT entity_errors FROM finance.rec_periods WHERE client_id = $1 AND period = $2", [client.id, rec.period])).rows[0];
    if (!run) return ["This month has not been read from the trial balance"];
    if (run.entity_errors.length) return [`This list is not complete: ${run.entity_errors.map((e) => e.entity).join(", ")} could not be read. Refresh it first`];
    const entities = await companies(pool, client.id);
    const read = [];
    let unidentified = 0;
    for (const e of entities) {
      const r = await readEntity(client, e.slug, rec.period);
      if (r.error) return [`${e.name} could not be read just now, so this cannot be signed off: ${r.error}`];
      read.push({ ...e, lines: r.lines, currency: r.currency });
      unidentified += new Set(r.unidentified).size;
    }
    if (unidentified) return [`${unidentified} trial balance row${unidentified === 1 ? "" : "s"} with no account id could not be placed, so this cannot be signed off. Find ${unidentified === 1 ? "it" : "them"} in Xero first`];
    const now = recs.composeAccounts(read).accounts.find((a) => a.key === rec.account_key);
    const active = new Set(entities.map((e) => e.id));
    const held = (await balancesOf(pool, rec.id)).filter((b) => active.has(b.entity_id));
    const ledger = new Map((now?.by_entity ?? []).map((b) => [b.entity_id, b]));
    for (const id of new Set([...ledger.keys(), ...held.map((b) => b.entity_id)])) {
      const h = held.find((x) => x.entity_id === id);
      const l = ledger.get(id);
      if ((l?.closing ?? 0) !== recs.pence(h?.closing) || (l?.opening ?? 0) !== recs.pence(h?.opening)) {
        return ["The ledger has moved since this list was read. Refresh it, then check the reconciliation"];
      }
    }
    return [];
  }

  // POST /recs/:id/send-back   body: { note }   the CFO returns it to the preparer
  app.post(`${BASE}/:id/send-back`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const note = String(req.body?.note ?? "").trim().slice(0, 4000);
    const issues = recs.stepIssues("send_back", { rec, via, role, actor, note });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query("UPDATE finance.recs SET status = 'sent_back', review_note = $2, updated_at = now() WHERE id = $1", [rec.id, note]);
    await event(conn, rec.id, client.id, actor, "sent_back", { note, by: "CFO" });
    const again = await restartFm1(conn, { client, rec, actorEmail, role, actor, note, by: "CFO", automatic: false });
    return { status: 200, body: { status: "sent_back", fm1: again.said }, after: again.after };
  }), { peopleOnly: true })));

  // Sending back is the instruction to rework, so FM1 starts again on it with
  // the note. Not when FM1 is already working on it, and not more than
  // recs.AUTO_RESTARTS times in a row when an agent sent it back: then a person
  // decides. Returns what to tell the sender and, for a run, what starts it
  // once the transaction commits.
  async function restartFm1(conn, { client, rec, actorEmail, role, actor, note, by, automatic }) {
    if (!recs.workable(rec.line_key, rec.proof)) return { said: "FM1 does not work on this line yet, so it was not restarted." };
    const live = (await conn.query(
      `SELECT id, status, queued_at FROM finance.agent_runs
        WHERE rec_id = $1 AND agent = 'fm1' AND status IN ('queued', 'running') ORDER BY queued_at DESC LIMIT 1`, [rec.id])).rows[0];
    if (live && recs.runIsLive(live)) {
      await event(conn, rec.id, client.id, actor, "restart_skipped", { run_id: live.id });
      return { said: "FM1 is already working on this, so no second run was started. Press Start FM1 once it finishes if the note is not dealt with." };
    }
    if (automatic) {
      const recent = (await conn.query(
        `SELECT action, detail FROM finance.rec_events WHERE rec_id = $1 AND action IN ('agent_started', 'agent_restarted')
          ORDER BY at DESC, id DESC LIMIT $2`, [rec.id, recs.AUTO_RESTARTS])).rows;
      const inARow = recs.autoRestartsInARow(recent);
      if (inARow >= recs.AUTO_RESTARTS) {
        await event(conn, rec.id, client.id, actor, "restart_held", { times: inARow });
        return { said: `FM1 was restarted ${inARow} times in a row after agent send-backs, so it waits for a person. Read the notes, then press Start FM1.` };
      }
    }
    const run = (await conn.query(
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status, rec_id)
       VALUES ($1,$2,$3,'fm1',$4,'queued',$5) RETURNING id`,
      [client.id, actorEmail, role, recs.sendBackInstruction(rec, note, by), rec.id])).rows[0];
    await event(conn, rec.id, client.id, actor, "agent_restarted", { run_id: run.id, by, automatic });
    return { said: "FM1 has started again on it, with the note.", after: async () => ({ runner: await startAgentRunner(run.id) }) };
  }

  // POST /recs/:id/reopen   back to the preparer, for a re-check or a late change
  app.post(`${BASE}/:id/reopen`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, via, role }) => withRec(conn, client, req.params.id, async (rec) => {
    const issues = recs.stepIssues("reopen", { rec, via, role, actor });
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      `UPDATE finance.recs SET status = 'in_progress',
         signed_history = CASE WHEN signed_snapshot IS NULL THEN signed_history ELSE signed_history || jsonb_build_array(jsonb_build_object(
           'signed_off_by', signed_off_by, 'signed_off_role', signed_off_role, 'signed_off_at', signed_off_at,
           'sole_reviewer', sole_reviewer, 'reopened_by', $2::text, 'reopened_at', now(), 'snapshot', signed_snapshot)) END,
         signed_off_by = NULL, signed_off_role = NULL, signed_off_at = NULL, updated_at = now() WHERE id = $1`, [rec.id, actorEmail]);
    await event(conn, rec.id, client.id, actor, "reopened", { from: rec.status });
    if (rec.status === "signed_off") await auditRec(conn, req, { client, actorEmail, role, action: "rec_reopened", id: rec.id, payload: { period: rec.period, account: rec.account_name, signed_off_by: rec.signed_off_by } });
    return { status: 200, body: { status: "in_progress" } };
  }), { peopleOnly: true })));

  // ── Evidence ──────────────────────────────────────────────────────────────

  // The evidence part of a rec's page: what is held, how more can be fetched,
  // and, for an intercompany rec, its pair.
  async function evidenceView(client, rec, balances, evidence, names) {
    const method = recs.autoMethod(rec);
    const out = {
      method, method_label: method ? recs.METHOD_LABEL[method] : null,
      missing: missingEvidenceFor(rec, balances.map((b) => ({ ...b, entity_name: names.get(b.entity_id) })), evidence),
      rows: evidence.map((v) => ({
        id: v.id ?? null, entity_id: v.entity_id, entity: v.entity_name ?? names.get(v.entity_id) ?? "A company", kind: v.kind ?? null,
        amount: v.amount === null || v.amount === undefined ? null : money(recs.pence(v.amount)), source: v.source, document_ref: v.document_ref,
        note: v.note ?? null, method: v.method ?? null, added_by: v.added_by ?? null, added_at: v.added_at ?? null,
      })),
      counterpart: null, candidates: [],
    };
    if (method === "counterpart") {
      const month = await monthRecs(client, rec.period);
      const me = month.find((m) => m.id === rec.id);
      if (rec.counterpart_account_id) out.counterpart = month.find((m) => m.rec_account_id === rec.counterpart_account_id) ?? { rec_account_id: rec.counterpart_account_id, missing: true };
      if (me && me.entity_id) out.candidates = recs.counterpartCandidates(me, month, names).slice(0, 5).map((c) => ({ ...c, entity: names.get(c.entity_id) ?? "A company" }));
      if (out.counterpart && !out.counterpart.missing) out.counterpart = { ...out.counterpart, entity: names.get(out.counterpart.entity_id), closing: money(out.counterpart.closing) };
    }
    return out;
  }

  // The month's recs held by exactly one company, with that company's closing
  // in pence: what intercompany pairs are chosen from.
  async function monthRecs(client, period) {
    const rows = (await pool.query(
      `SELECT r.id, r.rec_account_id, r.line_key, a.account_name, count(b.entity_id) AS companies,
              min(b.entity_id::text) AS entity_id, sum(b.closing) AS closing
         FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
         LEFT JOIN finance.rec_balances b ON b.rec_id = r.id
        WHERE r.client_id = $1 AND r.period = $2 AND r.dropped_at IS NULL
        GROUP BY r.id, a.id`, [client.id, period])).rows;
    return rows.filter((r) => Number(r.companies) === 1).map((r) => ({
      id: r.id, rec_account_id: r.rec_account_id, line_key: r.line_key, account_name: r.account_name, entity_id: r.entity_id, closing: recs.pence(r.closing),
    }));
  }

  // FM1 from a live run, or a person, while the rec is being prepared.
  const mayEvidence = (via) => !via || (via.kind === "agent" && via.agent === "fm1");

  // POST /recs/:id/evidence   body: { entity_id, amount, source, document_ref?, note? }
  app.post(`${BASE}/:id/evidence`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!mayEvidence(via)) return { status: 403, body: { error: "FM1 or a person records evidence" } };
    if (!recs.usesEvidence(rec.line_key, rec.proof)) return { status: 409, body: { error: recs.notWorkableReason(rec.line_key, rec.proof) ?? "This reconciliation is proved by its schedule, not by evidence" } };
    const stop = editable(rec);
    if (stop) return stop;
    const b = req.body || {};
    const issues = [];
    const bal = (await balancesOf(conn, rec.id)).find((x) => x.entity_id === b.entity_id);
    if (!bal) issues.push("entity_id must be one of the companies on this reconciliation");
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e12) issues.push("amount must be a number, signed as the ledger (debit positive, credit negative)");
    const source = String(b.source ?? "").trim();
    if (source.length < 5) issues.push("source must say where the figure comes from (a statement, a return, a register, a confirmation)");
    if (issues.length) return { status: 422, body: { issues } };
    const row = (await conn.query(
      `INSERT INTO finance.rec_evidence (rec_id, entity_id, kind, amount, source, document_ref, note, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [rec.id, b.entity_id, rec.proof, recs.pounds(recs.pence(amount)), source.slice(0, 300), String(b.document_ref ?? "").trim().slice(0, 300) || null,
        String(b.note ?? "").trim().slice(0, 2000) || null, actor])).rows[0];
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "evidence_added", { entity_id: b.entity_id, amount: recs.pounds(recs.pence(amount)), source });
    return { status: 201, body: { id: row.id } };
  }))));

  // DELETE /recs/:id/evidence/:eid
  app.delete(`${BASE}/:id/evidence/:eid`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, via }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!mayEvidence(via)) return { status: 403, body: { error: "FM1 or a person removes evidence" } };
    if (!work.isGuid(req.params.eid)) return { status: 400, body: { error: "eid must be an evidence id" } };
    const stop = editable(rec);
    if (stop) return stop;
    const gone = (await conn.query("DELETE FROM finance.rec_evidence WHERE id = $1 AND rec_id = $2 RETURNING entity_id, amount, source", [req.params.eid, rec.id])).rows[0];
    if (!gone) return { status: 404, body: { error: "no such evidence on this reconciliation" } };
    await event(conn, rec.id, client.id, actor, "evidence_removed", gone);
    return { status: 200, body: { removed: req.params.eid } };
  }))));

  // POST /recs/:id/counterpart   body: { rec_account_id | null }   a person pairs
  // an intercompany account with its twin in the other company. Kept for every
  // month, like the placing of an account.
  app.post(`${BASE}/:id/counterpart`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (recs.autoMethod(rec) !== "counterpart") return { status: 409, body: { error: "Only an intercompany reconciliation has a counterpart" } };
    const to = req.body?.rec_account_id ?? null;
    if (to !== null) {
      if (!work.isGuid(to) || to === rec.rec_account_id) return { status: 422, body: { issues: ["rec_account_id must be another account's id from the candidates"] } };
      const ok = (await conn.query("SELECT 1 FROM finance.rec_accounts WHERE id = $1 AND client_id = $2", [to, client.id])).rowCount;
      if (!ok) return { status: 422, body: { issues: ["no such account for this client"] } };
    }
    await conn.query("UPDATE finance.rec_accounts SET counterpart_account_id = $2 WHERE id = $1", [rec.rec_account_id, to]);
    await event(conn, rec.id, client.id, actor, "counterpart_set", { counterpart_account_id: to });
    await auditRec(conn, req, { client, actorEmail, role, action: "rec_counterpart_set", id: rec.id, payload: { account: rec.account_name, counterpart_account_id: to } });
    return { status: 200, body: { counterpart_account_id: to } };
  }), { peopleOnly: true })));

  // POST /recs/:id/evidence/fetch   FM1 or a person: takes the evidence the
  // rec's method can find, replacing evidence fetched before. Evidence a person
  // keyed is kept. Xero is read before the transaction.
  app.post(`${BASE}/:id/evidence/fetch`, tolerant(async (req, res) => {
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a reconciliation id" });
    const who = await preflight(req, res);
    if (!who) return;
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (!mayEvidence(origin.via)) return res.status(403).json({ error: "FM1 or a person fetches evidence" });
    const rec = await loadRec(pool, who.client.id, req.params.id);
    if (!rec) return res.status(404).json({ error: "reconciliation not found" });
    const method = recs.autoMethod(rec);
    if (!method) return res.status(409).json({ error: "There is no automatic source for this account. Record the outside evidence with its document." });
    if (editable(rec)) return res.status(409).json(editable(rec).body);
    const balances = await balancesOf(pool, rec.id);
    const entities = await companies(pool, who.client.id);
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const rows = [], said = [];
    const date = rec.period_end;
    if (method === "ageing_ar" || method === "ageing_ap") {
      const kind = method === "ageing_ap" ? "ap" : "ar";
      for (const b of balances) {
        const e = entities.find((x) => x.id === b.entity_id);
        try {
          const ctx = await xeroEntityContext(who.client.slug, e.slug);
          if (!ctx || ctx.error) throw new Error(ctx?.error ?? "not connected to Xero");
          const type = kind === "ap" ? "ACCPAY" : "ACCREC";
          const dt = date.split("-").map(Number);
          const where = `Type=="${type}" AND Date <= DateTime(${dt[0]},${dt[1]},${dt[2]}) AND (Status=="AUTHORISED" OR Status=="PAID")`;
          const invoices = await xeroPages(ctx, "/Invoices", "Invoices", { where });
          const cnWhere = `Type=="${kind === "ap" ? "ACCPAYCREDIT" : "ACCRECCREDIT"}" AND Date <= DateTime(${dt[0]},${dt[1]},${dt[2]}) AND (Status=="AUTHORISED" OR Status=="PAID")`;
          const creditNotes = await xeroPages(ctx, "/CreditNotes", "CreditNotes", { where: cnWhere });
          const ev = recs.ageingEvidence(invoices, { date, kind, creditNotes });
          rows.push({ entity_id: b.entity_id, amount: ev.amount, source: `Xero ${kind === "ap" ? "supplier bills" : "sales invoices"} outstanding at ${date}`, note: ev.note });
          said.push(`${e.name}: ${ev.note}`);
        } catch (err) {
          said.push(`${e?.name ?? "A company"}: Xero could not be read (${String(err.message || err).slice(0, 200)}). Nothing was taken for it.`);
        }
      }
    } else if (method === "counterpart") {
      if (!rec.counterpart_account_id) return res.status(409).json({ error: "Choose the paired account in the other company first", needs: "counterpart" });
      const twin = (await pool.query(
        `SELECT r.id, a.account_name, b.entity_id, b.closing FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
           JOIN finance.rec_balances b ON b.rec_id = r.id
          WHERE r.client_id = $1 AND r.rec_account_id = $2 AND r.period = $3 AND r.dropped_at IS NULL`, [who.client.id, rec.counterpart_account_id, rec.period])).rows;
      if (balances.length !== 1 || twin.length !== 1) return res.status(409).json({ error: "Pairing works for an account held by one company against one held by one other company" });
      const t = twin[0];
      const amount = recs.pounds(-recs.pence(t.closing));
      rows.push({ entity_id: balances[0].entity_id, amount, source: `${names.get(t.entity_id) ?? "The other company"}: ${t.account_name} at ${date}, reversed`, note: `The paired account read from the same trial balances as this one.` });
      said.push(`${names.get(t.entity_id)} holds ${t.account_name} at ${money(recs.pence(t.closing))}; reversed, that is ${amount}.`);
    } else if (method === "carry_forward") {
      const prior = (await pool.query(
        "SELECT id, status, signed_snapshot FROM finance.recs WHERE rec_account_id = $1 AND period = $2", [rec.rec_account_id, recs.priorPeriod(rec.period)])).rows[0];
      if (!prior || prior.status !== "signed_off" || !(prior.signed_snapshot?.evidence ?? []).length) {
        return res.status(409).json({ error: `${recs.periodLabel(recs.priorPeriod(rec.period))} has no signed evidence to carry. Record the outside evidence this month (a confirmation statement, the signed accounts).` });
      }
      const carried = recs.carryForward(prior.signed_snapshot.evidence, balances);
      for (const v of carried) rows.push({ entity_id: v.entity_id, amount: v.amount, source: `${v.source} (carried from ${recs.periodLabel(recs.priorPeriod(rec.period))}, no movement)`, document_ref: v.document_ref ?? null });
      for (const b of balances) if (!carried.some((v) => v.entity_id === b.entity_id)) said.push(`${names.get(b.entity_id)}: the account moved this month, so last month's evidence was not carried. Record what explains the movement.`);
    }
    return recTx(req, res, (conn, { client, actor }) => withRec(conn, client, req.params.id, async (r2) => {
      const stop = editable(r2);
      if (stop) return stop;
      await conn.query("DELETE FROM finance.rec_evidence WHERE rec_id = $1 AND method IS NOT NULL", [r2.id]);
      for (const v of rows) {
        await conn.query(
          `INSERT INTO finance.rec_evidence (rec_id, entity_id, kind, amount, source, document_ref, note, added_by, method)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r2.id, v.entity_id, r2.proof, v.amount, String(v.source).slice(0, 300), v.document_ref ?? null, v.note ?? null, actor, method]);
      }
      await started(conn, r2);
      await event(conn, r2.id, client.id, actor, "evidence_fetched", { method, rows: rows.length });
      return { status: 200, body: { method, method_label: recs.METHOD_LABEL[method], fetched: rows.length, said } };
    }));
  }));

  // All pages of a Xero list, up to a cap.
  async function xeroPages(ctx, path, resource, params) {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const data = await xeroGet(ctx.accessToken, ctx.tenantId, path, { ...params, page: String(page) });
      const got = data?.[resource] ?? [];
      out.push(...got);
      if (got.length < 100) break;
    }
    return out;
  }

  // POST /recs/:id/agent   a person starts FM1 on an open rec
  app.post(`${BASE}/:id/agent`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actorEmail, actor, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.workable(rec.line_key, rec.proof)) return { status: 409, body: { error: recs.notWorkableReason(rec.line_key, rec.proof) } };
    if (!["not_started", "in_progress", "sent_back"].includes(rec.status)) return { status: 409, body: { error: "This is already with a reviewer" } };
    // One run at a time: a second would save the same items again. The rec
    // row is locked by withRec, so two clicks cannot both get past this.
    const live = (await conn.query(
      `SELECT id, status, queued_at FROM finance.agent_runs
        WHERE rec_id = $1 AND status IN ('queued', 'running') ORDER BY queued_at DESC LIMIT 1`, [rec.id])).rows[0];
    if (live && recs.runIsLive(live)) return { status: 409, body: { error: "FM1 is already working on this reconciliation. Its answer appears here when it finishes, usually within five minutes.", run_id: live.id } };
    const run = (await conn.query(
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status, rec_id)
       VALUES ($1,$2,$3,'fm1',$4,'queued',$5) RETURNING id`,
      [client.id, actorEmail, role, recs.prepareInstruction(rec), rec.id])).rows[0];
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "agent_started", { run_id: run.id });
    return { status: 201, body: { run_id: run.id }, after: async () => ({ runner: await startAgentRunner(run.id) }) };
  }), { peopleOnly: true })));

  // â”€â”€ Proposed journals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // One live proposal per rec and company: a new one replaces one not yet
    // decided. One already approved may be on its way to Xero, so it stands.
    const live = (await conn.query(
      "SELECT id, jnl_no, state FROM finance.rec_journals WHERE rec_id = $1 AND entity_id = $2 AND state IN ('proposed', 'approved') FOR UPDATE", [rec.id, entity.id])).rows[0];
    if (live?.state === "approved") return { status: 409, body: { error: "A journal for this company is already approved. It must finish or be rejected first." } };
    const drafted = (await conn.query(
      "SELECT lines FROM finance.rec_journals WHERE rec_id = $1 AND entity_id = $2 AND state IN ('draft_created', 'posted')", [rec.id, entity.id])).rows;
    if (drafted.some((d) => recs.amountsKey(d.lines) === recs.amountsKey(req.body.lines))) {
      return { status: 409, body: { error: "This journal is already in Xero. Post it there, or void it first." } };
    }
    if (live) {
      await conn.query("UPDATE finance.rec_journals SET state = 'superseded' WHERE id = $1", [live.id]);
      await event(conn, rec.id, client.id, actor, "journal_superseded", { journal_id: live.id, jnl: jnlRef(live.jnl_no) });
    }
    const row = (await conn.query(
      `INSERT INTO finance.rec_journals (client_id, rec_id, entity_id, journal_date, narration, lines, reason, proposed_by, proposed_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, jnl_no`,
      [client.id, rec.id, entity.id, req.body.date, String(req.body.narration).trim(),
        JSON.stringify(req.body.lines.map((l) => ({ account_code: String(l.account_code), description: l.description ?? "", amount: Number(l.amount), tax_type: l.tax_type ?? "NONE" }))),
        String(req.body.reason).trim().slice(0, 2000), actor, via.run_id])).rows[0];
    await started(conn, rec);
    await event(conn, rec.id, client.id, actor, "journal_proposed", { journal_id: row.id, jnl: jnlRef(row.jnl_no) });
    return { status: 201, body: { id: row.id, jnl: jnlRef(row.jnl_no), replaces: live ? jnlRef(live.jnl_no) : null } };
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
    const stop = recs.approvalIssues(rec);
    if (stop) return { status: 409, body: { error: stop } };
    if (!["proposed", "approved"].includes(j.state)) return { status: 409, body: { error: `This proposal is already ${j.state.replace("_", " ")}` } };
    // Approved already and the run ended without a draft: approving again is
    // allowed only if a second draft cannot result.
    let attempts = j.attempts;
    if (j.state === "approved") {
      const after = await lastAttempt(conn, j);
      if (after.state === "live") return { status: 409, body: { error: "A run is still working on this journal." } };
      if (after.state === "unknown") return { status: 409, body: { error: "This draft may already be in Xero. Check Xero. If it is not there, reject this and ask FM1 to propose it again." } };
      if (after.state === "drafted") {
        await markDrafted(conn, j.id, after.post?.response_body);
        return { status: 200, body: { drafted: true } };
      }
      if (after.state === "retry") attempts += 1;
    }
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
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status, parent_run_id, rec_id)
       VALUES ($1,$2,$3,'fm1',$4,'queued',$5,$6) RETURNING id`,
      [client.id, actorEmail, role, recs.approvalInstruction(j.id, j.jnl_no), parent.id, rec.id])).rows[0];
    await conn.query(
      "UPDATE finance.rec_journals SET state = 'approved', approved_by = $2, approved_at = now(), approved_run_id = $3, attempts = $4 WHERE id = $1",
      [j.id, actorEmail, run.id, attempts]);
    await event(conn, rec.id, client.id, actor, "journal_approved", { journal_id: j.id, run_id: run.id });
    await auditRec(conn, req, { client, actorEmail, role, action: "rec_journal_approved", id: rec.id, payload: { journal_id: j.id, run_id: run.id, date: j.journal_date, narration: j.narration, lines: j.lines, entity: j.slug } });
    return { status: 200, body: { run_id: run.id }, after: async () => ({ runner: await startAgentRunner(run.id) }) };
  }), { peopleOnly: true })));

  // POST /recs/:id/journals/:jid/reject
  app.post(`${BASE}/:id/journals/:jid/reject`, tolerant(async (req, res) => recTx(req, res, (conn, { client, actor, actorEmail, role }) => withRec(conn, client, req.params.id, async (rec) => {
    if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO rejects a journal" } };
    if (!work.isGuid(req.params.jid)) return { status: 400, body: { error: "id must be an id" } };
    const j = (await conn.query("SELECT * FROM finance.rec_journals WHERE id = $1 AND rec_id = $2 FOR UPDATE", [req.params.jid, rec.id])).rows[0];
    if (!j || !["proposed", "approved"].includes(j.state)) return { status: 409, body: { error: "This proposal is not waiting for a decision" } };
    let unknown = false;
    if (j.state === "approved") {
      const after = await lastAttempt(conn, j);
      if (after.state === "live") return { status: 409, body: { error: "A run is still working on this journal." } };
      if (after.state === "drafted") return { status: 409, body: { error: "This journal is already a draft in Xero. Void it there if it is not wanted." } };
      unknown = after.state === "unknown";
      if (unknown && req.body?.confirmed_not_in_xero !== true) {
        return { status: 409, body: { error: "This draft may be in Xero. Check Xero. Reject it only once you have seen it is not there." } };
      }
    }
    // approved_run_id and attempts stay: the record of what was tried.
    await conn.query("UPDATE finance.rec_journals SET state = 'rejected', rejected_by = $2, rejected_at = now(), rejected_after_check = $3 WHERE id = $1", [j.id, actorEmail, unknown]);
    await event(conn, rec.id, client.id, actor, "journal_rejected", { journal_id: req.params.jid, checked_xero: unknown });
    await auditRec(conn, req, { client, actorEmail, role, action: "rec_journal_rejected", id: rec.id, payload: { journal_id: j.id, was: j.state, confirmed_not_in_xero: unknown } });
    return { status: 200, body: { ok: true } };
  }), { peopleOnly: true })));

  // What is known of an approved proposal's last attempt.
  async function lastAttempt(conn, j) {
    const run = j.approved_run_id
      ? (await conn.query("SELECT status, queued_at FROM finance.agent_runs WHERE id = $1", [j.approved_run_id])).rows[0] : null;
    const row = (await conn.query(
      "SELECT outcome, response_body FROM finance.journal_posts WHERE client_id = $1 AND entity_id = $2 AND idempotency_key = $3",
      [j.client_id, j.entity_id, recs.recJournalKey(j)])).rows[0];
    const post = row ? { outcome: row.outcome, http_status: row.response_body?.http_status, response_body: row.response_body } : null;
    return { state: recs.retryState({ runLive: recs.runIsLive(run), post }), post };
  }

  // Recorded by the journal route, in the transaction that closes the post, so
  // a draft in Xero cannot be left looking as if it never happened.
  async function markDrafted(db, journalId, created) {
    const j = (await db.query(
      `UPDATE finance.rec_journals SET state = 'draft_created', xero_journal_id = $2, xero_journal_no = $3, drafted_at = now()
        WHERE id = $1 AND state = 'approved' RETURNING rec_id, client_id`,
      [journalId, created?.journal_id ?? null, created?.journal_number != null ? String(created.journal_number) : null])).rows[0];
    if (j) await event(db, j.rec_id, j.client_id, "automatic", "journal_drafted", { journal_id: journalId, number: created?.journal_number ?? null });
  }

  // The gate at the journal routes. Fails closed: a read that fails throws, and
  // nothing is posted. Only a database without migration 032 passes, because it
  // can hold no proposals. X-Agent-Run is set by the runner, behind the API key.
  async function journalGate(clientId, entityId, { runId, input }) {
    if (runId && !work.isGuid(runId)) return { refuse: "X-Agent-Run is not a run id." };
    const month = String(input?.date ?? "").slice(0, 7);
    try {
      let inRecThread = false;
      if (runId) {
        const t = (await pool.query(
          `WITH RECURSIVE up AS (
             SELECT id, parent_run_id FROM finance.agent_runs WHERE id = $1 AND client_id = $2
             UNION ALL
             SELECT a.id, a.parent_run_id FROM finance.agent_runs a JOIN up ON a.id = up.parent_run_id
           ), down AS (
             SELECT id, rec_id FROM finance.agent_runs WHERE id IN (SELECT id FROM up WHERE parent_run_id IS NULL)
             UNION ALL
             SELECT a.id, a.rec_id FROM finance.agent_runs a JOIN down ON a.parent_run_id = down.id
           )
           SELECT count(*)::int AS runs,
                  bool_or(rec_id IS NOT NULL) OR EXISTS (SELECT 1 FROM finance.rec_journals j WHERE j.proposed_run_id IN (SELECT id FROM down)) AS on_rec
             FROM down`, [runId, clientId])).rows[0];
        if (!t.runs) return { refuse: "That run is not one of this client's." };
        inRecThread = Boolean(t.on_rec);
      }
      const proposals = (await pool.query(
        `SELECT j.id, j.state, j.attempts, j.approved_run_id, j.journal_date::text, j.narration, j.lines,
                r.status, r.recheck_reason, r.dropped_at,
                (SELECT b.account_code FROM finance.rec_balances b WHERE b.rec_id = j.rec_id AND b.entity_id = j.entity_id) AS rec_code
           FROM finance.rec_journals j JOIN finance.recs r ON r.id = j.rec_id
          WHERE j.client_id = $1 AND j.entity_id = $2
            AND (to_char(j.journal_date, 'YYYY-MM') = $3 OR j.state IN ('proposed', 'approved') OR j.approved_run_id = $4::uuid)`,
        [clientId, entityId, month, runId || null])).rows;
      return recs.recJournalGate({ runId, inRecThread, proposals, input });
    } catch (e) {
      if (isMissingTable(e)) return {};
      throw e;
    }
  }

  return { journalGate, markDrafted };
}

module.exports = { mountRecs };
