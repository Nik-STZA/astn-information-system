// Threads and people (migration 050), mounted by server.js.
//
//   GET  /api/finance/people                          everyone's initials and names, for the audit trail
//   PUT  /api/finance/people/me                       a person sets their own name, initials and title
//   GET  /api/finance/clients/:slug/threads           entries, filtered by
//          s=<subject_kind>|<subject_key> (repeatable, up to 200), period=YYYY-MM, open=true
//   POST /api/finance/clients/:slug/threads           a new entry or a reply
//
// A person needs an engagement role on the client to write; an agent writes as
// the person who asked it (X-Actor-Email) and names itself in X-Work-Via, as in
// Work. Entries are never edited or deleted (the database refuses both).

const t = require("./threads");

const MISSING = "Threads are waiting for migration 050 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";

function mountThreads(app, { route, pool, audit, clientIdFromSlug, viaInput }) {
  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  const people = async () => new Map((await pool.query("SELECT email, kind, display_name, initials, title FROM finance.people")).rows.map((p) => [p.email, p]));

  app.get("/api/finance/people", tolerant(async (_req, res) => {
    res.json({ people: [...(await people()).values()] });
  }));

  app.put("/api/finance/people/me", tolerant(async (req, res) => {
    const email = String(req.get("X-Actor-Email") || "").trim().toLowerCase();
    if (!email.includes("@")) return res.status(400).json({ error: "X-Actor-Email is required" });
    if (req.get("X-Work-Via")) return res.status(403).json({ error: "a person sets their own profile, in os.stza.io" });
    if (email.endsWith("@agents.stza.io")) return res.status(403).json({ error: "agents' profiles are set by migration" });
    const { issues, profile } = t.profileInput(req.body || {});
    if (issues.length) return res.status(422).json({ issues });
    const row = (await pool.query(
      `INSERT INTO finance.people (email, kind, display_name, initials, title) VALUES ($1, 'person', $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, initials = EXCLUDED.initials, title = EXCLUDED.title, updated_at = now()
       RETURNING email, kind, display_name, initials, title`, [email, profile.display_name, profile.initials, profile.title])).rows[0];
    res.json({ person: row });
  }));

  app.get("/api/finance/clients/:slug/threads", tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const raw = [].concat(req.query.s ?? []).map(String);
    if (raw.length > 200) return res.status(422).json({ issues: ["ask for at most 200 subjects at once"] });
    const subjects = [];
    for (const s of raw) {
      const [kind, ...rest] = s.split("|");
      const key = rest.join("|");
      const issue = t.subjectIssue(kind, key);
      if (issue) return res.status(422).json({ issues: [`${s}: ${issue}`] });
      subjects.push([kind, key]);
    }
    const period = req.query.period ? String(req.query.period) : null;
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(422).json({ issues: ["period must be YYYY-MM"] });
    const where = ["client_id = $1"];
    const args = [client.id];
    if (subjects.length) {
      args.push(subjects.map((s) => s[0]), subjects.map((s) => s[1]));
      where.push(`(subject_kind, subject_key) IN (SELECT * FROM unnest($${args.length - 1}::text[], $${args.length}::text[]))`);
    }
    // A month's view: entries of that period, plus entries with no period
    // (an asset's or a cost line's thread runs across months).
    if (period) { args.push(period); where.push(`(period = $${args.length} OR period IS NULL)`); }
    const rows = (await pool.query(
      `SELECT id, subject_kind, subject_key, period, parent_id, kind, needs_decision, body, author_email, actor_role, via_agent, via_run_id, created_at
         FROM finance.thread_entries WHERE ${where.join(" AND ")} ORDER BY created_at`, args)).rows;
    let shaped = t.shape(rows, await people());
    if (req.query.open === "true") shaped = shaped.filter((e) => e.open);
    res.json({ threads: shaped, open: shaped.filter((e) => e.open).length });
  }));

  app.post("/api/finance/clients/:slug/threads", tolerant(async (req, res) => {
    const actorEmail = String(req.get("X-Actor-Email") || "").trim().toLowerCase();
    if (!actorEmail) return res.status(400).json({ error: "X-Actor-Email is required" });
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) return res.status(400).json({ issues: origin.issues });
    const via = origin.via?.kind === "agent" ? origin.via : null;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const { issues, entry } = t.entryInput(req.body || {}, via);
    if (issues.length) return res.status(422).json({ issues });
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
    if (!role) return res.status(403).json({ error: "only someone with a role on this client writes in its threads" });
    if (entry.parent_id) {
      const parent = (await pool.query("SELECT id, client_id, subject_kind, subject_key FROM finance.thread_entries WHERE id = $1", [entry.parent_id])).rows[0];
      if (!parent || parent.client_id !== client.id) return res.status(422).json({ issues: ["the entry being answered is not in this client's threads"] });
      if (parent.subject_kind !== entry.subject_kind || parent.subject_key !== entry.subject_key) return res.status(422).json({ issues: ["a reply belongs to the same thread as the entry it answers"] });
    }
    const row = (await pool.query(
      `INSERT INTO finance.thread_entries (client_id, subject_kind, subject_key, period, parent_id, kind, needs_decision, body, author_email, actor_role, via_agent, via_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, created_at`,
      [client.id, entry.subject_kind, entry.subject_key, entry.period, entry.parent_id, entry.kind, entry.needs_decision, entry.body,
        actorEmail, role, via?.agent ?? null, via?.run_id ?? null])).rows[0];
    await audit(pool, { actorEmail, actorRole: role, action: "thread_entry_added", targetType: "thread_entry", targetId: row.id, clientId: client.id,
      payload: { subject_kind: entry.subject_kind, subject_key: entry.subject_key, period: entry.period, kind: entry.kind, parent_id: entry.parent_id,
        needs_decision: entry.needs_decision, via_agent: via?.agent ?? null }, ip: req.get("X-Forwarded-For") || req.ip });
    res.status(201).json({ id: row.id, created_at: row.created_at });
  }));
}

module.exports = { mountThreads };
