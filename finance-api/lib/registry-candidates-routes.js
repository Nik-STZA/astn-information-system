// Registry candidates (migration 044): lib/registry-candidates.js decides, this
// applies.
//
// os.stza.io submits candidates and records decisions; the registry reviewer
// agent (lib/registry-reviewer.js, run by runner.js on the AfricanSTN client's
// agent queue) reads them, searches the registry and records a proposal.
//
// The agent never writes public.organizations. Only an approval made by a
// person in os.stza.io does, in one transaction with a research_log entry and
// an audit row, and the ASTN ID is worked out at that moment, under a lock, so
// two approvals cannot take the same number.
//
// Until migration 044 is applied the list answers with migration_missing and
// every other route with a 503, so finance-api can deploy ahead of it.

const rc = require("./registry-candidates");

const MISSING = "Registry candidates are waiting for migration 044 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGISTRY_CLIENT = "africanstn";
const AGENT = "registry-reviewer";
const OPEN = ["queued", "reviewing", "proposed", "failed"];

const CANDIDATE_COLUMNS = `id, submitted_name, submitted_website, submitted_country, submitted_sport,
  submitted_note, submitted_by, submitted_at, status, agent_run_id, verdict, verdict_reason,
  proposal, evidence, duplicates, reviewed_at, decided_by, decided_at, decision_note, organization_id`;

function instructionFor(c, note) {
  const lines = [
    `Review registry candidate ${c.id}: "${c.submitted_name}".`,
    "Read it with get_candidate, check it against the registry, research it, and record your proposal with record_proposal.",
  ];
  if (note) lines.push(`The reviewer asked you to look again: ${note}`);
  return lines.join("\n");
}

