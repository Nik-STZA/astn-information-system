// The pack commentary routes (migration 063). lib/pack-commentary.js decides;
// this reads, applies and audits.
//
//   GET  /commentary?period=YYYY-MM           the month: sections to edit, figures, notes, versions
//   GET  /commentary/:period/files            the approved month as the pack build reads it (the pack job)
//   POST /commentary/import                   { period, kind, content, note? }   a whole file, as a draft
//   POST /commentary/edit                     { period, version, edits: [{ path, text }], note? }
//   POST /commentary/approve                  { period }   CFO, a person
//
// A person, or the FP&A agent or the FC from a run, drafts. Only a person with
// the CFO role approves. Nothing here reaches Xero or the drive.

const pc = require("./pack-commentary");
const recs = require("./recs");
const work = require("./work");

const MISSING = "Pack commentary is waiting for migration 063 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const DRAFTERS = ["fpa", "fc"];

function mountPackCommentary(app, { route, pool, audit, clientIdFromSlug, viaInput = work.viaInput }) {
  const BASE = "/api/finance/clients/:slug/commentary";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  function caller(req, res, { peopleOnly = false } = {}) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    const via = origin.via;
    if (via && (peopleOnly || via.kind !== "agent" || !DRAFTERS.includes(via.agent))) {
      res.status(403).json({ error: peopleOnly ? "Only a person approves the commentary, in os.stza.io" : "The commentary is drafted by a person, or by FP&A or the FC from a run" });
      return null;
    }
    return { actorEmail, via, actor: via ? `agent:${via.agent}` : actorEmail };
  }

  async function tx(client, who, fn) {
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const role = (await conn.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
      if (!role) { await conn.query("ROLLBACK"); return { status: 403, body: { error: `${who.actorEmail} holds no engagement role for this client` } }; }
      if (who.via) {
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

  const auditIt = (db, req, { client, actorEmail, role, action, id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType: "pack_commentary", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const rowsOf = async (db, clientId, period, lock = false) => (await db.query(
    `SELECT * FROM finance.pack_commentary WHERE client_id = $1 AND period = $2 ORDER BY kind ${lock ? "FOR UPDATE" : ""}`, [clientId, period])).rows;
  const keep = (db, row, { action, changed = [], note = null, by, runId = null }) => db.query(
    `INSERT INTO finance.pack_commentary_versions (commentary_id, version, content, status, action, changed_paths, note, saved_by, run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id, row.version, JSON.stringify(row.content), row.status, action, changed, note, by, runId]);

  // GET /commentary?period=YYYY-MM
  app.get(BASE, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = String(req.query.period ?? "");
    if (!recs.isPeriod(period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const rows = await rowsOf(pool, client.id, period);
    const versions = rows.length ? (await pool.query(
      `SELECT v.commentary_id, c.kind, v.version, v.status, v.action, v.changed_paths, v.note, v.saved_by, v.saved_at
         FROM finance.pack_commentary_versions v JOIN finance.pack_commentary c ON c.id = v.commentary_id
        WHERE v.commentary_id = ANY($1::uuid[]) ORDER BY v.saved_at DESC LIMIT 50`, [rows.map((r) => r.id)])).rows : [];
    const h = rows.find((r) => r.kind === "highlights");
    const d = rows.find((r) => r.kind === "dashboard");
    const part = (r) => (r ? { status: r.status, version: r.version, updated_by: r.updated_by, updated_at: r.updated_at, approved_by: r.approved_by, approved_at: r.approved_at } : null);
    res.json({
      period, label: recs.periodLabel(period),
      highlights: h ? { ...part(h), sections: pc.sections(h.content), notes: pc.styleNotes(h.content), content: pc.normalise(h.content) } : null,
      dashboard: d ? { ...part(d), content: d.content } : null,
      pack: pc.readyForPack(rows),
      versions,
    });
  }));

  // GET /commentary/:period/files   the approved month, for the pack build.
  app.get(`${BASE}/:period/files`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!recs.isPeriod(req.params.period)) return res.status(400).json({ error: "period must be a month (YYYY-MM)" });
    const rows = await rowsOf(pool, client.id, req.params.period);
    const ready = pc.readyForPack(rows);
    if (!ready.ready) return res.status(404).json({ error: ready.why, ready: false });
    const of = (kind) => rows.find((r) => r.kind === kind);
    res.json({
      period: req.params.period, ready: true,
      highlights: pc.normalise(of("highlights").content), highlights_version: of("highlights").version,
      dashboard: of("dashboard")?.content ?? null, dashboard_version: of("dashboard")?.version ?? null,
    });
  }));

  // POST /commentary/import   { period, kind, content, note? }
  app.post(`${BASE}/import`, tolerant(async (req, res) => {
    const who = caller(req, res);
    if (!who) return;
    const b = req.body || {};
    if (!recs.isPeriod(b.period)) return res.status(422).json({ issues: ["period must be a month (YYYY-MM)"] });
    if (b.kind === "highlights") b.content = pc.normalise(b.content);
    const issues = pc.contentIssues(b.kind, b.content);
    if (issues.length) return res.status(422).json({ issues });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role, actor, via }) => {
      const cur = (await rowsOf(conn, client.id, b.period, true)).find((r) => r.kind === b.kind);
      const row = cur
        ? (await conn.query(
          `UPDATE finance.pack_commentary SET content = $2, status = 'draft', version = version + 1, updated_by = $3, updated_at = now(),
                  approved_by = NULL, approved_at = NULL WHERE id = $1 RETURNING *`, [cur.id, JSON.stringify(b.content), actor])).rows[0]
        : (await conn.query(
          `INSERT INTO finance.pack_commentary (client_id, period, kind, content, updated_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [client.id, b.period, b.kind, JSON.stringify(b.content), actor])).rows[0];
      await keep(conn, row, { action: "imported", note: String(b.note ?? "").trim().slice(0, 1000) || null, by: actor, runId: via?.run_id ?? null });
      await auditIt(conn, req, { client, actorEmail, role, action: "pack_commentary_imported", id: row.id, payload: { period: b.period, kind: b.kind, version: row.version, via: via ? `${via.agent}:${via.run_id}` : null } });
      return { status: cur ? 200 : 201, body: { kind: b.kind, version: row.version, status: row.status, was_approved: cur?.status === "approved" } };
    });
    res.status(out.status).json(out.body);
  }));

  // POST /commentary/edit   { period, version, edits, note? }   the text fields only
  app.post(`${BASE}/edit`, tolerant(async (req, res) => {
    const who = caller(req, res);
    if (!who) return;
    const b = req.body || {};
    if (!recs.isPeriod(b.period)) return res.status(422).json({ issues: ["period must be a month (YYYY-MM)"] });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role, actor, via }) => {
      const cur = (await rowsOf(conn, client.id, b.period, true)).find((r) => r.kind === "highlights");
      if (!cur) return { status: 404, body: { error: "There is no commentary for this month yet. Load the month's highlights file first." } };
      if (b.version !== undefined && Number(b.version) !== cur.version) {
        return { status: 409, body: { error: `The commentary was saved since you opened it (now version ${cur.version}). Open it again to see the change, then edit.`, version: cur.version } };
      }
      const plan = pc.applyEdits(cur.content, b.edits);
      if (plan.issues.length) return { status: 422, body: { issues: plan.issues } };
      if (!plan.changed.length) return { status: 200, body: { version: cur.version, status: cur.status, changed: [] } };
      const row = (await conn.query(
        `UPDATE finance.pack_commentary SET content = $2, status = 'draft', version = version + 1, updated_by = $3, updated_at = now(),
                approved_by = NULL, approved_at = NULL WHERE id = $1 RETURNING *`, [cur.id, JSON.stringify(plan.content), actor])).rows[0];
      await keep(conn, row, { action: "edited", changed: plan.changed, note: String(b.note ?? "").trim().slice(0, 1000) || null, by: actor, runId: via?.run_id ?? null });
      await auditIt(conn, req, { client, actorEmail, role, action: "pack_commentary_edited", id: row.id, payload: { period: b.period, version: row.version, changed: plan.changed, was_approved: cur.status === "approved" } });
      return { status: 200, body: { version: row.version, status: row.status, changed: plan.changed, was_approved: cur.status === "approved", notes: pc.styleNotes(row.content) } };
    });
    res.status(out.status).json(out.body);
  }));

  // POST /commentary/approve   { period }   the CFO, in os.stza.io
  app.post(`${BASE}/approve`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true });
    if (!who) return;
    const period = String(req.body?.period ?? "");
    if (!recs.isPeriod(period)) return res.status(422).json({ issues: ["period must be a month (YYYY-MM)"] });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO approves the commentary" } };
      const rows = await rowsOf(conn, client.id, period, true);
      if (!rows.some((r) => r.kind === "highlights")) return { status: 409, body: { error: "There is no commentary for this month to approve." } };
      for (const r of rows.filter((x) => x.status !== "approved")) {
        const row = (await conn.query(
          "UPDATE finance.pack_commentary SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1 RETURNING *", [r.id, actorEmail])).rows[0];
        await keep(conn, row, { action: "approved", by: actorEmail });
      }
      await auditIt(conn, req, { client, actorEmail, role, action: "pack_commentary_approved", id: rows.find((r) => r.kind === "highlights").id, payload: { period, versions: rows.map((r) => ({ kind: r.kind, version: r.version })) } });
      return { status: 200, body: { approved: rows.map((r) => ({ kind: r.kind, version: r.version })) } };
    });
    res.status(out.status).json(out.body);
  }));
}

module.exports = { mountPackCommentary };
