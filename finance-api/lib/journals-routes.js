// The Journals routes: lib/journals.js decides, this applies, in finance.journals
// (migration 033).
//
// One list per client and month, of every journal: the register's own, and the
// ones proposed on reconciliations (finance.rec_journals), which are shown here
// read-only and decided on their reconciliation.
//
// The one write to Xero is a DRAFT, made by finance-api itself through the
// journal write in server.js (postManualJournal), and only when a person with
// the CFO role approves in os.stza.io. An agent can only propose. The key the
// draft goes under is the journal's id and attempt, so it cannot be made twice.
//
// Until migration 033 is applied the list answers with migration_missing and
// every other route with a 503, so finance-api can deploy ahead of it.

const journals = require("./journals");
const recs = require("./recs");
const work = require("./work");

const MISSING = "Journals are waiting for migration 033 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";

function mountJournals(app, { route, pool, audit, clientIdFromSlug, postManualJournal, journalPreflight, xeroManualJournalStatus, viaInput = work.viaInput }) {
  const BASE = "/api/finance/clients/:slug/journals";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  // Who is asking and through what, before anything is read or written.
  // Answers and returns null when they cannot go on.
  function caller(req, res, { peopleOnly = false } = {}) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    if (peopleOnly && origin.via) { res.status(403).json({ error: "only a person can do this, in os.stza.io" }); return null; }
    return { actorEmail, via: origin.via, actor: recs.actorOf(actorEmail, origin.via) };
  }

  // A short transaction with the actor's role. fn returns { status, body }; a
  // status of 400 or more rolls back. Never spans a call to Xero: that would
  // hold a pooled connection across the network (see server.js, journal posting).
  async function tx(client, who, fn) {
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
      if (!role) { await conn.query("ROLLBACK"); return { status: 403, body: { error: `${who.actorEmail} holds no engagement role for this client` } }; }
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

  const auditJournal = (db, req, { client, actorEmail, role, action, id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType: "journal", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const loadJournal = async (db, clientId, id, lock = false) => (await db.query(
    `SELECT j.*, j.journal_date::text AS journal_date, e.slug AS entity_slug, e.name AS entity_name
       FROM finance.journals j JOIN finance.entities e ON e.id = j.entity_id
      WHERE j.id = $1 AND j.client_id = $2 ${lock ? "FOR UPDATE OF j" : ""}`, [id, clientId])).rows[0];

  // What is known of the current attempt: the claim the journal write made
  // under this journal's key, if any.
  async function lastAttempt(db, j) {
    const row = (await db.query(
      `SELECT outcome, response_body, created_at FROM finance.journal_posts
        WHERE client_id = $1 AND entity_id = $2 AND idempotency_key = $3`,
      [j.client_id, j.entity_id, journals.journalKey(j)])).rows[0];
    const post = row ? { outcome: row.outcome, http_status: row.response_body?.http_status, response_body: row.response_body, created_at: row.created_at } : null;
    return { state: journals.attemptState(post), post };
  }

  // Recorded in the transaction that closes the journal write, so a draft in
  // Xero cannot be left looking as if it never happened.
  async function markDrafted(db, id, created) {
    await db.query(
      `UPDATE finance.journals SET state = 'draft_created', xero_journal_id = $2, xero_journal_no = $3, xero_status = $4,
              drafted_at = now(), last_error = NULL, updated_at = now()
        WHERE id = $1 AND state = 'approved'`,
      [id, created?.journal_id ?? null, created?.journal_number != null ? String(created.journal_number) : null, created?.status ?? "DRAFT"]);
  }

  // ── The month's list ────────────────────────────────────────────────────────

  // GET /journals?period=2026-10   the register's journals and the recs' journals
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = String(req.query.period ?? "");
    if (!recs.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const entities = (await pool.query(
      "SELECT id, slug, name FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name", [client.id])).rows;
    const base = { period, label: recs.periodLabel(period), entities };

    let own;
    try {
      own = (await pool.query(
        `SELECT j.*, j.journal_date::text AS journal_date, e.name AS entity_name,
                p.outcome AS post_outcome, p.response_body->>'http_status' AS post_http, p.created_at AS post_at
           FROM finance.journals j
           JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.journal_posts p ON p.client_id = j.client_id AND p.entity_id = j.entity_id
             AND p.idempotency_key = 'journal-' || j.id || '-' || j.attempts
          WHERE j.client_id = $1 AND j.period = $2 AND j.state <> 'superseded'
          ORDER BY j.journal_date, j.created_at`, [client.id, period])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return res.json({ ...base, migration_missing: true, journals: [] });
    }

    // A rec's journals, read-only here. A database without migration 032 has none.
    let fromRecs = [];
    try {
      fromRecs = (await pool.query(
        `SELECT j.id, j.jnl_no, j.entity_id, e.name AS entity_name, j.state, j.journal_date::text AS journal_date, j.narration, j.lines, j.reason,
                j.proposed_by, j.approved_by, j.approved_at, j.rejected_by, j.rejected_at, j.xero_journal_no, j.drafted_at, j.created_at,
                to_jsonb(j)->>'xero_status' AS xero_status, to_jsonb(j)->>'xero_checked_at' AS xero_checked_at,
                r.id AS rec_id, r.period, a.account_name,
                ar.status AS run_status, ar.queued_at AS run_queued_at, p.outcome AS post_outcome, p.response_body->>'http_status' AS post_http
           FROM finance.rec_journals j
           JOIN finance.recs r ON r.id = j.rec_id
           JOIN finance.rec_accounts a ON a.id = r.rec_account_id
           JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.agent_runs ar ON ar.id = j.approved_run_id
           LEFT JOIN finance.journal_posts p ON p.client_id = j.client_id AND p.entity_id = j.entity_id
             AND p.idempotency_key = 'rec-journal-' || j.id || '-' || j.attempts
          WHERE j.client_id = $1 AND r.period = $2 AND j.state <> 'superseded'
          ORDER BY j.journal_date, j.created_at`, [client.id, period])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }

    const list = [
      ...own.map((j) => {
        const retry = j.state === "approved"
          ? journals.attemptState(j.post_outcome ? { outcome: j.post_outcome, http_status: j.post_http, created_at: j.post_at } : null)
          : null;
        return {
          kind: "register", id: j.id, jnl: journals.jnlRef(j.jnl_no), entity_id: j.entity_id, entity_name: j.entity_name, period: j.period, journal_date: j.journal_date,
          narration: j.narration, lines: j.lines, total: journals.totalOf(j.lines), reason: j.reason,
          source: journals.sourceOf({ kind: "register", source: j.source, proposed_by: j.proposed_by }), proposed_by: j.proposed_by,
          state: j.state, approved_by: j.approved_by, approved_at: j.approved_at, rejected_by: j.rejected_by, rejected_at: j.rejected_at,
          xero_journal_no: j.xero_journal_no, xero_status: j.xero_status, xero_checked_at: j.xero_checked_at, drafted_at: j.drafted_at,
          last_error: j.last_error, retry_state: retry, can_retry: ["go", "retry"].includes(retry), rec: null, created_at: j.created_at,
        };
      }),
      ...fromRecs.map((j) => {
        const retry = j.state === "approved"
          ? recs.retryState({ runLive: recs.runIsLive({ status: j.run_status, queued_at: j.run_queued_at }), post: j.post_outcome ? { outcome: j.post_outcome, http_status: j.post_http } : null })
          : null;
        return {
          kind: "rec", id: j.id, jnl: journals.jnlRef(j.jnl_no), entity_id: j.entity_id, entity_name: j.entity_name, period: j.period, journal_date: j.journal_date,
          narration: j.narration, lines: j.lines, total: journals.totalOf(j.lines), reason: j.reason,
          source: "rec", proposed_by: j.proposed_by,
          state: j.state, approved_by: j.approved_by, approved_at: j.approved_at, rejected_by: j.rejected_by, rejected_at: j.rejected_at,
          xero_journal_no: j.xero_journal_no, xero_status: j.xero_status ?? null, xero_checked_at: j.xero_checked_at ?? null, drafted_at: j.drafted_at,
          last_error: null, retry_state: retry, can_retry: false, rec: { id: j.rec_id, account_name: j.account_name }, created_at: j.created_at,
        };
      }),
    ].sort((a, b) => a.journal_date.localeCompare(b.journal_date) || String(a.created_at).localeCompare(String(b.created_at)));

    res.json({
      ...base,
      journals: list,
      counts: { waiting: list.filter((j) => j.state === "proposed").length, total: list.length },
    });
  }));

  // ── Proposing ───────────────────────────────────────────────────────────────

  // POST /journals   body: { entity, date, narration, lines, reason }
  // A person here, or FM1 or the FC from a run (X-Work-Via agent:fm1:<run>).
  // Nothing reaches Xero: the CFO approves it first.
  app.post(BASE, tolerant(async (req, res) => {
    const who = caller(req, res);
    if (!who) return;
    const { via } = who;
    if (via && !(via.kind === "agent" && journals.PROPOSERS.includes(via.agent))) {
      return res.status(403).json({ error: "A journal is proposed by a person here, or by FM1 or the FC from a run" });
    }
    const source = via ? "agent" : "person";
    const body = req.body || {};
    const issues = journals.journalIssues(body, { source });
    if (issues.length) return res.status(422).json({ issues });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const entity = (await pool.query(
      "SELECT id, slug, name, legal_name, accounting_system_config FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL",
      [client.id, String(body.entity)])).rows[0];
    if (!entity) return res.status(422).json({ issues: [`no company ${body.entity} for this client`] });

    // The chart and the lock date, read before a pooled connection is held. The
    // same checks run again when the CFO approves, so a read that fails now is a
    // warning, not a refusal.
    const warnings = [];
    const pre = await journalPreflight(req.params.slug, entity.slug);
    if (pre.unavailable) {
      warnings.push("Xero could not be read, so the account codes and the lock date were not checked yet. They are checked again before anything goes to Xero.");
    } else {
      const ledger = journals.ledgerIssues(body, {
        accounts: pre.accounts, lockDates: pre.lockDates,
        entityNames: [entity.slug, entity.name, entity.legal_name, entity.accounting_system_config?.tenant_name].filter(Boolean),
      });
      if (ledger.length) return res.status(422).json({ issues: ledger });
    }

    const lines = journals.cleanLines(body.lines);
    const out = await tx(client, who, async (conn, { actor, actorEmail, role }) => {
      // An agent proposes only from a live run of its own, for this client.
      if (via) {
        const run = (await conn.query(
          "SELECT agent, status FROM finance.agent_runs WHERE id = $1 AND client_id = $2", [via.run_id, client.id])).rows[0];
        if (!run || run.agent !== via.agent || !["queued", "running"].includes(run.status)) {
          return { status: 403, body: { error: "That run is not a live run of this agent for this client" } };
        }
      }
      // The same journal twice is one journal: the same company, date and
      // amounts, still waiting or already in Xero. Locked, so two at once cannot both pass.
      const same = (await conn.query(
        `SELECT id, jnl_no, state, lines FROM finance.journals
          WHERE client_id = $1 AND entity_id = $2 AND journal_date = $3 AND state IN ('proposed', 'approved', 'draft_created', 'posted')
          FOR UPDATE`, [client.id, entity.id, body.date])).rows
        .find((j) => recs.amountsKey(j.lines) === recs.amountsKey(lines));
      if (same) {
        const where = { proposed: "waiting for the CFO", approved: "approved and going to Xero", draft_created: "a draft in Xero", posted: "posted in Xero" }[same.state];
        return { status: 409, body: { error: `The same journal is already ${where}, as ${journals.jnlRef(same.jnl_no)}.`, id: same.id, jnl: journals.jnlRef(same.jnl_no) } };
      }
      const row = (await conn.query(
        `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by, proposed_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, jnl_no`,
        [client.id, entity.id, body.date.slice(0, 7), body.date, String(body.narration).trim(), JSON.stringify(lines),
          String(body.reason ?? "").trim() || null, source, actor, via?.run_id ?? null])).rows[0];
      await auditJournal(conn, req, {
        client, actorEmail, role, action: "journal_proposed", id: row.id,
        payload: { jnl: journals.jnlRef(row.jnl_no), via: via ? `${via.agent}:${via.run_id}` : null, entity: entity.slug, date: body.date, narration: String(body.narration).trim(), lines },
      });
      return { status: 201, body: { id: row.id, jnl: journals.jnlRef(row.jnl_no), warnings } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── Checking Xero ───────────────────────────────────────────────────────────

  // POST /journals/refresh   body: { period }
  // Reads each draft the register made this month back from Xero, and marks
  // the ones a person has posted there. One read per draft; nothing is written
  // to Xero. A rec's drafts are not read here.
  app.post(`${BASE}/refresh`, tolerant(async (req, res) => {
    const who = caller(req, res);
    if (!who) return;
    const period = String(req.body?.period ?? "");
    if (!recs.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
    if (!role) return res.status(403).json({ error: `${who.actorEmail} holds no engagement role for this client` });
    const drafts = (await pool.query(
      `SELECT j.id, j.xero_journal_id, e.slug AS entity_slug FROM finance.journals j JOIN finance.entities e ON e.id = j.entity_id
        WHERE j.client_id = $1 AND j.period = $2 AND j.state = 'draft_created' AND j.xero_journal_id IS NOT NULL
        ORDER BY j.drafted_at LIMIT 50`, [client.id, period])).rows;
    let posted = 0;
    const errors = [];
    // One at a time: Xero allows five concurrent calls per organisation, and
    // this is not the only caller.
    for (const d of drafts) {
      const got = await xeroManualJournalStatus(req.params.slug, d.entity_slug, d.xero_journal_id);
      if (got.error) { errors.push({ id: d.id, error: got.error }); continue; }
      const next = journals.stateFromXero(got.status);
      const r = await pool.query(
        `UPDATE finance.journals SET xero_status = $2, xero_checked_at = now(), updated_at = now(),
                state = COALESCE($3, state)
          WHERE id = $1 AND state = 'draft_created' RETURNING state`, [d.id, got.status, next]);
      if (r.rows[0]?.state === "posted") posted += 1;
    }
    // A reconciliation's drafts too, by the rec's month: a person posts them in
    // Xero, and the rec, its chain and this page should then say so. Skipped,
    // not failed, on a database without migration 038.
    let recDrafts = [];
    try {
      recDrafts = (await pool.query(
        `SELECT j.id, j.rec_id, j.client_id, j.xero_journal_id, e.slug AS entity_slug, j.xero_checked_at
           FROM finance.rec_journals j JOIN finance.recs r ON r.id = j.rec_id JOIN finance.entities e ON e.id = j.entity_id
          WHERE j.client_id = $1 AND r.period = $2 AND j.state = 'draft_created' AND j.xero_journal_id IS NOT NULL
          ORDER BY j.drafted_at LIMIT 50`, [client.id, period])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    for (const d of recDrafts) {
      const got = await xeroManualJournalStatus(req.params.slug, d.entity_slug, d.xero_journal_id);
      if (got.error) { errors.push({ id: d.id, error: got.error }); continue; }
      const next = journals.stateFromXero(got.status);
      let r;
      try {
        r = await pool.query(
          `UPDATE finance.rec_journals SET xero_status = $2, xero_checked_at = now(), state = COALESCE($3, state)
            WHERE id = $1 AND state = 'draft_created' RETURNING state`, [d.id, got.status, next]);
      } catch (e) {
        if (!isMissingTable(e)) throw e;
        break;
      }
      if (r.rows[0]?.state === "posted") {
        posted += 1;
        await pool.query(
          "INSERT INTO finance.rec_events (rec_id, client_id, actor, action, detail) VALUES ($1,$2,'automatic','journal_posted',$3)",
          [d.rec_id, d.client_id, JSON.stringify({ journal_id: d.id })]);
      }
    }
    res.json({ checked: drafts.length + recDrafts.length - errors.length, posted, errors });
  }));

  // ── The CFO's decision ──────────────────────────────────────────────────────

  // POST /journals/:id/approve   the CFO approves on the screen, and finance-api
  // creates exactly this journal in Xero as a DRAFT. Approving again creates
  // nothing more: the key is the journal's, and moves on only after Xero
  // definitely refused the last attempt.
  app.post(`${BASE}/:id/approve`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a journal id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });

    // The decision, in its own short transaction.
    let j;
    let approval;
    const decided = await tx(client, who, async (conn, { actorEmail, role }) => {
      if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO approves a journal" } };
      j = await loadJournal(conn, client.id, req.params.id, true);
      if (!j) return { status: 404, body: { error: "journal not found" } };
      if (["draft_created", "posted"].includes(j.state)) return { status: 409, body: { error: "This journal is already in Xero. Post it there, or void it there if it is not wanted." } };
      if (!["proposed", "approved"].includes(j.state)) return { status: 409, body: { error: `This journal is ${j.state}` } };
      let attempts = j.attempts;
      if (j.state === "approved") {
        const after = await lastAttempt(conn, j);
        if (after.state === "live") return { status: 409, body: { error: "This journal is being created in Xero now." } };
        if (after.state === "unknown") return { status: 409, body: { error: "The last attempt did not finish cleanly, so this draft may already be in Xero. Check Xero. If it is not there, reject this and propose it again." } };
        if (after.state === "drafted") {
          await markDrafted(conn, j.id, after.post?.response_body);
          return { status: 200, body: { drafted: true, caught_up: true } };
        }
        if (after.state === "retry") attempts += 1;
      }
      await conn.query(
        `UPDATE finance.journals SET state = 'approved', approved_by = $2, approved_at = now(), attempts = $3, last_error = NULL, updated_at = now()
          WHERE id = $1`, [j.id, actorEmail, attempts]);
      j.attempts = attempts;
      approval = journals.approvalFor(j, { entityName: j.entity_name, actorEmail });
      await auditJournal(conn, req, {
        client, actorEmail, role, action: "journal_approved", id: j.id,
        payload: { entity: j.entity_slug, date: j.journal_date, narration: j.narration, lines: j.lines, attempts, key: journals.journalKey(j) },
      });
      return { status: 200, body: {}, go: true };
    });
    if (!decided.go) return res.status(decided.status).json(decided.body);

    // The write, after the decision is committed. DRAFT only, under the
    // journal's own key, through the one journal write.
    const out = await postManualJournal({
      slug: req.params.slug, entitySlug: j.entity_slug, actorEmail: who.actorEmail, ip: req.get("X-Forwarded-For") || req.ip,
      body: {
        date: j.journal_date, narration: j.narration, lines: j.lines, status: "DRAFT",
        idempotency_key: journals.journalKey(j), approval,
      },
      onDrafted: (db, created) => markDrafted(db, j.id, created),
      register: true,
    });
    if (out.body?.ok) {
      return res.json({ drafted: true, journal_number: out.body.journal_number ?? null, warnings: out.body.warnings ?? [] });
    }
    const text = journals.failureText(out);
    if (!out.sent) {
      // Nothing reached Xero, so the journal goes back to waiting, with why.
      await pool.query(
        `UPDATE finance.journals SET state = 'proposed', approved_by = NULL, approved_at = NULL, last_error = $3, updated_at = now()
          WHERE id = $1 AND state = 'approved' AND attempts = $2`, [j.id, j.attempts, text]);
      return res.status(422).json({ error: text, issues: [text] });
    }
    // It may have reached Xero. It stays approved, and the list says whether
    // trying again is safe.
    await pool.query("UPDATE finance.journals SET last_error = $2, updated_at = now() WHERE id = $1 AND state = 'approved'", [j.id, text]);
    return res.status(out.status >= 400 ? out.status : 502).json({ error: text });
  }));

  // POST /journals/:id/reject   body: { confirmed_not_in_xero }
  app.post(`${BASE}/:id/reject`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true });
    if (!who) return;
    if (!work.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a journal id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO rejects a journal" } };
      const j = await loadJournal(conn, client.id, req.params.id, true);
      if (!j || !["proposed", "approved"].includes(j.state)) return { status: 409, body: { error: "This journal is not waiting for a decision" } };
      let unknown = false;
      if (j.state === "approved") {
        const after = await lastAttempt(conn, j);
        if (after.state === "live") return { status: 409, body: { error: "This journal is being created in Xero now." } };
        if (after.state === "drafted") return { status: 409, body: { error: "This journal is already a draft in Xero. Void it there if it is not wanted." } };
        unknown = after.state === "unknown";
        if (unknown && req.body?.confirmed_not_in_xero !== true) {
          return { status: 409, body: { error: "This draft may be in Xero. Check Xero. Reject it only once you have seen it is not there." } };
        }
      }
      await conn.query(
        `UPDATE finance.journals SET state = 'rejected', rejected_by = $2, rejected_at = now(), rejected_after_check = $3, updated_at = now()
          WHERE id = $1`, [j.id, actorEmail, unknown]);
      await auditJournal(conn, req, { client, actorEmail, role, action: "journal_rejected", id: j.id, payload: { was: j.state, confirmed_not_in_xero: unknown } });
      return { status: 200, body: { ok: true } };
    });
    res.status(out.status).json(out.body);
  }));

  // The gate at the journal write, for every caller but the register's own
  // approval (lib/journals.js registerGate). Fails closed: a read that fails
  // throws, and nothing is posted. Only a database without migration 033
  // passes, because it can hold no register journals.
  async function registerGate(clientId, entityId, { input }) {
    try {
      const proposals = (await pool.query(
        `SELECT state, journal_date::text AS journal_date, lines FROM finance.journals
          WHERE client_id = $1 AND entity_id = $2 AND state <> 'superseded'
            AND (period = $3 OR state IN ('proposed', 'approved'))`,
        [clientId, entityId, String(input?.date ?? "").slice(0, 7)])).rows;
      return journals.registerGate({ proposals, input });
    } catch (e) {
      if (isMissingTable(e)) return {};
      throw e;
    }
  }

  return { registerGate };
}

module.exports = { mountJournals };
