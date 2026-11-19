// The accruals routes (docs/accruals-spec.md, migration 062). lib/accruals.js
// decides; this reads, applies, and audits.
//
//   GET  /accruals?period=YYYY-MM[&tie=1]      proposals, discussion, items, pairs, findings, the 805 tie
//   GET  /accruals/history?months=12           per supplier, for the agent before it proposes
//   POST /accruals/run                         { period }   standing pairs, backfills, bills matched
//   POST /accruals/proposals                   FM1 (a run), Claude, or a person
//   POST /accruals/proposals/:id/comments      { body, challenge? }   anyone on the engagement; agents reply
//   POST /accruals/proposals/:id/decide        CFO: accept, accept_edited, no_accrual, question, standing
//   POST /accruals/precedents/:id/end          CFO: an until-changed precedent stops binding
//   POST /accruals/precedents/:id/promote      CFO: drafts a line in the client's accruals rule
//   POST /accruals/items/:id/stop              CFO: { period, reason }
//   PUT  /accruals/settings                    CFO: { entity, account_code }
//
// Xero is read (bills, lock dates, trial balances) before any transaction is
// opened; nothing here writes to Xero. Pairs go to the Journals page, where
// the CFO approves them and finance-api creates the two DRAFTs.

const acc = require("./accruals");
const recs = require("./recs");
const work = require("./work");
const { jnlRef } = require("./journals");
const { trialBalanceByAccountId } = require("./journal");
const procedureRules = require("./procedure-rules");

const MISSING = "Accruals are waiting for migration 062 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const PROCEDURE = "accruals-and-prepayments";
// Who may do what, from a run (spec 8). Claude through the practice MCP may
// propose and comment as the person it acts for. Nobody but the CFO decides.
const AGENT_PROPOSERS = ["fm1"];
const AGENT_COMMENTERS = ["fm1", "fc"];
const AGENT_RUNNERS = ["fm1"];
const CHALLENGE_AGENTS = ["fc"];
const PLATFORM = "platform:accruals";