function mountRegistryCandidates(app, { route, pool, audit, startAgentRunner }) {
  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  function actor(req, res) {
    const email = (req.get("X-Actor-Email") || "").trim();
    if (!email) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    return email;
  }

  async function registryClient(conn) {
    const { rows } = await conn.query("SELECT id FROM shared.clients WHERE slug = $1", [REGISTRY_CLIENT]);
    if (!rows.length) throw new Error(`client ${REGISTRY_CLIENT} is not set up, so the reviewer cannot be queued`);
    return rows[0].id;
  }

  async function references() {
    const [countries, sports, levels, types] = await Promise.all([
      pool.query("SELECT iso_code, name FROM lookup_countries ORDER BY name"),
      pool.query("SELECT code, name FROM lookup_sports ORDER BY name"),
      pool.query("SELECT level AS v, count(*)::int AS n FROM organizations GROUP BY level ORDER BY n DESC"),
      pool.query("SELECT organization_type AS v, count(*)::int AS n FROM organizations GROUP BY organization_type ORDER BY n DESC"),
    ]);
    return {
      countries: countries.rows,
      sports: sports.rows,
      levels: levels.rows.map((r) => r.v),
      organization_types: types.rows.map((r) => r.v),
      verticals: rc.VERTICALS,
      operational_statuses: rc.OPERATIONAL_STATUSES,
      confidence_bands: rc.CONFIDENCE_BANDS,
    };
  }

  function refsMaps(refs) {
    return {
      countries: new Map(refs.countries.map((c) => [c.iso_code, c.name])),
      sports: new Map(refs.sports.map((s) => [s.code, s.name])),
    };
  }

  // Queues one reviewer run for a candidate and links them. The caller holds
  // the transaction; the runner is started after it commits.
  async function queueReview(conn, clientId, candidate, actorEmail, note) {
    const { rows } = await conn.query(
      `INSERT INTO finance.agent_runs (client_id, requested_by_email, requested_by_role, agent, instruction, status)
       VALUES ($1, $2, NULL, $3, $4, 'queued') RETURNING id`,
      [clientId, actorEmail, AGENT, instructionFor(candidate, note)]
    );
    await conn.query(
      `UPDATE registry_candidates SET agent_run_id = $2, status = 'queued' WHERE id = $1`,
      [candidate.id, rows[0].id]
    );
    return rows[0].id;
  }

  async function inTransaction(fn) {
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const out = await fn(conn);
      await conn.query("COMMIT");
      return out;
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  // ── For os.stza.io ────────────────────────────────────────────────────────

  app.get("/api/registry/reference", route(async (_req, res) => {
    res.json(await references());
  }));

  app.get("/api/registry/candidates", route(async (req, res) => {
    const done = req.query.view === "done";
    try {
      const { rows } = await pool.query(
        `SELECT ${CANDIDATE_COLUMNS},
                (SELECT astn_id FROM organizations o WHERE o.id = c.organization_id) AS astn_id
           FROM registry_candidates c
          WHERE status = ANY($1)
          ORDER BY ${done ? "decided_at DESC" : "submitted_at DESC"}
          LIMIT 100`,
        [done ? ["approved", "rejected", "duplicate"] : OPEN]
      );
      res.json({ count: rows.length, data: rows });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ count: 0, data: [], migration_missing: true });
    }
  }));

  app.post("/api/registry/candidates", tolerant(async (req, res) => {
    const email = actor(req, res);
    if (!email) return;
    const parsed = rc.parseBatch(req.body?.candidates);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const created = await inTransaction(async (conn) => {
      const clientId = await registryClient(conn);
      const out = [];
      for (const v of parsed.values) {
        const { rows } = await conn.query(
          `INSERT INTO registry_candidates
             (submitted_name, submitted_website, submitted_country, submitted_sport, submitted_note, submitted_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, submitted_name`,
          [v.name, v.website, v.country, v.sport, v.note, email]
        );
        const runId = await queueReview(conn, clientId, rows[0], email);
        out.push({ id: rows[0].id, name: rows[0].submitted_name, agent_run_id: runId });
      }
      await audit(conn, {
        actorEmail: email, action: "registry.candidates.submit", targetType: "registry_candidate",
        targetId: out[0].id, clientId, payload: { count: out.length, ids: out.map((c) => c.id) }, ip: req.ip,
      });
      return out;
    });
    const runner = await startAgentRunner(created[0].agent_run_id);
    res.status(201).json({ count: created.length, data: created, runner });
  }));

  app.post("/api/registry/candidates/:id/rerun", tolerant(async (req, res) => {
    const email = actor(req, res);
    if (!email) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const note = String(req.body?.note || "").trim().slice(0, 1000) || null;

    const out = await inTransaction(async (conn) => {
      const { rows } = await conn.query(
        "SELECT id, submitted_name, status FROM registry_candidates WHERE id = $1 FOR UPDATE", [req.params.id]
      );
      const c = rows[0];
      if (!c) return { status: 404, body: { error: "candidate not found" } };
      if (!["proposed", "failed"].includes(c.status)) {
        return { status: 409, body: { error: `a ${c.status} candidate cannot be sent back to the reviewer` } };
      }
      const clientId = await registryClient(conn);
      const runId = await queueReview(conn, clientId, c, email, note);
      await audit(conn, {
        actorEmail: email, action: "registry.candidate.rerun", targetType: "registry_candidate",
        targetId: c.id, clientId, payload: { note }, ip: req.ip,
      });
      return { status: 200, body: { id: c.id, agent_run_id: runId }, runId };
    });
    if (out.runId) out.body.runner = await startAgentRunner(out.runId);
    res.status(out.status).json(out.body);
  }));

  app.post("/api/registry/candidates/:id/reject", tolerant(async (req, res) => {
    const email = actor(req, res);
    if (!email) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const note = String(req.body?.note || "").trim().slice(0, 1000) || null;

    const out = await inTransaction(async (conn) => {
      const { rows } = await conn.query(
        `UPDATE registry_candidates
            SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
          WHERE id = $1 AND status = ANY($4)
          RETURNING id`,
        [req.params.id, email, note, OPEN]
      );
      if (!rows.length) return { status: 409, body: { error: "candidate not found, or already decided" } };
      await audit(conn, {
        actorEmail: email, action: "registry.candidate.reject", targetType: "registry_candidate",
        targetId: req.params.id, clientId: await registryClient(conn), payload: { note }, ip: req.ip,
      });
      return { status: 200, body: { id: rows[0].id, status: "rejected" } };
    });
    res.status(out.status).json(out.body);
  }));

  // Closes a candidate as already in the registry, linked to the row it
  // duplicates (migration 045). The row is one the reviewer named, unless the
  // person names another that exists.
  app.post("/api/registry/candidates/:id/confirm-duplicate", tolerant(async (req, res) => {
    const email = actor(req, res);
    if (!email) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const note = String(req.body?.note || "").trim().slice(0, 1000) || null;
    const wanted = req.body?.organizationId ? String(req.body.organizationId) : null;
    if (wanted && !UUID.test(wanted)) return res.status(400).json({ error: "not an organisation id" });

    const out = await inTransaction(async (conn) => {
      const { rows } = await conn.query(
        "SELECT id, status, duplicates FROM registry_candidates WHERE id = $1 FOR UPDATE", [req.params.id]
      );
      const c = rows[0];
      if (!c) return { status: 404, body: { error: "candidate not found" } };
      if (!OPEN.includes(c.status)) return { status: 409, body: { error: `this candidate is already ${c.status}` } };
      const named = (Array.isArray(c.duplicates) ? c.duplicates : []).map((d) => d.organization_id).filter(Boolean);
      const orgId = wanted ?? (named.length === 1 ? named[0] : null);
      if (!orgId) return { status: 400, body: { error: "say which registry record it duplicates" } };
      const org = await conn.query("SELECT id, astn_id, organization_name FROM organizations WHERE id = $1", [orgId]);
      if (!org.rows.length) return { status: 404, body: { error: "that registry record does not exist" } };

      await conn.query(
        `UPDATE registry_candidates
            SET status = 'duplicate', organization_id = $2, decided_by = $3, decided_at = now(), decision_note = $4
          WHERE id = $1`,
        [c.id, orgId, email, note]
      );
      await audit(conn, {
        actorEmail: email, action: "registry.candidate.duplicate", targetType: "registry_candidate",
        targetId: c.id, clientId: await registryClient(conn),
        payload: { organization_id: orgId, astn_id: org.rows[0].astn_id, note }, ip: req.ip,
      });
      return { status: 200, body: { id: c.id, status: "duplicate", organization_id: orgId, astn_id: org.rows[0].astn_id } };
    });
    res.status(out.status).json(out.body);
  }));

  // The one write to public.organizations. fields may correct any part of the
  // proposal; the result is checked again in full before it is written.
  app.post("/api/registry/candidates/:id/approve", tolerant(async (req, res) => {
    const email = actor(req, res);
    if (!email) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const fields = req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : {};
    const allowDuplicate = req.body?.allowDuplicate === true;

    const out = await inTransaction(async (conn) => {
      const { rows } = await conn.query(
        `SELECT ${CANDIDATE_COLUMNS} FROM registry_candidates WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      const c = rows[0];
      if (!c) return { status: 404, body: { error: "candidate not found" } };
      if (c.status !== "proposed") {
        return { status: 409, body: { error: `only a proposed candidate can be approved; this one is ${c.status}` } };
      }

      // Lookups through the pool: four reads at once on the transaction's own
      // connection would queue behind each other (and pg deprecates it).
      const refs = await references();
      const checked = rc.validateProposal({ ...(c.proposal || {}), ...fields }, refsMaps(refs));
      if (checked.errors) return { status: 400, body: { error: "the record is not complete", errors: checked.errors } };
      const v = checked.value;

      // The registry's own uniqueness rule, and the same website, checked here
      // as well as by the reviewer: the registry may have changed since.
      const clash = await conn.query(
        `SELECT id, astn_id, organization_name FROM organizations
          WHERE (country = $1 AND sport = $2 AND lower(organization_name) = lower($3))`,
        [v.country, v.sport, v.organization_name]
      );
      if (clash.rows.length) {
        const r = clash.rows[0];
        return { status: 409, body: { error: `${r.astn_id} ${r.organization_name} already has this name, country and sport` } };
      }
      const domain = rc.domainOf(v.organization_website);
      if (domain && !allowDuplicate) {
        const same = await conn.query(
          `SELECT id, astn_id, organization_name, organization_website FROM organizations
            WHERE organization_website ILIKE $1 LIMIT 20`,
          [`%${domain}%`]
        );
        const hit = same.rows.find((r) => rc.domainOf(r.organization_website) === domain);
        if (hit) {
          return {
            status: 409,
            body: { error: `${hit.astn_id} ${hit.organization_name} has the same website. Approve again to add it anyway.`, duplicate: hit, can_override: true },
          };
        }
      }

      await conn.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`astn_id:${v.country_iso}-${v.sport_code}`]);
      const seq = await conn.query(
        `SELECT max(CAST(split_part(astn_id, '-', 3) AS integer)) AS n FROM organizations
          WHERE astn_id LIKE $1 AND split_part(astn_id, '-', 3) ~ '^[0-9]+$'`,
        [`${v.country_iso}-${v.sport_code}-%`]
      );
      const astnId = rc.nextAstnId(v.country_iso, v.sport_code, seq.rows[0].n);
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const notes = rc.approvalNote(v.notes, { candidateId: c.id, date: now });
      const status = { dormant: "Dormant", ceased: "Inactive", unknown: "Unverified", unclear: "Unverified" }[v.operational_status] || "Active";

      const org = await conn.query(
        `INSERT INTO organizations
           (id, astn_id, organization_name, country, country_iso, sport, sport_code, level, organization_type,
            region_province, organization_website, status, notes, tags, astn_vertical, astn_sub_vertical,
            source_confidence, verification_source, verification_date, founded_year, operational_status,
            business_model, last_research_date, research_depth, last_website_check)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'National'), COALESCE($10,''), $11, $12,
                 COALESCE($13,''), $14,$15,$16,$17,$18,$19,$20,$21, CURRENT_DATE, 'moderate',
                 CASE WHEN $10::text IS NULL THEN NULL ELSE CURRENT_DATE END)
         RETURNING id, astn_id`,
        [
          astnId, v.organization_name, v.country, v.country_iso, v.sport, v.sport_code, v.level, v.organization_type,
          v.region_province, v.organization_website, status, notes, v.tags, v.astn_vertical, v.astn_sub_vertical,
          v.source_confidence, v.verification_source, today, v.founded_year ?? null, v.operational_status,
          v.business_model,
        ]
      );
      const organization = org.rows[0];

      const band = rc.bandOf(v.source_confidence);
      const evidence = Array.isArray(c.evidence) ? c.evidence : [];
      await conn.query(
        `INSERT INTO research_log
           (organization_id, astn_id, researcher, research_type, sources_checked, findings_summary,
            status_changed, new_status, data_updated, confidence, session_reference)
         VALUES ($1,$2,'agent_registry_reviewer','deep_dive',$3,$4,true,$5,$6,$7,$8)`,
        [
          organization.id, organization.astn_id,
          [...new Set(evidence.map((e) => rc.domainOf(e.url)).filter(Boolean))],
          c.verdict_reason, v.operational_status,
          JSON.stringify({ created: true, from_candidate: c.id, corrected_fields: Object.keys(fields) }),
          band === "High" || band === "Medium-High" ? "high" : band === "Medium" ? "medium" : "low",
          c.agent_run_id,
        ]
      );

      await conn.query(
        `UPDATE registry_candidates
            SET status = 'approved', decided_by = $2, decided_at = now(), organization_id = $3,
                decision_note = $4
          WHERE id = $1`,
        [c.id, email, organization.id, String(req.body?.note || "").trim().slice(0, 1000) || null]
      );
      await audit(conn, {
        actorEmail: email, action: "registry.candidate.approve", targetType: "registry_candidate",
        targetId: c.id, clientId: await registryClient(conn),
        payload: { organization_id: organization.id, astn_id: organization.astn_id, corrected_fields: Object.keys(fields), allow_duplicate: allowDuplicate },
        ip: req.ip,
      });
      return { status: 201, body: { id: c.id, status: "approved", organization_id: organization.id, astn_id: organization.astn_id } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── For the registry reviewer agent ───────────────────────────────────────

  // The candidate a run was queued for. Reading it marks it under review.
  app.get("/api/registry/runs/:runId/candidate", tolerant(async (req, res) => {
    if (!UUID.test(req.params.runId)) return res.status(400).json({ error: "not a run id" });
    const { rows } = await pool.query(
      `UPDATE registry_candidates SET status = CASE WHEN status = 'queued' THEN 'reviewing' ELSE status END
        WHERE agent_run_id = $1
        RETURNING ${CANDIDATE_COLUMNS}`,
      [req.params.runId]
    );
    if (!rows.length) return res.status(404).json({ error: "no candidate is waiting on this run" });
    res.json(rows[0]);
  }));

  // Possible duplicates: the same website, or names sharing a meaningful word.
  app.get("/api/registry/search", route(async (req, res) => {
    const name = String(req.query.name || "").trim();
    const website = String(req.query.website || "").trim();
    if (!name && !website) return res.status(400).json({ error: "name or website is required" });
    const target = { name, website };
    const where = [];
    const params = [];
    const domain = rc.domainOf(website);
    if (domain) { params.push(`%${domain}%`); where.push(`organization_website ILIKE $${params.length}`); }
    for (const t of rc.searchTerms(name)) { params.push(`%${t}%`); where.push(`organization_name ILIKE $${params.length}`); }
    if (name) { params.push(name); where.push(`lower(organization_name) = lower($${params.length})`); }
    if (!where.length) return res.status(400).json({ error: "that website is not a web address; search by name" });
    const { rows } = await pool.query(
      `SELECT id, astn_id, organization_name, country, sport, organization_type, organization_website
         FROM organizations WHERE ${where.join(" OR ")} LIMIT 300`,
      params
    );
    const matches = rc.rankMatches(target, rows, { min: Number(req.query.min) || 0.5 });
    res.json({ searched: rows.length, matches });
  }));

  app.post("/api/registry/candidates/:id/proposal", tolerant(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const { runId, verdict, verdict_reason: reason, proposal, evidence, duplicates } = req.body || {};
    const bad = rc.validateVerdict(verdict, reason);
    if (bad) return res.status(400).json({ error: bad });

    let cleaned = null;
    if (verdict === "add" || proposal) {
      if (!proposal) return res.status(400).json({ error: "an add verdict needs the proposed record" });
      const checked = rc.validateProposal(proposal, refsMaps(await references()));
      if (checked.errors) return res.status(400).json({ error: "the proposed record is not complete", errors: checked.errors });
      cleaned = checked.value;
    }
    const ev = rc.cleanEvidence(evidence);
    if (verdict === "add" && !ev.length) return res.status(400).json({ error: "an add verdict needs at least one piece of evidence: a web address and what it showed" });
    const dups = Array.isArray(duplicates) ? duplicates.slice(0, 10) : [];
    if (verdict === "duplicate" && !dups.length) return res.status(400).json({ error: "a duplicate verdict needs the registry rows it duplicates" });

    // Only the run the candidate is waiting on may write it: a run started
    // before a re-run must not overwrite the newer one.
    const { rows } = await pool.query(
      `UPDATE registry_candidates
          SET status = 'proposed', verdict = $3, verdict_reason = $4, proposal = $5,
              evidence = $6, duplicates = $7, reviewed_at = now()
        WHERE id = $1 AND agent_run_id = $2 AND status IN ('queued', 'reviewing', 'failed')
        RETURNING id, status`,
      [req.params.id, runId, verdict, String(reason).trim().slice(0, 2000),
        cleaned ? JSON.stringify(cleaned) : null, JSON.stringify(ev), JSON.stringify(dups)]
    );
    if (!rows.length) return res.status(409).json({ error: "this candidate is not waiting on this run (already decided, or re-run since)" });
    res.json({ saved: true, ...rows[0] });
  }));

  app.post("/api/registry/candidates/:id/review-failed", tolerant(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "not a candidate id" });
    const { rows } = await pool.query(
      `UPDATE registry_candidates SET status = 'failed', verdict_reason = $3, reviewed_at = now()
        WHERE id = $1 AND agent_run_id = $2 AND status IN ('queued', 'reviewing')
        RETURNING id, status`,
      [req.params.id, req.body?.runId, String(req.body?.error || "The reviewer finished without a proposal.").slice(0, 1000)]
    );
    res.json({ marked: rows.length > 0 });
  }));
}

module.exports = { mountRegistryCandidates, instructionFor, AGENT, REGISTRY_CLIENT };
