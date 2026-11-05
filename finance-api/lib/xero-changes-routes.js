// The Xero changes routes: lib/xero-changes.js decides, this applies, in
// finance.xero_changes (migration 039).
//
// An agent (FM1 or the FC, from a live run) or a person proposes a change. Only
// a person with the CFO role approves, in os.stza.io. finance-api then makes it
// through the change's own gated write route, the one Cowork calls: a dry run
// for the confirmation code, then the write with that code, under a key made of
// the change's id and attempt. So the tier switch, the validation, the
// confirmation and the audit row are the same whichever way a write comes in.
//
// Until migration 039 is applied the list answers migration_missing and every
// other route a 503, so finance-api can deploy ahead of it.

const changes = require("./xero-changes");
const recs = require("./recs");
const work = require("./work");

const MISSING = "Xero changes are waiting for migration 039 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
// An approval with no outcome recorded after this long did not finish cleanly.
const IN_FLIGHT_MINUTES = 5;

function mountXeroChanges(app, { route, pool, audit, clientIdFromSlug, readAssetRegister, runGatedWrite, writePolicy, viaInput = work.viaInput }) {
  const BASE = "/api/finance/clients/:slug/xero-changes";

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
    if (peopleOnly && origin.via) { res.status(403).json({ error: "only a person can do this, in os.stza.io" }); return null; }
    return { actorEmail, via: origin.via, actor: recs.actorOf(actorEmail, origin.via) };
  }

  // A short transaction with the actor's role; never spans a call to Xero.
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

  const auditChange = (db, req, { client, actorEmail, role, action, id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType: "xero_change", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const view = (c) => ({
    id: c.id, kind: c.kind, label: changes.KINDS[c.kind]?.label ?? c.kind, entity_id: c.entity_id, entity_slug: c.entity_slug, entity_name: c.entity_name,
    summary: c.summary, reason: c.reason, source_doc: c.source_doc, input: c.input,
    source: c.source, proposed_by: c.proposed_by, state: c.state,
    approved_by: c.approved_by, approved_at: c.approved_at, rejected_by: c.rejected_by, rejected_at: c.rejected_at,
    attempt_outcome: c.attempt_outcome, in_flight: inFlight(c), last_error: c.last_error,
    xero_id: c.xero_id, written_at: c.written_at, after: c.state === "written" ? changes.KINDS[c.kind]?.after ?? null : null,
    created_at: c.created_at, updated_at: c.updated_at,
  });

  // Approved, nothing recorded yet, and recent: the write is happening now.
  function inFlight(c, now = Date.now()) {
    return c.state === "approved" && !c.attempt_outcome && now - new Date(c.updated_at).getTime() < IN_FLIGHT_MINUTES * 60000;
  }

  const SELECT = `SELECT c.*, e.slug AS entity_slug, e.name AS entity_name
                    FROM finance.xero_changes c JOIN finance.entities e ON e.id = c.entity_id`;

  // ── The list ────────────────────────────────────────────────────────────────

  // GET /xero-changes?state=open|all   open: waiting or not finished
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const all = req.query.state === "all";
    let rows;
    try {
      rows = (await pool.query(
        `${SELECT} WHERE c.client_id = $1 ${all ? "" : "AND (c.state IN ('proposed', 'approved') OR c.updated_at > now() - interval '14 days')"}
          ORDER BY c.created_at DESC LIMIT 200`, [client.id])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return res.json({ migration_missing: true, changes: [], counts: { waiting: 0 } });
    }
    const list = rows.map((r) => view(r));
    res.json({ changes: list, counts: { waiting: list.filter((c) => c.state === "proposed" || (c.state === "approved" && !c.in_flight)).length } });
  }));

  // ── Proposing ───────────────────────────────────────────────────────────────

  // POST /xero-changes   body: { kind, entity, reason, ...the kind's fields }
  app.post(BASE, tolerant(async (req, res) => {
    const who = caller(req, res);
    if (!who) return;
    const body = req.body || {};
    const kind = changes.KINDS[body.kind];
    if (!changes.isKind(body.kind)) return res.status(422).json({ issues: [`kind must be one of ${Object.keys(changes.KINDS).join(", ")}`] });
    const { via } = who;
    if (via && !(via.kind === "agent" && kind.proposers.includes(via.agent))) {
      return res.status(403).json({ error: `A ${kind.label.toLowerCase()} is proposed by a person here, or by ${kind.proposers.map((a) => a.toUpperCase()).join(" or ")} from a run` });
    }
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const entity = (await pool.query(
      "SELECT id, slug, name, accounting_system_config FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL",
      [client.id, String(body.entity ?? "")])).rows[0];
    if (!entity) return res.status(422).json({ issues: [`no company ${body.entity} for this client`] });

    // Checked against Xero as it is now, before a pooled connection is held.
    const register = await readAssetRegister(req.params.slug, entity.slug);
    if (register.unavailable) return res.status(503).json({ error: `Xero could not be read for ${entity.name}, so the proposal could not be checked: ${register.error ?? "try again shortly"}` });
    const p = kind.propose(body, register);
    if (p.issues.length) return res.status(422).json({ issues: p.issues });
    const warnings = [...p.warnings];
    const tier = changes.tierWarning(body.kind, writePolicy(entity.accounting_system_config), entity.name);
    if (tier) warnings.push(tier);

    const out = await tx(client, who, async (conn, { actor, actorEmail, role }) => {
      if (via) {
        const run = (await conn.query("SELECT agent, status FROM finance.agent_runs WHERE id = $1 AND client_id = $2", [via.run_id, client.id])).rows[0];
        if (!run || run.agent !== via.agent || !["queued", "running"].includes(run.status)) {
          return { status: 403, body: { error: "That run is not a live run of this agent for this client" } };
        }
      }
      // The same change twice is one change. Locked, so two at once cannot both pass.
      const open = (await conn.query(
        `SELECT id, summary, state, input FROM finance.xero_changes
          WHERE client_id = $1 AND entity_id = $2 AND kind = $3 AND state IN ('proposed', 'approved', 'written') FOR UPDATE`,
        [client.id, entity.id, body.kind])).rows;
      const same = open.find((c) => c.input?.record?.purchaseDate === p.input.record.purchaseDate
        && Math.round(Number(c.input?.record?.purchasePrice) * 100) === Math.round(Number(p.input.record.purchasePrice) * 100))
        ?? open.find((c) => c.input?.record?.assetNumber === p.input.record.assetNumber && c.state !== "written");
      if (same && body.allow_duplicate !== true) {
        const where = { proposed: "waiting for the CFO", approved: "approved and going to Xero", written: "already made in Xero" }[same.state];
        return { status: 409, body: { error: `The same change is ${where}: ${same.summary}.`, id: same.id } };
      }
      const row = (await conn.query(
        `INSERT INTO finance.xero_changes (client_id, entity_id, kind, input, summary, reason, source_doc, source, proposed_by, proposed_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [client.id, entity.id, body.kind, JSON.stringify(p.input), p.summary, String(body.reason).trim(),
          body.source_doc ? String(body.source_doc) : null, via ? "agent" : "person", actor, via?.run_id ?? null])).rows[0];
      await auditChange(conn, req, {
        client, actorEmail, role, action: "xero_change_proposed", id: row.id,
        payload: { kind: body.kind, via: via ? `${via.agent}:${via.run_id}` : null, entity: entity.slug, summary: p.summary, input: p.input },
      });
      return { status: 201, body: { id: row.id, summary: p.summary, input: p.input, warnings } };
    });
    res.status(out.status).json(out.body);
  }));

  // ── The CFO's decision ──────────────────────────────────────────────────────

  // POST /xero-changes/:id/approve   body: { confirmed_not_in_xero, confirmed_in_xero }
  // The CFO approves exactly the stored input, and finance-api makes it in Xero.
  app.post(`${BASE}/:id/approve`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true });
    if (!who) return;
    if (!changes.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a change id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });

    let c;
    const decided = await tx(client, who, async (conn, { actorEmail, role }) => {
      if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO approves a change to Xero" } };
      c = (await conn.query(`${SELECT} WHERE c.id = $1 AND c.client_id = $2 FOR UPDATE OF c`, [req.params.id, client.id])).rows[0];
      if (!c) return { status: 404, body: { error: "change not found" } };
      if (!changes.isKind(c.kind)) return { status: 409, body: { error: `${c.kind} cannot be made from here yet` } };
      if (c.state === "written") return { status: 409, body: { error: "This change is already made in Xero." } };
      if (c.state === "rejected") return { status: 409, body: { error: "This change was rejected" } };
      let attempts = c.attempts;
      if (c.state === "approved") {
        if (inFlight(c)) return { status: 409, body: { error: "This change is being made in Xero now." } };
        // The CFO looked and it is there: record it, write nothing.
        if (req.body?.confirmed_in_xero === true) {
          await conn.query(
            `UPDATE finance.xero_changes SET state = 'written', result = $2, written_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
            [c.id, JSON.stringify({ recorded_by: actorEmail, seen_in_xero: true })]);
          await auditChange(conn, req, { client, actorEmail, role, action: "xero_change_seen_in_xero", id: c.id, payload: { kind: c.kind, summary: c.summary } });
          return { status: 200, body: { recorded: true } };
        }
        if (req.body?.confirmed_not_in_xero !== true) {
          return { status: 409, body: { error: "The last attempt did not finish cleanly, so this may already be in Xero. Check Xero. If it is not there, say so and try again." } };
        }
        attempts += 1;
      } else if (c.attempt_outcome === "refused") {
        attempts += 1;
      }
      await conn.query(
        `UPDATE finance.xero_changes SET state = 'approved', approved_by = $2, approved_at = now(), attempts = $3,
                attempt_outcome = NULL, updated_at = now() WHERE id = $1`, [c.id, actorEmail, attempts]);
      c.attempts = attempts;
      await auditChange(conn, req, {
        client, actorEmail, role, action: "xero_change_approved", id: c.id,
        payload: { kind: c.kind, entity: c.entity_slug, summary: c.summary, attempts, key: changes.changeKey(c) },
      });
      return { status: 200, body: {}, go: true };
    });
    if (!decided.go) return res.status(decided.status).json(decided.body);

    // The write, after the decision is committed: a dry run for the code, then
    // the write with it. Both as the CFO, through the change's own route.
    const kind = changes.KINDS[c.kind];
    const call = (extra) => runGatedWrite(c.kind, {
      slug: req.params.slug, entitySlug: c.entity_slug, actorEmail: who.actorEmail, ip: req.get("X-Forwarded-For") || req.ip,
      input: { ...c.input, idempotency_key: changes.changeKey(c), ...extra },
    });
    let answer = await call({ dry_run: true });
    if (answer.status === 200 && answer.body?.confirmation_code) {
      answer = await call({ dry_run: false, confirmation_code: answer.body.confirmation_code });
    } else if (answer.status < 400) {
      answer = { status: 422, body: { issues: ["The dry run gave no confirmation code, so nothing was sent to Xero."] } };
    }
    const outcome = changes.outcomeOf(answer);
    if (outcome === "written") {
      const madeId = kind.madeId(answer.body);
      await pool.query(
        `UPDATE finance.xero_changes SET state = 'written', xero_id = $2, result = $3, written_at = now(), last_error = NULL, updated_at = now()
          WHERE id = $1 AND state = 'approved'`, [c.id, madeId, JSON.stringify({ audit_id: answer.body.audit_id ?? null, action: answer.body.action })]);
      return res.json({ written: true, xero_id: madeId, after: kind.after });
    }
    const text = changes.failureText(answer);
    if (outcome === "refused") {
      await pool.query(
        `UPDATE finance.xero_changes SET state = 'proposed', approved_by = NULL, approved_at = NULL, attempt_outcome = 'refused', last_error = $3, updated_at = now()
          WHERE id = $1 AND state = 'approved' AND attempts = $2`, [c.id, c.attempts, text]);
      return res.status(422).json({ error: text, issues: [text] });
    }
    await pool.query(
      `UPDATE finance.xero_changes SET attempt_outcome = 'unknown', last_error = $2, updated_at = now() WHERE id = $1 AND state = 'approved'`, [c.id, text]);
    return res.status(502).json({ error: `${text} It may have reached Xero: check there before trying again.` });
  }));

  // POST /xero-changes/:id/reject   body: { confirmed_not_in_xero }
  app.post(`${BASE}/:id/reject`, tolerant(async (req, res) => {
    const who = caller(req, res, { peopleOnly: true });
    if (!who) return;
    if (!changes.isGuid(req.params.id)) return res.status(400).json({ error: "id must be a change id" });
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await tx(client, who, async (conn, { actorEmail, role }) => {
      if (!recs.CFO_ROLE.test(String(role))) return { status: 403, body: { error: "Only the CFO rejects a change to Xero" } };
      const c = (await conn.query(`${SELECT} WHERE c.id = $1 AND c.client_id = $2 FOR UPDATE OF c`, [req.params.id, client.id])).rows[0];
      if (!c || !["proposed", "approved"].includes(c.state)) return { status: 409, body: { error: "This change is not waiting for a decision" } };
      let checked = false;
      if (c.state === "approved") {
        if (inFlight(c)) return { status: 409, body: { error: "This change is being made in Xero now." } };
        if (req.body?.confirmed_not_in_xero !== true) {
          return { status: 409, body: { error: "This may be in Xero. Check Xero. Reject it only once you have seen it is not there." } };
        }
        checked = true;
      }
      await conn.query(
        `UPDATE finance.xero_changes SET state = 'rejected', rejected_by = $2, rejected_at = now(), rejected_after_check = $3, updated_at = now()
          WHERE id = $1`, [c.id, actorEmail, checked]);
      await auditChange(conn, req, { client, actorEmail, role, action: "xero_change_rejected", id: c.id, payload: { was: c.state, kind: c.kind, summary: c.summary } });
      return { status: 200, body: { ok: true } };
    });
    res.status(out.status).json(out.body);
  }));
}

module.exports = { mountXeroChanges, IN_FLIGHT_MINUTES };