// A Xero date ("2026-07-01T00:00:00" or "/Date(1782864000000+0000)/") as YYYY-MM-DD.
function xeroDay(v) {
  if (!v) return null;
  const m = /\/Date\((-?\d+)/.exec(String(v));
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
}

function mountAccruals(app, { route, pool, audit, clientIdFromSlug, xeroEntityContext, xeroGet, viaInput = work.viaInput, library = () => require("./agent-procedures").library() }) {
  const BASE = "/api/finance/clients/:slug/accruals";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  function caller(req, res, { peopleOnly = false, agents = [], claude = false, what = "this" } = {}) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    const via = origin.via;
    if (via && (peopleOnly || (via.kind === "agent" && !agents.includes(via.agent)) || (via.kind === "claude" && !claude))) {
      res.status(403).json({ error: peopleOnly ? `Only a person does ${what}, in os.stza.io` : `${via.kind === "agent" ? via.agent.toUpperCase() : "Claude"} cannot do ${what}` });
      return null;
    }
    const actor = via?.kind === "agent" ? `agent:${via.agent}` : via?.kind === "claude" ? "claude" : actorEmail;
    return { actorEmail, via, actor };
  }

  // A short transaction with the actor's role; a status of 400 or more rolls back.
  async function tx(client, who, fn) {
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
      if (!role) { await conn.query("ROLLBACK"); return { status: 403, body: { error: `${who.actorEmail} holds no engagement role for this client` } }; }
      if (who.via?.kind === "agent") {
        const run = (await conn.query("SELECT agent, status FROM finance.agent_runs WHERE id = $1 AND client_id = $2", [who.via.run_id, client.id])).rows[0];
        if (!run || run.agent !== who.via.agent || !["queued", "running"].includes(run.status)) {
          await conn.query("ROLLBACK");
          return { status: 403, body: { error: "That run is not a live run of this agent for this client" } };
        }
      }
      const out = await fn(conn, { ...who, role });
      await conn.query(out.status >= 400 ? "ROLLBACK" : "COMMIT");
      return out;
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }
  const cfoOnly = (role) => (recs.CFO_ROLE.test(String(role)) ? null : { status: 403, body: { error: "Only the CFO decides on accruals" } });

  const auditAcc = (db, req, { client, actorEmail, role, action, id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType: "accrual", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const entitiesOf = async (db, clientId) => (await db.query(
    "SELECT id, slug, name FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name", [clientId])).rows;

  // Everything the rules need for one client. One query at a time: inside a
  // transaction db is a single connection, which runs one query at once.
  async function state(db, clientId) {
    const q = (sql, args = [clientId]) => () => db.query(sql, args).then((r) => r.rows);
    const all = async (list) => { const out = []; for (const f of list) out.push(await f()); return out; };
    const [settings, recAccounts, items, pairs, clearings, precedents] = await all([
      q("SELECT entity_id, account_code FROM finance.accrual_settings WHERE client_id = $1"),
      // The accounts each company holds on the Accruals line, from its latest rec.
      q(`SELECT DISTINCT ON (b.entity_id, b.account_code) b.entity_id, b.account_code
           FROM finance.rec_balances b JOIN finance.recs r ON r.id = b.rec_id
          WHERE r.client_id = $1 AND r.line_key = 'accruals' AND r.dropped_at IS NULL AND b.account_code IS NOT NULL
          ORDER BY b.entity_id, b.account_code, r.period DESC`),
      q("SELECT *, amount::text AS amount FROM finance.accrual_items WHERE client_id = $1 ORDER BY period_from, supplier"),
      q(`SELECT id, jnl_no, accrual_item_id, period, state, entity_id, journal_date::text AS journal_date, reversal_date::text AS reversal_date, narration, lines,
                xero_journal_no, reversal_xero_journal_no, backfill
           FROM finance.journals WHERE client_id = $1 AND source = 'accrual' AND state <> 'superseded'`),
      q(`SELECT c.*, c.bill_date::text AS bill_date, c.bill_net::text AS bill_net, (c.difference * 100)::bigint AS difference, i.supplier, (i.amount * 100)::bigint AS accrued
           FROM finance.accrual_clearings c JOIN finance.accrual_items i ON i.id = c.item_id WHERE c.client_id = $1`),
      q("SELECT p.*, p.decided_at::text AS decided_at FROM finance.accrual_precedents p WHERE p.client_id = $1 ORDER BY p.decided_at"),
    ]);
    for (const c of clearings) { c.difference = Number(c.difference); c.accrued = Number(c.accrued); }
    return { settings, recAccounts, items, pairs, clearings, precedents };
  }

  // Inserts the pair for one item and month, or says why not. A pair already
  // live for the item and month is left alone (the unique index holds it too).
  async function insertPair(conn, { clientId, item, period, accrualAccount, backfill, reason }) {
    if (!accrualAccount) return { skipped: "no_account" };
    const exists = (await conn.query(
      `SELECT id FROM finance.journals WHERE accrual_item_id = $1 AND period = $2 AND source = 'accrual'
          AND state IN ('proposed','approved','draft_created','posted') FOR UPDATE`, [item.id, period])).rows[0];
    if (exists) return { skipped: "exists" };
    const j = acc.pairFor({ item, period, accrualAccount });
    const row = (await conn.query(
      `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by,
                                     accrual_item_id, reversal_date, backfill)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'accrual',$8,$9,$10,$11) RETURNING id, jnl_no`,
      [clientId, item.entity_id, period, j.journal_date, j.narration, JSON.stringify(j.lines), reason, PLATFORM, item.id, j.reversal_date, backfill])).rows[0];
    return { id: row.id, jnl: jnlRef(row.jnl_no), item_id: item.id, period, backfill, narration: j.narration, total: totalOf(j.lines) };
  }

  const pairReason = (item, backfill) => [
    item.standing ? `Standing accrual, ${item.supplier}.` : `Accrual, ${item.supplier}.`,
    item.basis ? `Basis: ${item.basis}.` : null,
    backfill ? "Backfilled into its own month: the P&L is smoothed, with no catch-up in a later month." : null,
    `Schedule item ${item.id}.`,
  ].filter(Boolean).join(" ");

  // ── The month ───────────────────────────────────────────────────────────────

  app.get(BASE, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = String(req.query.period ?? "");
    if (!acc.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const entities = await entitiesOf(pool, client.id);
    const names = new Map(entities.map((e) => [e.id, e.name]));
    const st = await state(pool, client.id);
    const proposals = (await pool.query(
      `SELECT p.*, p.service_from::text AS service_from, p.service_to::text AS service_to
         FROM finance.accrual_proposals p
        WHERE p.client_id = $1 AND (p.period = $2 OR p.decision IN ('pending','question')) AND p.decision <> 'superseded'
        ORDER BY p.period DESC, p.created_at`, [client.id, period])).rows;
    const comments = proposals.length ? (await pool.query(
      "SELECT id, proposal_id, author, challenge, body, created_at FROM finance.accrual_comments WHERE proposal_id = ANY($1::uuid[]) ORDER BY created_at",
      [proposals.map((p) => p.id)])).rows : [];

    const live = st.items.filter((i) => acc.accruesIn(i, period) || st.pairs.some((p) => p.accrual_item_id === i.id && p.period === period));
    const cont = acc.continuity({ items: st.items, pairs: st.pairs, clearings: st.clearings, period, today: new Date().toISOString().slice(0, 10) });
    const accounts = Object.fromEntries(entities.map((e) => [e.id, acc.accrualAccountFor({ settings: st.settings, recAccounts: st.recAccounts, entityId: e.id })]));
    const pending = st.pairs.filter((p) => p.period === period && p.state !== "rejected");

    let tie = null;
    if (req.query.tie === "1") {
      const ledger = [];
      const unread = [];
      for (const e of entities) {
        const code = accounts[e.id];
        if (!code) continue;
        const got = await ledgerAt(client.slug, e.slug, code, acc.monthEnd(period));
        if (got.error) unread.push(`${e.name}: ${got.error}`); else ledger.push({ entity_id: e.id, closing: got.closing });
      }
      const t = acc.tieOut({ items: st.items, period, ledger, pending: pending.map((p) => ({ entity_id: p.entity_id, state: p.state, jnl: jnlRef(p.jnl_no), total: totalOf(p.lines) })) });
      tie = { ...t, rows: t.rows.map((r) => ({ ...r, entity_name: names.get(r.entity_id) ?? null, account_code: accounts[r.entity_id] ?? null })), unread };
    }

    res.json({
      period, label: recs.periodLabel(period),
      entities: entities.map((e) => ({ ...e, accrual_account: accounts[e.id], account_set: st.settings.some((s) => s.entity_id === e.id) })),
      proposals: proposals.map((p) => ({
        ...p, entity_name: names.get(p.entity_id) ?? null, total: p.lines?.length ? totalOf(p.lines) : null,
        comments: comments.filter((c) => c.proposal_id === p.id),
        cited: st.precedents.filter((x) => (p.precedent_ids ?? []).includes(x.id)).map((x) => ({ id: x.id, decision: x.decision, reason: x.reason, period: x.period })),
      })),
      items: live.map((i) => {
        const pair = pending.find((p) => p.accrual_item_id === i.id);
        const cleared = st.clearings.find((c) => c.item_id === i.id && c.period === period);
        return {
          id: i.id, entity_id: i.entity_id, entity_name: names.get(i.entity_id) ?? null, supplier: i.supplier, amount: i.amount, lines: i.lines,
          standing: i.standing, period_from: i.period_from, end_period: i.end_period, stopped_period: i.stopped_period, bill_lag_months: i.bill_lag_months,
          basis: i.basis, accrues: acc.accruesIn(i, period),
          pair: pair ? { id: pair.id, jnl: jnlRef(pair.jnl_no), state: pair.state, backfill: pair.backfill } : null,
          cleared: cleared ? { bill_number: cleared.bill_number, bill_date: cleared.bill_date, bill_net: cleared.bill_net, difference: (cleared.difference / 100).toFixed(2) } : null,
        };
      }),
      precedents: st.precedents.filter((p) => !p.ended_at).map((p) => ({ ...p, entity_name: names.get(p.entity_id) ?? null })),
      findings: cont.findings.filter((f) => f.period <= period),
      // What a run would raise now (it is the run that raises them).
      due: cont.propose.map((x) => ({ ...x, supplier: st.items.find((i) => i.id === x.item_id)?.supplier ?? null })),
      tie,
      counts: {
        open: proposals.filter((p) => ["pending", "question"].includes(p.decision)).length,
        pairs_waiting: pending.filter((p) => p.state === "proposed").length,
      },
    });
  }));

  const totalOf = (lines) => (Array.isArray(lines) ? lines : []).reduce((a, l) => a + Math.max(Number(l.amount) || 0, 0), 0).toFixed(2);

  // One account's closing balance in one company at a date, signed as the ledger.
  async function ledgerAt(slug, entitySlug, code, date) {
    try {
      const ctx = await xeroEntityContext(slug, entitySlug);
      if (!ctx || ctx.error) return { error: ctx?.error ?? "not connected to Xero" };
      const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", {}))?.Accounts ?? [];
      const a = accounts.find((x) => String(x.Code ?? "") === String(code));
      if (!a) return { error: `there is no account ${code} in Xero` };
      const tb = await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date });
      const row = trialBalanceByAccountId(tb?.Reports?.[0] ?? tb)[a.AccountID];
      const closing = row ? (Math.round(Number(row.ytdDebit ?? 0) * 100) - Math.round(Number(row.ytdCredit ?? 0) * 100)) / 100 : 0;
      return { closing };
    } catch (e) {
      return { error: String(e.message || e).slice(0, 200) };
    }
  }

  // ── History, for the agent ──────────────────────────────────────────────────

  app.get(`${BASE}/history`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const months = Math.min(Math.max(Number.parseInt(req.query.months ?? "12", 10) || 12, 1), 36);
    const to = acc.isPeriod(req.query.period) ? req.query.period : new Date().toISOString().slice(0, 7);
    const from = acc.shift(to, -(months - 1));
    const entities = await entitiesOf(pool, client.id);
    const st = await state(pool, client.id);
    const proposals = (await pool.query(
      `SELECT * FROM finance.accrual_proposals WHERE client_id = $1 AND period BETWEEN $2 AND $3 AND decision <> 'superseded' ORDER BY period, created_at`,
      [client.id, from, to])).rows.map((p) => ({ ...p, total: p.lines?.length ? totalOf(p.lines) : null }));
    const comments = proposals.length ? (await pool.query(
      "SELECT proposal_id, author, body, created_at FROM finance.accrual_comments WHERE proposal_id = ANY($1::uuid[]) ORDER BY created_at", [proposals.map((p) => p.id)])).rows : [];
    const view = acc.historyView({
      proposals, comments, precedents: st.precedents, items: st.items,
      clearings: st.clearings.filter((c) => c.period >= from), names: new Map(entities.map((e) => [e.id, e.name])),
    });
    res.json({ client: client.slug, from, to, ...view });
  }));

  // ── The run ─────────────────────────────────────────────────────────────────

  // POST /accruals/run   { period }   a person, or FM1 from a run. Proposes the
  // month's pair for every standing item, backfills missed months into their
  // own months, and matches bills that arrived to the months they clear.
  app.post(`${BASE}/run`, tolerant(async (req, res) => {
    const who = caller(req, res, { agents: AGENT_RUNNERS, what: "the accruals run" });
    if (!who) return;
    const period = String(req.body?.period ?? "");
    if (!acc.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const entities = await entitiesOf(pool, client.id);
    const st0 = await state(pool, client.id);

    // Xero first: lock dates and supplier bills, per company with items.
    const findings = [];
    const lock = {};
    const bills = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const e of entities) {
      const mine = st0.items.filter((i) => i.entity_id === e.id);
      if (!mine.length) continue;
      try {
        const ctx = await xeroEntityContext(client.slug, e.slug);
        if (!ctx || ctx.error) throw new Error(ctx?.error ?? "not connected to Xero");
        const org = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Organisation", {}))?.Organisations?.[0] ?? {};
        lock[e.id] = xeroDay(org.PeriodLockDate);
        const from = `${mine.map((i) => i.period_from).sort()[0]}-01`;
        const to = acc.monthEnd(acc.shift(period, 3));
        const [fy, fm, fd] = from.split("-").map(Number);
        const [ty, tm, td] = to.split("-").map(Number);
        const where = `Type=="ACCPAY" AND Date >= DateTime(${fy},${fm},${fd}) AND Date <= DateTime(${ty},${tm},${td})`;
        for (let page = 1; page <= 20; page++) {
          const got = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Invoices", { where, page: String(page) }))?.Invoices ?? [];
          for (const b of got) {
            bills.push({ id: b.InvoiceID, number: b.InvoiceNumber ?? null, date: xeroDay(b.DateString ?? b.Date), net: b.SubTotal,
              contact_id: b.Contact?.ContactID ?? null, contact_name: b.Contact?.Name ?? null, status: b.Status, entity_id: e.id });
          }
          if (got.length < 100) break;
        }
      } catch (err) {
        findings.push({ kind: "unread", text: `${e.name}: Xero could not be read (${String(err.message || err).slice(0, 200)}), so its bills were not matched and its lock date not checked.` });
      }
    }

    const out = await tx(client, who, async (conn, { actorEmail, role, actor }) => {
      const st = await state(conn, client.id);
      const proposed = [];
      const matched = [];
      for (const e of entities) {
        const items = st.items.filter((i) => i.entity_id === e.id);
        if (!items.length) continue;
        const account = acc.accrualAccountFor({ settings: st.settings, recAccounts: st.recAccounts, entityId: e.id });
        // Bills first, so a bill that has arrived is not reported late.
        const clearings = [...st.clearings];
        for (const m of acc.matchClearings({ items, bills: bills.filter((b) => b.entity_id === e.id), clearings: st.clearings, pairs: st.pairs, period })) {
          const ins = await conn.query(
            `INSERT INTO finance.accrual_clearings (item_id, client_id, period, bill_id, bill_number, bill_date, bill_net, difference, matched_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
            [m.item_id, client.id, m.period, m.bill_id, m.bill_number, m.bill_date, m.bill_net, (m.difference / 100).toFixed(2), actor]);
          if (!ins.rowCount) continue;
          clearings.push(m);
          matched.push({ ...m, difference: (m.difference / 100).toFixed(2), supplier: items.find((i) => i.id === m.item_id)?.supplier, entity: e.name });
        }
        const c = acc.continuity({ items, pairs: st.pairs, clearings, period, lockDate: lock[e.id] ?? null, today });
        findings.push(...c.findings.map((f) => ({ ...f, entity: e.name })));
        for (const p of c.propose) {
          const item = items.find((i) => i.id === p.item_id);
          if (!account) {
            findings.push({ kind: "no_account", item_id: item.id, period: p.period, entity: e.name,
              text: `${e.name} has no accruals account set, so ${item.supplier}'s ${acc.monthName(p.period)} accrual was not proposed. Set it on the Accruals page.` });
            continue;
          }
          const r = await insertPair(conn, { clientId: client.id, item, period: p.period, accrualAccount: account, backfill: p.backfill, reason: pairReason(item, p.backfill) });
          if (r.id) proposed.push({ ...r, supplier: item.supplier, entity: e.name });
        }
      }
      await auditAcc(conn, req, { client, actorEmail, role, action: "accruals_run", id: client.id,
        payload: { period, via: who.via ? (who.via.kind === "agent" ? `${who.via.agent}:${who.via.run_id}` : "claude") : null, proposed: proposed.map((p) => p.jnl), matched: matched.length, findings: findings.length } });
      return { status: 200, body: { period, proposed, matched, findings } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── Proposing ──────────────────────────────────────────────────────────────

  app.post(`${BASE}/proposals`, tolerant(async (req, res) => {
    const who = caller(req, res, { agents: AGENT_PROPOSERS, claude: true, what: "proposing an accrual" });
    if (!who) return;
    const body = req.body || {};
    const issues = acc.proposalIssues(body);
    if (issues.length) return res.status(422).json({ issues });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    // Any person on the engagement may raise one; only the CFO decides it.
    const out = await tx(client, who, async (conn, { actorEmail, role, actor, via }) => {
      const entity = (await conn.query("SELECT id, name FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL", [client.id, String(body.entity)])).rows[0];
      if (!entity) return { status: 422, body: { issues: [`no company ${body.entity} for this client`] } };
      const st = await state(conn, client.id);
      const account = acc.accrualAccountFor({ settings: st.settings, recAccounts: st.recAccounts, entityId: entity.id });
      if (account && body.confidence !== "open") {
        const bad = acc.accountIssues(body.lines, account);
        if (bad.length) return { status: 422, body: { issues: bad } };
      }
      // Cited precedents must be this client's: one client's never reach another's.
      const ids = Array.isArray(body.precedent_ids) ? body.precedent_ids : [];
      const unknown = ids.filter((id) => !st.precedents.some((p) => p.id === id));
      if (unknown.length) return { status: 422, body: { issues: [`no precedent ${unknown.join(", ")} for this client`] } };
      const applicable = acc.applicablePrecedents(st.precedents, { entity_id: entity.id, supplier: body.supplier, contact_id: body.contact_id ?? null, period: body.period });
      const verdict = acc.citeOrDepart(body, applicable);
      if (verdict.refuse) return { status: verdict.not_raised ? 409 : 422, body: { error: verdict.refuse, not_raised: Boolean(verdict.not_raised), precedent_id: verdict.precedent_id ?? null, precedents: applicable.map((p) => ({ id: p.id, decision: p.decision, reason: p.reason, applies_to: p.applies_to, period: p.period })) } };
      const open = (await conn.query(
        `SELECT id, decision FROM finance.accrual_proposals WHERE entity_id = $1 AND period = $2 AND lower(btrim(supplier)) = lower(btrim($3)) AND decision IN ('pending','question') FOR UPDATE`,
        [entity.id, body.period, body.supplier])).rows[0];
      if (open) return { status: 409, body: { error: `There is already an open proposal for ${body.supplier} in ${entity.name} for ${acc.monthName(body.period)}. Add what you found to it as a comment.`, id: open.id } };
      const row = (await conn.query(
        `INSERT INTO finance.accrual_proposals (client_id, entity_id, period, supplier, contact_id, test, lines, service_from, service_to, basis_kind, basis,
                                                evidence, confidence, precedent_ids, departs_reason, proposed_by, proposed_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid[],$15,$16,$17) RETURNING id`,
        [client.id, entity.id, body.period, String(body.supplier).trim(), body.contact_id ?? null, body.test,
          JSON.stringify(body.confidence === "open" ? [] : acc.cleanLines(body.lines)), body.service_from || null, body.service_to || null,
          body.basis_kind, String(body.basis).trim(), JSON.stringify(body.evidence ?? []), body.confidence, ids,
          String(body.departs_reason ?? "").trim() || null, actor, via?.kind === "agent" ? via.run_id : null])).rows[0];
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_proposed", id: row.id,
        payload: { via: via ? (via.kind === "agent" ? `${via.agent}:${via.run_id}` : "claude") : null, entity: body.entity, period: body.period, supplier: body.supplier, test: body.test, confidence: body.confidence, lines: body.lines ?? [] } });
      return { status: 201, body: { id: row.id, question: body.confidence === "open" } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── Discussion ──────────────────────────────────────────────────────────────

  app.post(`${BASE}/proposals/:id/comments`, tolerant(async (req, res) => {
    const who = caller(req, res, { agents: AGENT_COMMENTERS, claude: true, what: "commenting" });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a proposal id" });
    const text = String(req.body?.body ?? "").trim();
    if (!text) return res.status(422).json({ issues: ["write the comment"] });
    if (text.length > 4000) return res.status(422).json({ issues: ["keep the comment to 4,000 characters"] });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role, actor, via }) => {
      const p = (await conn.query("SELECT id FROM finance.accrual_proposals WHERE id = $1 AND client_id = $2", [req.params.id, client.id])).rows[0];
      if (!p) return { status: 404, body: { error: "proposal not found" } };
      // A challenge is the FC's or the CFO's (spec 8).
      const challenge = req.body?.challenge === true;
      if (challenge) {
        const may = via?.kind === "agent" ? CHALLENGE_AGENTS.includes(via.agent) : !via && recs.REVIEW_ROLE.test(String(role));
        if (!may) return { status: 403, body: { error: "Only the FC or the CFO marks a comment as a challenge" } };
      }
      const row = (await conn.query(
        "INSERT INTO finance.accrual_comments (proposal_id, client_id, author, challenge, body, run_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at",
        [p.id, client.id, actor, challenge, text, via?.kind === "agent" ? via.run_id : null])).rows[0];
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_commented", id: p.id, payload: { comment: row.id, author: actor, challenge } });
      return { status: 201, body: { id: row.id, created_at: row.created_at } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── The CFO's decision ──────────────────────────────────────────────────────

  app.post(`${BASE}/proposals/:id/decide`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true, what: "deciding an accrual" });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a proposal id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      const stop = cfoOnly(role);
      if (stop) return stop;
      const p = (await conn.query(
        "SELECT *, service_from::text AS service_from, service_to::text AS service_to FROM finance.accrual_proposals WHERE id = $1 AND client_id = $2 FOR UPDATE",
        [req.params.id, client.id])).rows[0];
      if (!p) return { status: 404, body: { error: "proposal not found" } };
      const plan = acc.decisionPlan({ proposal: p, body: req.body, actor: actorEmail });
      if (plan.issues.length) return { status: 422, body: { issues: plan.issues } };
      const st = await state(conn, client.id);
      const account = acc.accrualAccountFor({ settings: st.settings, recAccounts: st.recAccounts, entityId: p.entity_id });
      if (plan.item && account) {
        const bad = acc.accountIssues(plan.item.lines, account);
        if (bad.length) return { status: 422, body: { issues: bad } };
      }
      const d = plan.proposal;
      await conn.query(
        `UPDATE finance.accrual_proposals SET decision = $2, decision_reason = $3, applies_to = $4, decided_by = $5, decided_at = $6, updated_at = now() WHERE id = $1`,
        [p.id, d.decision, d.decision_reason, d.applies_to, d.decided_by, d.decided_at]);
      let precedentId = null;
      if (plan.precedent) {
        const x = plan.precedent;
        precedentId = (await conn.query(
          `INSERT INTO finance.accrual_precedents (client_id, entity_id, proposal_id, supplier, contact_id, test, decision, reason, applies_to, period, facts, decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [client.id, x.entity_id, p.id, x.supplier, x.contact_id, x.test, x.decision, x.reason, x.applies_to, x.period, JSON.stringify(x.facts), x.decided_by, x.decided_at])).rows[0].id;
      }
      let itemId = null;
      let pair = null;
      const warnings = [];
      if (plan.item) {
        const i = plan.item;
        const row = (await conn.query(
          `INSERT INTO finance.accrual_items (client_id, entity_id, proposal_id, supplier, contact_id, lines, amount, period_from, standing, end_period,
                                              bill_lag_months, basis_kind, basis, service_from, service_to, expected_clearing, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *, amount::text AS amount`,
          [client.id, i.entity_id, p.id, i.supplier, i.contact_id, JSON.stringify(i.lines), i.amount, i.period_from, i.standing, i.end_period,
            i.bill_lag_months, i.basis_kind, i.basis, i.service_from, i.service_to, i.expected_clearing, actorEmail])).rows[0];
        itemId = row.id;
        if (account) pair = await insertPair(conn, { clientId: client.id, item: row, period: p.period, accrualAccount: account, backfill: false, reason: pairReason(row, false) });
        else warnings.push("This company has no accruals account set, so the journal pair was not proposed. Set it on the Accruals page, then run the month.");
      }
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_decided", id: p.id,
        payload: { decision: d.decision, reason: d.decision_reason, applies_to: d.applies_to, precedent: precedentId, item: itemId, pair: pair?.jnl ?? null } });
      return { status: 200, body: { decision: d.decision, precedent_id: precedentId, item_id: itemId, pair: pair?.id ? pair : null, warnings } };
    });
    res.status(out.status).json(out.body);
  }));

  app.post(`${BASE}/precedents/:id/end`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true, what: "ending a precedent" });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a precedent id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      const stop = cfoOnly(role);
      if (stop) return stop;
      const r = await conn.query(
        "UPDATE finance.accrual_precedents SET ended_at = now(), ended_by = $3 WHERE id = $1 AND client_id = $2 AND ended_at IS NULL RETURNING id", [req.params.id, client.id, actorEmail]);
      if (!r.rowCount) return { status: 404, body: { error: "no such precedent still in force" } };
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_precedent_ended", id: req.params.id, payload: {} });
      return { status: 200, body: { ok: true } };
    });
    res.status(out.status).json(out.body);
  }));

  // Drafts the precedent as a line in the client's addition to the standard
  // procedure. It reaches the agents only once the CFO approves it on the
  // Procedures page; an approved addition goes back to draft at its next version.
  app.post(`${BASE}/precedents/:id/promote`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true, what: "promoting a precedent" });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a precedent id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      const stop = cfoOnly(role);
      if (stop) return stop;
      const p = (await conn.query(
        "SELECT p.*, p.decided_at::text AS decided_at, e.name AS entity_name FROM finance.accrual_precedents p JOIN finance.entities e ON e.id = p.entity_id WHERE p.id = $1 AND p.client_id = $2 FOR UPDATE",
        [req.params.id, client.id])).rows[0];
      if (!p) return { status: 404, body: { error: "precedent not found" } };
      const line = acc.promoteText(p, p.entity_name);
      const lib = library();
      const cur = (await conn.query(
        `SELECT id, procedure, kind, title, summary, body, roles, version, status FROM finance.client_procedures
          WHERE client_id = $1 AND procedure = $2 AND kind = 'addition' AND status <> 'retired' FOR UPDATE`, [client.id, PROCEDURE])).rows[0];
      let ruleId;
      if (cur) {
        if (String(cur.body).includes(`accrual precedent ${p.id}`)) return { status: 409, body: { error: "This precedent is already in the client's accruals rule.", rule_id: cur.id } };
        const { set, issues } = procedureRules.ruleChanges({ body: `${cur.body.trimEnd()}\n${line}` }, cur, lib);
        if (issues.length) return { status: 422, body: { issues } };
        const keys = Object.keys(set);
        await conn.query(`UPDATE finance.client_procedures SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [cur.id, ...keys.map((k) => set[k])]);
        ruleId = cur.id;
      } else {
        const { set, issues } = procedureRules.ruleChanges({
          procedure: PROCEDURE, kind: "addition", title: "Accrual precedents",
          summary: "Accrual decisions the CFO made standing rules for this client.",
          body: `Standing accrual decisions for this client, promoted from precedents by the CFO:\n${line}`,
        }, null, lib);
        if (issues.length) return { status: 422, body: { issues } };
        const cols = ["client_id", "created_by", ...Object.keys(set)];
        ruleId = (await conn.query(`INSERT INTO finance.client_procedures (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
          [client.id, actorEmail, ...Object.values(set)])).rows[0].id;
      }
      await conn.query("UPDATE finance.accrual_precedents SET promoted_rule_id = $2 WHERE id = $1", [p.id, ruleId]);
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_precedent_promoted", id: p.id, payload: { rule: ruleId, line } });
      return { status: 200, body: { rule_id: ruleId, line, note: "Drafted on the Procedures page. Approve it there to put it in front of the agents." } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── Items and settings ──────────────────────────────────────────────────────

  app.post(`${BASE}/items/:id/stop`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true, what: "stopping an accrual" });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be an item id" });
    const period = String(req.body?.period ?? "");
    const reason = String(req.body?.reason ?? "").trim();
    const issues = [];
    if (!acc.isPeriod(period)) issues.push("period must be the first month it is not accrued (YYYY-MM)");
    if (!reason) issues.push("say why it stops");
    if (issues.length) return res.status(422).json({ issues });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      const stop = cfoOnly(role);
      if (stop) return stop;
      const item = (await conn.query("SELECT * FROM finance.accrual_items WHERE id = $1 AND client_id = $2 FOR UPDATE", [req.params.id, client.id])).rows[0];
      if (!item) return { status: 404, body: { error: "item not found" } };
      if (period <= item.period_from) return { status: 422, body: { issues: ["it stops after its first month; to undo a one-off, reject its pair on the Journals page"] } };
      await conn.query("UPDATE finance.accrual_items SET stopped_period = $2, stopped_by = $3, stopped_reason = $4, updated_at = now() WHERE id = $1", [item.id, period, actorEmail, reason]);
      // Pairs waiting from that month on are withdrawn: nothing accrues there now.
      const gone = await conn.query(
        "UPDATE finance.journals SET state = 'superseded', updated_at = now() WHERE accrual_item_id = $1 AND period >= $2 AND state = 'proposed' RETURNING id", [item.id, period]);
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_item_stopped", id: item.id, payload: { period, reason, withdrawn: gone.rows.map((r) => r.id) } });
      return { status: 200, body: { ok: true, withdrawn: gone.rowCount } };
    });
    res.status(out.status).json(out.body);
  }));

  app.put(`${BASE}/settings`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true, what: "setting the accruals account" });
    if (!who) return;
    const code = String(req.body?.account_code ?? "").trim();
    if (!code || code.length > 20) return res.status(422).json({ issues: ["give the company's accruals account code"] });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const entity = (await pool.query("SELECT id, slug FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL", [client.id, String(req.body?.entity ?? "")])).rows[0];
    if (!entity) return res.status(422).json({ issues: ["choose the company"] });
    // The account must exist in the company's Xero chart, as a liability.
    const ctx = await xeroEntityContext(client.slug, entity.slug);
    if (ctx && !ctx.error) {
      const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", {}))?.Accounts ?? [];
      const a = accounts.find((x) => String(x.Code ?? "") === code);
      if (!a) return res.status(422).json({ issues: [`there is no account ${code} in this company's Xero chart`] });
      if (a.Class !== "LIABILITY") return res.status(422).json({ issues: [`${code} ${a.Name} is not a liability account`] });
    }
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      const stop = cfoOnly(role);
      if (stop) return stop;
      await conn.query(
        `INSERT INTO finance.accrual_settings (client_id, entity_id, account_code, set_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, entity_id) DO UPDATE SET account_code = EXCLUDED.account_code, set_by = EXCLUDED.set_by, set_at = now()`,
        [client.id, entity.id, code, actorEmail]);
      await auditAcc(conn, req, { client, actorEmail, role, action: "accrual_account_set", id: entity.id, payload: { entity: entity.slug, account_code: code, xero_checked: Boolean(ctx && !ctx.error) } });
      return { status: 200, body: { ok: true, xero_checked: Boolean(ctx && !ctx.error) } };
    });
    res.status(out.status).json(out.body);
  }));

  // The pure tie for the accruals rec's evidence (method accrual_schedule).
  async function scheduleEvidence(clientId, period) {
    try {
      const st = await state(pool, clientId);
      return { items: st.items, totals: acc.scheduleAt(st.items, period) };
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  return { scheduleEvidence };
}

module.exports = { mountAccruals, xeroDay };
