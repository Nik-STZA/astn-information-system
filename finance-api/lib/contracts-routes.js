// Contracts routes: lib/contracts.js decides, this applies, in finance.contracts,
// contract_schedule, contract_movements and contract_uploads (migration 047).
//
// Ring-fenced per client (Nik, 15 Nov 2026): every query names the client and
// the id together, so a contract id from another client is simply not found.
//
// People only change the register, in os.stza.io; agents read it through the
// Deferred income reconciliation (lib/recs-routes.js, method "contracts"). A
// contract PDF is held only until it has been read; its contents are then
// deleted in the same transaction that saves the terms, as outstanding
// documents are. The original lives on the client's drive.
//
// Until migration 047 is applied the list answers migration_missing and every
// other route a 503, so finance-api can deploy ahead of it.

const crypto = require("crypto");
const k = require("./contracts");

const MISSING = "Contracts are waiting for migration 047 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const STALE_READ_MINUTES = 10;
const REVENUE_PROCEDURE = "revenue-and-deferred-revenue";

function mountContracts(app, { route, pool, audit, clientIdFromSlug, generate, express, viaInput }) {
  const BASE = "/api/finance/clients/:slug/contracts";
  const rawBody = express.raw({ type: () => true, limit: k.MAX_UPLOAD_BYTES + 1024 });

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  // A person, in os.stza.io. Agents and Claude conversations are refused.
  function person(req, res) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    if (origin.via) { res.status(403).json({ error: "only a person changes the contracts register, in os.stza.io" }); return null; }
    return { actorEmail };
  }

  // A short transaction with the person's role for this client.
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

  const send = (res, out) => res.status(out.status).json(out.body);
  const log = (db, req, { client, actorEmail, role, action, targetType = "contract", id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType, targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const entitiesOf = async (db, clientId) => (await db.query(
    "SELECT id, slug, name, legal_name FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name", [clientId])).rows;

  const num = (v) => (v == null ? null : Number(v));
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  const CONTRACT_SELECT = `SELECT c.*, c.start_date::text AS start_date, c.end_date::text AS end_date, e.slug AS entity_slug, e.name AS entity_name
                             FROM finance.contracts c JOIN finance.entities e ON e.id = c.entity_id`;
  const contractView = (c) => ({
    id: c.id, entity_slug: c.entity_slug, entity_name: c.entity_name, side: c.side, counterparty: c.counterparty,
    title: c.title, reference: c.reference, pattern: c.pattern, pattern_label: k.PATTERN[c.pattern]?.label ?? c.pattern,
    pattern_confirmed_by: c.pattern_confirmed_by, pattern_confirmed_at: c.pattern_confirmed_at,
    status: c.status, currency: c.currency, total_value: num(c.total_value), start_date: c.start_date, end_date: c.end_date,
    renewal: c.renewal, notice_days: c.notice_days, notice_by: k.noticeBy(c), payment_terms: c.payment_terms,
    account_code: c.account_code, notes: c.notes, source: c.source, upload_id: c.upload_id,
    created_by: c.created_by, created_at: c.created_at, updated_at: c.updated_at, ended_by: c.ended_by, ended_at: c.ended_at, end_reason: c.end_reason,
    // Monitoring (migration 048; absent before it is applied).
    cost_amount: num(c.cost_amount), billing_frequency: c.billing_frequency ?? null, annual_value: k.annualValue(c),
    document_url: c.document_url ?? null,
    renewal_decision: k.currentDecision(c), renewal_decision_note: k.currentDecision(c) ? c.renewal_decision_note : null,
    renewal_decided_by: k.currentDecision(c) ? c.renewal_decided_by : null, renewal_decided_at: k.currentDecision(c) ? c.renewal_decided_at : null,
  });
  const scheduleView = (s) => ({
    id: s.id, kind: s.kind, seq: s.seq, label: s.label, trigger_text: s.trigger_text, amount: num(s.amount),
    due_on: k.day(s.due_on), expected: s.expected, status: s.status, received_amount: num(s.received_amount),
    received_on: k.day(s.received_on), evidence: s.evidence, note: s.note, updated_by: s.updated_by, updated_at: s.updated_at,
  });
  const movementView = (m) => ({
    id: m.id, kind: m.kind, on_date: k.day(m.on_date), amount: num(m.amount), ref: m.ref, note: m.note,
    added_by: m.added_by, added_at: m.added_at, withdrawn_at: m.withdrawn_at, withdrawn_by: m.withdrawn_by,
  });
  const UPLOAD_COLUMNS = "id, file_name, size_bytes, uploaded_by, uploaded_at, read_state, read_error, read_at, read_with, proposed, contract_id, bytes_cleared_at";
  const uploadView = (u) => ({
    id: u.id, file_name: u.file_name, size_bytes: u.size_bytes, uploaded_by: u.uploaded_by, uploaded_at: u.uploaded_at,
    read_state: u.read_state, read_error: u.read_error, read_at: u.read_at, read_with: u.read_with,
    proposed: u.proposed, contract_id: u.contract_id, file_deleted_at: u.bytes_cleared_at,
  });

  // The latest reconciled ledger balance of an account in a company, from the
  // trial balances the Reconciliations pages read, or null.
  async function ledgerOf(db, clientId, entityId, code) {
    if (!code) return null;
    try {
      const r = (await db.query(
        `SELECT r.period, r.period_end::text AS period_end, b.closing FROM finance.rec_balances b JOIN finance.recs r ON r.id = b.rec_id
          WHERE r.client_id = $1 AND b.entity_id = $2 AND b.account_code = $3 AND r.dropped_at IS NULL
          ORDER BY r.period DESC LIMIT 1`, [clientId, entityId, code])).rows[0];
      return r ? { period: r.period, period_end: r.period_end, closing: Number(r.closing) } : null;
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  // Register against ledger for each company and account customer contracts
  // hold money on: the register at the ledger's month end, as a liability.
  async function tiesFor(db, clientId, contracts, movementsByContract) {
    const keys = new Map();
    for (const c of contracts) {
      if (c.side !== "customer" || !c.account_code || c.status === "cancelled") continue;
      const key = `${c.entity_id}|${c.account_code}`;
      if (!keys.has(key)) keys.set(key, { entity_id: c.entity_id, entity_name: c.entity_name, account_code: c.account_code, contracts: [] });
      keys.get(key).contracts.push(c);
    }
    const out = [];
    for (const t of keys.values()) {
      const ledger = await ledgerOf(db, clientId, t.entity_id, t.account_code);
      const date = ledger?.period_end ?? today();
      const held = t.contracts.reduce((s, c) => s + k.heldAt(movementsByContract.get(c.id) ?? [], date), 0);
      const register = -held / 100;
      out.push({
        entity_name: t.entity_name, account_code: t.account_code, as_at: date, register, ledger: ledger ? ledger.closing : null,
        agrees: ledger ? Math.round(ledger.closing * 100) === -held : null,
      });
    }
    return out;
  }

  // The client's rules on the revenue procedure, approved and in draft, so the
  // contract page shows the layer between the standard pattern and the contract.
  async function clientRules(db, clientId) {
    try {
      return (await db.query(
        `SELECT kind, title, summary, status, version FROM finance.client_procedures
          WHERE client_id = $1 AND procedure = $2 AND status IN ('approved', 'draft') ORDER BY status, title`, [clientId, REVENUE_PROCEDURE])).rows;
    } catch (e) {
      if (isMissingTable(e)) return [];
      throw e;
    }
  }

  // The Work task for a contract's notice deadline: once per deadline, so a
  // changed end date or notice period raises a new one.
  async function syncNoticeTask(conn, client, c, actor) {
    const plan = k.noticeTask(c, c.entity_name);
    if (!plan) return null;
    const had = (await conn.query("SELECT id FROM finance.tasks WHERE client_id = $1 AND source = $2 AND source_ref = $3", [client.id, plan.source, plan.source_ref])).rows[0];
    if (had) return had.id;
    const position = (await conn.query("SELECT COALESCE(MAX(position), 0)::int + 1 AS p FROM finance.tasks WHERE client_id = $1", [client.id])).rows[0].p;
    const row = (await conn.query(
      `INSERT INTO finance.tasks (client_id, created_by, title, notes, status, due_on, entity_id, source, source_ref, position)
       VALUES ($1,$2,$3,$4,'todo',$5,$6,$7,$8,$9) RETURNING id`,
      [client.id, actor, plan.title, plan.notes, plan.due_on, c.entity_id, plan.source, plan.source_ref, position])).rows[0];
    await conn.query(
      "INSERT INTO finance.task_events (task_id, client_id, actor, action, detail) VALUES ($1,$2,$3,'created',$4)",
      [row.id, client.id, actor, JSON.stringify({ from: "contracts register", contract: c.id, notice_by: k.noticeBy(c) })]);
    return row.id;
  }

  const loadContract = async (db, clientId, id, lock = false) => (await db.query(
    `${CONTRACT_SELECT} WHERE c.id = $1 AND c.client_id = $2 ${lock ? "FOR UPDATE OF c" : ""}`, [id, clientId])).rows[0];

  // ── The register ──────────────────────────────────────────────────────────

  // GET /contracts?side=customer|supplier&status=all
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const side = ["customer", "supplier"].includes(req.query.side) ? req.query.side : null;
    const all = req.query.status === "all";
    const companies = (await entitiesOf(pool, client.id)).map((e) => ({ slug: e.slug, name: e.name }));
    let rows, schedule, movements, uploads;
    try {
      rows = (await pool.query(
        `${CONTRACT_SELECT} WHERE c.client_id = $1 ${all ? "" : "AND c.status = 'active'"} ORDER BY c.side, c.counterparty`, [client.id])).rows;
      const ids = rows.map((r) => r.id);
      schedule = ids.length ? (await pool.query("SELECT * FROM finance.contract_schedule WHERE client_id = $1 AND contract_id = ANY($2::uuid[]) ORDER BY kind, seq", [client.id, ids])).rows : [];
      movements = ids.length ? (await pool.query("SELECT * FROM finance.contract_movements WHERE client_id = $1 AND contract_id = ANY($2::uuid[]) AND withdrawn_at IS NULL", [client.id, ids])).rows : [];
      uploads = (await pool.query(
        `SELECT ${UPLOAD_COLUMNS} FROM finance.contract_uploads WHERE client_id = $1 AND read_state IN ('waiting', 'reading', 'read', 'failed')
          ORDER BY uploaded_at DESC LIMIT 100`, [client.id])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return res.json({ migration_missing: true, contracts: [], coming_up: [], uploads: [], ties: [], companies, patterns: k.PATTERNS,
        renewing_soon: k.renewingSoon([], today()), forward: k.forwardView([], [], today(), 12) });
    }
    const byContract = new Map();
    for (const m of movements) { if (!byContract.has(m.contract_id)) byContract.set(m.contract_id, []); byContract.get(m.contract_id).push(m); }
    const t = today();
    const nextOf = (id) => {
      const items = k.comingUp(rows.filter((r) => r.id === id), schedule.filter((s) => s.contract_id === id), t);
      return items[0] ?? null;
    };
    const contracts = rows.filter((r) => !side || r.side === side).map((r) => ({
      ...contractView(r), held: k.heldAt(byContract.get(r.id) ?? [], t) / 100, next: nextOf(r.id),
    }));
    res.json({
      contracts,
      coming_up: k.comingUp(rows, schedule, t),
      renewing_soon: k.renewingSoon(rows, t),
      forward: k.forwardView(rows, schedule, t, 12),
      uploads: uploads.map(uploadView),
      ties: await tiesFor(pool, client.id, rows, byContract),
      companies, patterns: k.PATTERNS,
    });
  }));

  // GET /contracts/:id
  app.get(`${BASE}/:id`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!k.isGuid(req.params.id)) return res.status(404).json({ error: "no such contract" });
    const c = await loadContract(pool, client.id, req.params.id);
    if (!c) return res.status(404).json({ error: "no such contract" });
    const schedule = (await pool.query("SELECT * FROM finance.contract_schedule WHERE client_id = $1 AND contract_id = $2 ORDER BY kind, seq, updated_at", [client.id, c.id])).rows;
    const movements = (await pool.query("SELECT * FROM finance.contract_movements WHERE client_id = $1 AND contract_id = $2 ORDER BY on_date, added_at", [client.id, c.id])).rows;
    const upload = c.upload_id ? (await pool.query(`SELECT ${UPLOAD_COLUMNS} FROM finance.contract_uploads WHERE id = $1 AND client_id = $2`, [c.upload_id, client.id])).rows[0] : null;
    const live = movements.filter((m) => !m.withdrawn_at);
    const ledger = c.side === "customer" ? await ledgerOf(pool, client.id, c.entity_id, c.account_code) : null;
    const companies = (await entitiesOf(pool, client.id)).map((e) => ({ slug: e.slug, name: e.name }));
    res.json({
      contract: contractView(c),
      pattern: k.PATTERN[c.pattern] ?? null,
      client_rules: c.side === "customer" ? await clientRules(pool, client.id) : [],
      schedule: schedule.map(scheduleView),
      movements: movements.map(movementView),
      held: k.heldAt(live, today()) / 100,
      ledger: ledger ? { ...ledger, register: -k.heldAt(live, ledger.period_end) / 100 } : null,
      upload: upload ? uploadView(upload) : null,
      companies, patterns: k.PATTERNS,
    });
  }));

  // POST /contracts   body: the contract's fields, schedule [], movements [],
  // upload_id (the read it was made from), confirm_pattern (the CFO confirms
  // the pattern in the same step)
  app.post(BASE, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const body = req.body || {};
    const entities = await entitiesOf(pool, client.id);
    const { set, issues } = k.contractInput(body, entities);
    issues.push(...k.sideIssues(set.side, set.pattern), ...k.datesIssues(set));
    const items = (Array.isArray(body.schedule) ? body.schedule : []).slice(0, 50).map((s, i) => {
      const r = k.scheduleInput({ seq: i + 1, ...s });
      issues.push(...r.issues.map((x) => `schedule line ${i + 1}: ${x}`), ...k.scheduleIssues({ status: "pending", ...r.set }).map((x) => `schedule line ${i + 1}: ${x}`));
      return r.set;
    });
    const moves = (Array.isArray(body.movements) ? body.movements : []).slice(0, 50).map((m, i) => {
      const r = k.movementInput(m);
      issues.push(...r.issues.map((x) => `movement ${i + 1}: ${x}`));
      return r.set;
    });
    if (moves.length && !set.account_code) issues.push("account_code is required to hold money on the balance sheet");
    if (body.upload_id !== undefined && body.upload_id !== null && !k.isGuid(body.upload_id)) issues.push("upload_id must be an upload id");
    if (issues.length) return res.status(422).json({ issues });

    send(res, await tx(client, who, async (conn, w) => {
      if (body.confirm_pattern === true && !k.isCfo(w.role)) return { status: 403, body: { error: "only the CFO confirms a contract's pattern" } };
      let upload = null;
      if (body.upload_id) {
        upload = (await conn.query("SELECT id, read_state FROM finance.contract_uploads WHERE id = $1 AND client_id = $2 FOR UPDATE", [body.upload_id, client.id])).rows[0];
        if (!upload) return { status: 404, body: { error: "no such upload" } };
        if (upload.read_state !== "read") return { status: 409, body: { error: `this upload is ${upload.read_state}; a contract is made once from a read` } };
      }
      const confirmed = body.confirm_pattern === true;
      const cols = Object.keys(set);
      const vals = cols.map((c) => set[c]);
      const extra = { client_id: client.id, source: upload ? "upload" : "person", upload_id: upload?.id ?? null, created_by: w.actorEmail,
        pattern_confirmed_by: confirmed ? w.actorEmail : null };
      const all = [...cols, ...Object.keys(extra)];
      const row = (await conn.query(
        `INSERT INTO finance.contracts (${all.join(", ")}${confirmed ? ", pattern_confirmed_at" : ""})
         VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")}${confirmed ? ", now()" : ""}) RETURNING id`,
        [...vals, ...Object.values(extra)])).rows[0];
      for (const s of items) {
        const sc = Object.keys(s);
        await conn.query(
          `INSERT INTO finance.contract_schedule (client_id, contract_id, updated_by, ${sc.join(", ")}) VALUES ($1,$2,$3,${sc.map((_, i) => `$${i + 4}`).join(", ")})`,
          [client.id, row.id, w.actorEmail, ...sc.map((x) => s[x])]);
      }
      for (const m of moves) {
        await conn.query(
          "INSERT INTO finance.contract_movements (client_id, contract_id, kind, on_date, amount, ref, note, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [client.id, row.id, m.kind, m.on_date, m.amount, m.ref, m.note, w.actorEmail]);
      }
      if (upload) await conn.query("UPDATE finance.contract_uploads SET read_state = 'added', contract_id = $2 WHERE id = $1", [upload.id, row.id]);
      const c = await loadContract(conn, client.id, row.id);
      const task = await syncNoticeTask(conn, client, c, w.actorEmail);
      await log(conn, req, { client, ...w, action: "contract_added", id: row.id, payload: { ...set, schedule: items.length, movements: moves.length, upload_id: upload?.id ?? null, pattern_confirmed: confirmed, notice_task: task } });
      return { status: 201, body: { id: row.id, notice_task: task } };
    }));
  }));

  // One contract, locked, by client and id.
  async function onContract(req, res, fn) {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!k.isGuid(req.params.id)) return res.status(404).json({ error: "no such contract" });
    send(res, await tx(client, who, async (conn, w) => {
      const c = await loadContract(conn, client.id, req.params.id, true);
      if (!c) return { status: 404, body: { error: "no such contract" } };
      return fn(conn, w, { client, c });
    }));
  }

  // PATCH /contracts/:id   any of the contract's fields. A changed pattern or
  // side needs confirming again.
  app.patch(`${BASE}/:id`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    const entities = client ? await entitiesOf(pool, client.id) : [];
    return onContract(req, res, async (conn, w, { c }) => {
      if (c.status !== "active") return { status: 422, body: { issues: [`this contract is ${c.status}`] } };
      const { set, issues } = k.contractInput(req.body || {}, entities, { partial: true });
      const after = { ...c, ...set };
      issues.push(...k.sideIssues(after.side, after.pattern), ...k.datesIssues(after));
      if (issues.length) return { status: 422, body: { issues } };
      if (!Object.keys(set).length) return { status: 422, body: { issues: ["nothing to change"] } };
      const repattern = ("pattern" in set && set.pattern !== c.pattern) || ("side" in set && set.side !== c.side);
      const cols = Object.keys(set);
      await conn.query(
        `UPDATE finance.contracts SET ${cols.map((x, i) => `${x} = $${i + 3}`).join(", ")}, updated_at = now()
           ${repattern ? ", pattern_confirmed_by = NULL, pattern_confirmed_at = NULL" : ""}
          WHERE id = $1 AND client_id = $2`, [c.id, client.id, ...cols.map((x) => set[x])]);
      const now = await loadContract(conn, client.id, c.id);
      const task = await syncNoticeTask(conn, client, now, w.actorEmail);
      const before = Object.fromEntries(cols.map((x) => [x, c[x] instanceof Date ? k.day(c[x]) : c[x]]));
      await log(conn, req, { client, ...w, action: "contract_edited", id: c.id, payload: { before, after: set, pattern_unconfirmed: repattern, notice_task: task } });
      return { status: 200, body: { id: c.id, notice_task: task } };
    });
  }));

  // POST /contracts/:id/confirm-pattern   body: { pattern? }   CFO only
  app.post(`${BASE}/:id/confirm-pattern`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    if (!k.isCfo(w.role)) return { status: 403, body: { error: "only the CFO confirms a contract's pattern" } };
    const pattern = req.body?.pattern ?? c.pattern;
    if (!k.PATTERN[pattern]) return { status: 422, body: { issues: ["pattern must be one of the standard patterns"] } };
    const issues = k.sideIssues(c.side, pattern);
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      "UPDATE finance.contracts SET pattern = $3, pattern_confirmed_by = $4, pattern_confirmed_at = now(), updated_at = now() WHERE id = $1 AND client_id = $2",
      [c.id, client.id, pattern, w.actorEmail]);
    await log(conn, req, { client, ...w, action: "contract_pattern_confirmed", id: c.id, payload: { from: c.pattern, to: pattern } });
    return { status: 200, body: { id: c.id, pattern } };
  })));

  // POST /contracts/:id/renewal-decision   body: { decision: keep|cancel|renegotiate, note }
  // For the coming renewal (the current end date). Keep closes the notice
  // task; cancel and renegotiate keep it open, retitled, as the deadline still
  // matters. Any engagement role may record it.
  app.post(`${BASE}/:id/renewal-decision`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    const { issues, decision, note } = k.decisionInput(req.body || {}, c);
    if (issues.length) return { status: 422, body: { issues } };
    await conn.query(
      `UPDATE finance.contracts SET renewal_decision = $3, renewal_decision_note = $4, renewal_decision_for = end_date,
              renewal_decided_by = $5, renewal_decided_at = now(), updated_at = now() WHERE id = $1 AND client_id = $2`,
      [c.id, client.id, decision, note, w.actorEmail]);
    const by = k.noticeBy(c);
    const ref = by ? `contract:${c.id}:notice:${by}` : null;
    const task = ref ? (await conn.query(
      "SELECT id, status FROM finance.tasks WHERE client_id = $1 AND source = 'contract' AND source_ref = $2 AND deleted_at IS NULL", [client.id, ref])).rows[0] : null;
    let taskSaid = null;
    if (task && task.status !== "done") {
      if (decision === "keep") {
        await conn.query("UPDATE finance.tasks SET status = 'done', closed_at = now(), updated_at = now() WHERE id = $1", [task.id]);
        await conn.query("INSERT INTO finance.task_events (task_id, client_id, actor, action, detail) VALUES ($1,$2,$3,'status',$4)",
          [task.id, client.id, w.actorEmail, JSON.stringify({ changes: { status: { from: task.status, to: "done" } }, from: "contracts register", renewal_decision: decision })]);
        taskSaid = "closed";
      } else {
        const old = (await conn.query("SELECT title FROM finance.tasks WHERE id = $1", [task.id])).rows[0].title;
        const title = decision === "cancel" ? `Give notice to cancel ${c.counterparty} by ${by}` : `Renegotiate ${c.counterparty} before ${by}`;
        await conn.query("UPDATE finance.tasks SET title = $2, updated_at = now() WHERE id = $1", [task.id, title]);
        await conn.query("INSERT INTO finance.task_events (task_id, client_id, actor, action, detail) VALUES ($1,$2,$3,'changed',$4)",
          [task.id, client.id, w.actorEmail, JSON.stringify({ changes: { title: { from: old, to: title } }, from: "contracts register" })]);
        taskSaid = "updated";
      }
      await conn.query("INSERT INTO finance.task_events (task_id, client_id, actor, action, detail) VALUES ($1,$2,$3,'comment',$4)",
        [task.id, client.id, w.actorEmail, JSON.stringify({ text: `Renewal decided: ${decision}. ${note}` })]);
    }
    await log(conn, req, { client, ...w, action: "contract_renewal_decided", id: c.id, payload: { decision, note, for_end_date: k.day(c.end_date), notice_by: by, task: taskSaid } });
    return { status: 200, body: { id: c.id, decision, task: taskSaid } };
  })));

  // POST /contracts/:id/end   body: { status: ended|cancelled, reason }
  app.post(`${BASE}/:id/end`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    const to = req.body?.status;
    const reason = k.clean(req.body?.reason, 500);
    if (!["ended", "cancelled"].includes(to)) return { status: 422, body: { issues: ["status must be ended or cancelled"] } };
    if (!reason || reason.length < 10) return { status: 422, body: { issues: ["say why, in 10 characters or more"] } };
    if (c.status !== "active") return { status: 422, body: { issues: [`this contract is already ${c.status}`] } };
    await conn.query(
      "UPDATE finance.contracts SET status = $3, ended_by = $4, ended_at = now(), end_reason = $5, updated_at = now() WHERE id = $1 AND client_id = $2",
      [c.id, client.id, to, w.actorEmail, reason]);
    await log(conn, req, { client, ...w, action: `contract_${to}`, id: c.id, payload: { reason } });
    return { status: 200, body: { id: c.id, status: to } };
  })));

  // POST /contracts/:id/schedule   body: one payment or milestone
  app.post(`${BASE}/:id/schedule`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    const seq = (await conn.query("SELECT COALESCE(MAX(seq), 0)::int + 1 AS n FROM finance.contract_schedule WHERE contract_id = $1 AND kind = $2", [c.id, req.body?.kind])).rows[0].n;
    const { set, issues } = k.scheduleInput({ seq, ...(req.body || {}) });
    issues.push(...k.scheduleIssues({ status: "pending", ...set }));
    if (issues.length) return { status: 422, body: { issues } };
    const cols = Object.keys(set);
    const row = (await conn.query(
      `INSERT INTO finance.contract_schedule (client_id, contract_id, updated_by, ${cols.join(", ")}) VALUES ($1,$2,$3,${cols.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
      [client.id, c.id, w.actorEmail, ...cols.map((x) => set[x])])).rows[0];
    await log(conn, req, { client, ...w, action: "contract_schedule_added", targetType: "contract_schedule", id: row.id, payload: { contract: c.id, ...set } });
    return { status: 201, body: { id: row.id } };
  })));

  // PATCH /contracts/:id/schedule/:itemId   body: its fields (status met needs evidence for a milestone)
  app.patch(`${BASE}/:id/schedule/:itemId`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    if (!k.isGuid(req.params.itemId)) return { status: 404, body: { error: "no such schedule line" } };
    const item = (await conn.query("SELECT * FROM finance.contract_schedule WHERE id = $1 AND contract_id = $2 AND client_id = $3 FOR UPDATE", [req.params.itemId, c.id, client.id])).rows[0];
    if (!item) return { status: 404, body: { error: "no such schedule line" } };
    const { set, issues } = k.scheduleInput(req.body || {}, { partial: true });
    issues.push(...k.scheduleIssues({ ...item, ...set }));
    if (issues.length) return { status: 422, body: { issues } };
    if (!Object.keys(set).length) return { status: 422, body: { issues: ["nothing to change"] } };
    const cols = Object.keys(set);
    await conn.query(
      `UPDATE finance.contract_schedule SET ${cols.map((x, i) => `${x} = $${i + 3}`).join(", ")}, updated_by = $${cols.length + 3}, updated_at = now() WHERE id = $1 AND client_id = $2`,
      [item.id, client.id, ...cols.map((x) => set[x]), w.actorEmail]);
    const before = Object.fromEntries(cols.map((x) => [x, item[x] instanceof Date ? k.day(item[x]) : item[x]]));
    await log(conn, req, { client, ...w, action: "contract_schedule_edited", targetType: "contract_schedule", id: item.id, payload: { contract: c.id, before, after: set } });
    return { status: 200, body: { id: item.id } };
  })));

  // POST /contracts/:id/movements   body: { kind: billed|released, on_date, amount, ref?, note? }
  app.post(`${BASE}/:id/movements`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    const { set, issues } = k.movementInput(req.body || {});
    if (!c.account_code) issues.push("set the balance sheet account this contract holds money on first");
    if (issues.length) return { status: 422, body: { issues } };
    if (set.kind === "released") {
      const live = (await conn.query("SELECT kind, on_date, amount, withdrawn_at FROM finance.contract_movements WHERE contract_id = $1 AND withdrawn_at IS NULL", [c.id])).rows;
      if (k.heldAt(live, null) < k.pence(set.amount)) return { status: 422, body: { issues: ["more would be released than the contract holds"] } };
    }
    const row = (await conn.query(
      "INSERT INTO finance.contract_movements (client_id, contract_id, kind, on_date, amount, ref, note, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [client.id, c.id, set.kind, set.on_date, set.amount, set.ref, set.note, w.actorEmail])).rows[0];
    await log(conn, req, { client, ...w, action: "contract_movement_added", targetType: "contract_movement", id: row.id, payload: { contract: c.id, ...set } });
    return { status: 201, body: { id: row.id } };
  })));

  // POST /contracts/:id/movements/:movementId/withdraw   a line keyed in error
  app.post(`${BASE}/:id/movements/:movementId/withdraw`, tolerant(async (req, res) => onContract(req, res, async (conn, w, { client, c }) => {
    if (!k.isGuid(req.params.movementId)) return { status: 404, body: { error: "no such line" } };
    const r = await conn.query(
      "UPDATE finance.contract_movements SET withdrawn_at = now(), withdrawn_by = $4 WHERE id = $1 AND contract_id = $2 AND client_id = $3 AND withdrawn_at IS NULL RETURNING kind, on_date, amount, ref",
      [req.params.movementId, c.id, client.id, w.actorEmail]);
    if (!r.rowCount) return { status: 404, body: { error: "no such line, or already withdrawn" } };
    await log(conn, req, { client, ...w, action: "contract_movement_withdrawn", targetType: "contract_movement", id: req.params.movementId, payload: { contract: c.id, ...r.rows[0] } });
    return { status: 200, body: { id: req.params.movementId } };
  })));

  // ── Uploads ───────────────────────────────────────────────────────────────

  // POST /contracts/uploads   raw PDF body, X-File-Name header
  app.post(`${BASE}/uploads`, rawBody, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let fileName;
    try { fileName = decodeURIComponent(String(req.get("X-File-Name") || "")).replace(/[\\/\u0000-\u001f]+/g, " ").trim().slice(0, 200); } catch { fileName = ""; }
    if (!fileName) return res.status(422).json({ issues: ["X-File-Name is required"] });
    if (!bytes.length) return res.status(422).json({ issues: [`${fileName} is empty`] });
    if (bytes.length > k.MAX_UPLOAD_BYTES) return res.status(413).json({ issues: [`${fileName} is over ${k.MAX_UPLOAD_BYTES / 1048576} MB`] });
    if (!k.isPdf(bytes)) return res.status(422).json({ issues: [`${fileName} is not a PDF: save or print the contract as a PDF and upload that`] });
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    send(res, await tx(client, who, async (conn, w) => {
      const had = (await conn.query(`SELECT ${UPLOAD_COLUMNS} FROM finance.contract_uploads WHERE client_id = $1 AND sha256 = $2`, [client.id, sha256])).rows[0];
      if (had) return { status: 200, body: { upload: uploadView(had), already: true } };
      const r = await conn.query(
        `INSERT INTO finance.contract_uploads (client_id, file_name, content_type, size_bytes, sha256, bytes, uploaded_by)
         VALUES ($1,$2,'application/pdf',$3,$4,$5,$6) RETURNING ${UPLOAD_COLUMNS}`,
        [client.id, fileName, bytes.length, sha256, bytes, w.actorEmail]);
      await log(conn, req, { client, ...w, action: "contract_uploaded", targetType: "contract_upload", id: r.rows[0].id, payload: { file_name: fileName, size_bytes: bytes.length, sha256 } });
      return { status: 201, body: { upload: uploadView(r.rows[0]), already: false } };
    }));
  }));

  // POST /contracts/uploads/:id/read   reads the PDF into proposed terms, then deletes it
  app.post(`${BASE}/uploads/:id/read`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!k.isGuid(req.params.id)) return res.status(404).json({ error: "no such upload" });
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
    if (!role) return res.status(403).json({ error: `${who.actorEmail} holds no engagement role for this client` });
    const claimed = (await pool.query(
      `UPDATE finance.contract_uploads SET read_state = 'reading', read_error = NULL, read_by = $3, read_at = now()
        WHERE id = $1 AND client_id = $2 AND bytes IS NOT NULL
          AND (read_state IN ('waiting', 'failed') OR (read_state = 'reading' AND read_at < now() - make_interval(mins => $4)))
        RETURNING id, file_name, bytes`, [req.params.id, client.id, who.actorEmail, STALE_READ_MINUTES])).rows[0];
    if (!claimed) {
      const u = (await pool.query(`SELECT ${UPLOAD_COLUMNS} FROM finance.contract_uploads WHERE id = $1 AND client_id = $2`, [req.params.id, client.id])).rows[0];
      if (!u) return res.status(404).json({ error: "no such upload" });
      return res.status(409).json({ error: u.read_state === "reading" ? "This file is being read now" : "This file has been read and its contents deleted", upload: uploadView(u) });
    }
    const entities = await entitiesOf(pool, client.id);
    let proposed, readWith;
    try {
      const answer = await generate(k.buildReadRequest({ bytes: claimed.bytes, fileName: claimed.file_name, entities, clientName: client.name }));
      readWith = `${answer.model ?? "model"} ${answer.location ?? ""}`.trim();
      proposed = k.parseRead(answer.text, entities);
    } catch (e) {
      const message = String(e.message || e).slice(0, 500);
      await pool.query("UPDATE finance.contract_uploads SET read_state = 'failed', read_error = $2 WHERE id = $1", [claimed.id, message]);
      return res.status(e.httpStatus === 502 ? 502 : 422).json({ error: `${claimed.file_name} could not be read: ${message}` });
    }
    send(res, await tx(client, who, async (conn, w) => {
      const u = (await conn.query(
        `UPDATE finance.contract_uploads SET read_state = 'read', read_error = NULL, read_with = $2, proposed = $3, read_at = now(),
                bytes = NULL, bytes_cleared_at = now()
          WHERE id = $1 RETURNING ${UPLOAD_COLUMNS}`, [claimed.id, readWith, JSON.stringify(proposed)])).rows[0];
      await log(conn, req, { client, ...w, action: "contract_read", targetType: "contract_upload", id: claimed.id, payload: { read_with: readWith, is_contract: proposed.is_contract, pattern: proposed.pattern, file_deleted: true } });
      return { status: 200, body: { upload: uploadView(u) } };
    }));
  }));

  // POST /contracts/uploads/:id/dismiss   not a contract, or not wanted
  app.post(`${BASE}/uploads/:id/dismiss`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!k.isGuid(req.params.id)) return res.status(404).json({ error: "no such upload" });
    send(res, await tx(client, who, async (conn, w) => {
      const r = await conn.query(
        `UPDATE finance.contract_uploads SET read_state = 'dismissed', bytes = NULL, bytes_cleared_at = COALESCE(bytes_cleared_at, now())
          WHERE id = $1 AND client_id = $2 AND read_state IN ('waiting', 'read', 'failed') RETURNING file_name`, [req.params.id, client.id]);
      if (!r.rowCount) return { status: 409, body: { error: "this upload cannot be dismissed now" } };
      await log(conn, req, { client, ...w, action: "contract_upload_dismissed", targetType: "contract_upload", id: req.params.id, payload: { file_name: r.rows[0].file_name } });
      return { status: 200, body: { id: req.params.id } };
    }));
  }));
}

module.exports = { mountContracts, REVENUE_PROCEDURE };
