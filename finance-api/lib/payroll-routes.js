// The payroll routes (lib/payroll.js, migration 065).
//
//   GET  /payroll?period=YYYY-MM            settings, roles, the month's report, journals preview, workbook
//   PUT  /payroll/settings                  CFO: companies, accounts, projects, drive folder
//   PUT  /payroll/roles                     CFO: { roles: { emp_code: role } }
//   POST /payroll/runs                      a person: { period, pay_date, source_name, source_sha256, rows }
//   POST /payroll/runs/:id/alloc            CFO: { alloc: { emp_code: { project: percent } } } confirmed
//   POST /payroll/runs/:id/propose          the month's journals onto the Journals page
//   POST /payroll/runs/:id/workbook         the pack engine builds the working file on the client's drive
//   GET  /payroll/runs/:id/workbook-data    for the pack engine
//   POST /payroll/runs/:id/workbook-saved   the pack engine reports back
//
// Staff details never reach here. The browser reads the provider's salary
// report and sends only the heading row and rows cut down to the employee code
// and the payroll figures (pay.FIGURES); anything else is refused. The working
// file, with the provider's tab kept as it came, is built on the client's own
// drive from the export the client keeps there.

const pay = require("./payroll");
const recs = require("./recs");
const { jnlRef } = require("./journals");
const { expandPath } = require("./vat-routes");

const MISSING = "Payroll is waiting for migration 065 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const isPeriod = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s ?? ""));
const PLATFORM = "platform:payroll";
// The only headings that may arrive: the employee code and the figures.
const ALLOWED = new Set([pay.CODE, ...Object.values(pay.FIGURES)].map((h) => String(h).replace(/\s+/g, "").toLowerCase()));
const LIVE = ["proposed", "approved", "draft_created", "posted"];
const KINDS = ["payroll", "contracted", "capdev", "capdev_other"];

const lastDay = (p) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Rows from the browser: a heading row then data rows, every heading on the
// allow-list. Returns issues, never the rows themselves.
function strippedIssues(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || !rows.every(Array.isArray)) return ["rows must be the heading row and at least one employee"];
  if (rows.length > 2000) return ["too many rows for a salary report"];
  const head = rows[0].map((h) => String(h ?? "").replace(/\s+/g, "").toLowerCase());
  const bad = head.filter((h) => h && !ALLOWED.has(h));
  if (bad.length) return [`only the employee code and payroll figures may be sent: ${bad.length} other column${bad.length === 1 ? "" : "s"} refused`];
  if (rows.some((r) => r.length > head.length)) return ["a row has more cells than there are headings"];
  for (const r of rows.slice(1)) for (const v of r) {
    if (v === null || v === "" || typeof v === "number") continue;
    if (typeof v === "string" && v.length <= 20 && /^[A-Za-z0-9 ,.£()_-]*$/.test(v)) continue;
    return ["a cell holds something other than a code or a figure"];
  }
  return [];
}

// Projects and percentages: numbers 0-100, known projects, at most 100 each.
function allocIssues(alloc, projects, codes) {
  if (!alloc || typeof alloc !== "object" || Array.isArray(alloc)) return ["alloc must be { emp_code: { project: percent } }"];
  const out = [];
  for (const [code, shares] of Object.entries(alloc)) {
    if (!codes.includes(code)) { out.push(`employee code ${code} is not in this month's report`); continue; }
    if (!shares || typeof shares !== "object" || Array.isArray(shares)) { out.push(`employee ${code}: shares must be { project: percent }`); continue; }
    let total = 0;
    for (const [p, v] of Object.entries(shares)) {
      const n = Number(v);
      if (!projects.includes(p)) out.push(`employee ${code}: ${p} is not a project`);
      if (!Number.isFinite(n) || n < 0 || n > 100) out.push(`employee ${code}: ${p} must be between 0 and 100`);
      else total += n;
    }
    if (total > 100.0001) out.push(`employee ${code}: capitalised share adds to ${Math.round(total * 100) / 100}%, over 100%`);
  }
  return out;
}

// The shares with nil projects dropped, so carried-forward shares compare cleanly.
const tidyAlloc = (alloc) => Object.fromEntries(Object.entries(alloc ?? {}).map(([c, s]) => [c, Object.fromEntries(Object.entries(s ?? {}).filter(([, v]) => Number(v) > 0).map(([p, v]) => [p, Number(v)]))]));

function mountPayroll(app, { route, pool, audit, clientIdFromSlug, viaInput, startJob = null, defaultStartJob = require("./vat-routes").defaultStartJob }) {
  const BASE = "/api/finance/clients/:slug/payroll";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  // A person, or FM1 from a live run where agents=true.
  async function caller(req, res, client, { cfo = false, agents = false, what = "this" } = {}) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    const via = origin.via;
    if (via && !(agents && via.kind === "agent" && via.agent === "fm1")) {
      res.status(403).json({ error: `Only a person does ${what}, in os.stza.io` });
      return null;
    }
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail])).rows[0].role;
    if (!role) { res.status(403).json({ error: `${actorEmail} holds no engagement role for this client` }); return null; }
    if (cfo && !recs.CFO_ROLE.test(String(role))) { res.status(403).json({ error: `Only the CFO does ${what}` }); return null; }
    if (via?.kind === "agent") {
      const run = (await pool.query("SELECT agent, status FROM finance.agent_runs WHERE id = $1 AND client_id = $2", [via.run_id, client.id])).rows[0];
      if (!run || run.agent !== "fm1" || !["queued", "running"].includes(run.status)) { res.status(403).json({ error: "That run is not a live FM1 run for this client" }); return null; }
    }
    return { actorEmail, role, actor: via ? "agent:fm1" : actorEmail };
  }
  const auditPay = (req, { client, who, action, id, payload }) => audit(pool, {
    actorEmail: who.actorEmail, actorRole: who.role, action, targetType: "payroll_run", targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  async function settingsOf(clientId) {
    const s = (await pool.query(
      `SELECT s.*, pe.slug AS payroll_entity, pe.name AS payroll_entity_name, ce.slug AS contracted_entity, ce.name AS contracted_entity_name
         FROM finance.payroll_settings s
         JOIN finance.entities pe ON pe.id = s.payroll_entity_id
         LEFT JOIN finance.entities ce ON ce.id = s.contracted_entity_id
        WHERE s.client_id = $1`, [clientId])).rows[0];
    return s ?? null;
  }
  const rolesOf = async (clientId) => Object.fromEntries((await pool.query(
    "SELECT emp_code, role FROM finance.payroll_roles WHERE client_id = $1 ORDER BY emp_code", [clientId])).rows.map((r) => [r.emp_code, r.role]));
  const liveRun = async (clientId, period) => (await pool.query(
    "SELECT * FROM finance.payroll_runs WHERE client_id = $1 AND period = $2 AND superseded_at IS NULL", [clientId, period])).rows[0] ?? null;
  const runById = async (clientId, id) => (/^[0-9a-f-]{36}$/i.test(String(id)) ? (await pool.query(
    "SELECT * FROM finance.payroll_runs WHERE client_id = $1 AND id = $2 AND superseded_at IS NULL", [clientId, id])).rows[0] ?? null : null);
  const journalsOf = async (runId) => (await pool.query(
    `SELECT j.id, j.jnl_no, j.payroll_kind, j.state, j.narration, e.slug AS entity, e.name AS entity_name
       FROM finance.journals j JOIN finance.entities e ON e.id = j.entity_id
      WHERE j.source = 'payroll' AND j.payroll_run_id = $1 ORDER BY j.jnl_no`, [runId])).rows
    .map((j) => ({ id: j.id, jnl: jnlRef(j.jnl_no), kind: j.payroll_kind, state: j.state, narration: j.narration, entity: j.entity, entity_name: j.entity_name }));

  // The journals as lib/payroll.js builds them, one per kind.
  function preview(run, settings, roles) {
    const out = pay.payrollJournals({
      employees: run.figures, roles, alloc: run.alloc, period: run.period, payDate: run.pay_date,
      settings: settings ? { payroll_entity: settings.payroll_entity, contracted_entity: settings.contracted_entity, accounts: settings.accounts, projects: settings.projects } : null,
    });
    const [payroll, contracted] = out.journals;
    const kinds = [];
    if (payroll) kinds.push({ kind: "payroll", ...payroll });
    if (contracted) kinds.push({ kind: "contracted", ...contracted });
    if (out.capdev) {
      kinds.push({ kind: "capdev", entity: out.capdev.entity, date: out.capdev.date, narration: out.capdev.narration, lines: out.capdev.lines, issues: [] });
      if (out.capdev.other.length) kinds.push({ kind: "capdev_other", entity: out.capdev.other_entity, date: out.capdev.date, narration: out.capdev.narration, lines: out.capdev.other, issues: [] });
    }
    return { journals: kinds, by_project: out.capdev?.by_project ?? {}, issues: out.issues };
  }

  const workbookOf = (run) => ({
    requested_at: run.workbook_requested_at, requested_by: run.workbook_requested_by, name: run.workbook_name,
    link: run.workbook_link, saved_at: run.workbook_saved_at, error: run.workbook_error,
  });

  // GET /payroll?period=YYYY-MM
  app.get(BASE, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const period = isPeriod(req.query.period) ? req.query.period : null;
    if (!period) return res.status(422).json({ issues: ["period must be YYYY-MM"] });
    const [settings, roles, run] = [await settingsOf(client.id), await rolesOf(client.id), await liveRun(client.id, period)];
    const entities = (await pool.query("SELECT slug, name FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name", [client.id])).rows;
    const last = (await pool.query(
      "SELECT period FROM finance.payroll_runs WHERE client_id = $1 AND superseded_at IS NULL AND period < $2 ORDER BY period DESC LIMIT 1", [client.id, period])).rows[0];
    const body = {
      period, entities, last_period: last?.period ?? null,
      settings: settings ? {
        payroll_entity: settings.payroll_entity, payroll_entity_name: settings.payroll_entity_name,
        contracted_entity: settings.contracted_entity, contracted_entity_name: settings.contracted_entity_name,
        accounts: settings.accounts, projects: settings.projects, drive_set: Boolean(settings.drive_id),
        folder: expandPath(settings.drive_path, lastDay(period)).join(" / "),
      } : null,
      roles, run: null,
    };
    if (run) {
      const p = preview(run, settings, roles);
      body.run = {
        id: run.id, pay_date: String(run.pay_date instanceof Date ? run.pay_date.toISOString().slice(0, 10) : run.pay_date).slice(0, 10),
        source_name: run.source_name, uploaded_by: run.uploaded_by, uploaded_at: run.uploaded_at, missing: run.missing,
        employees: run.figures, alloc: run.alloc, alloc_confirmed_by: run.alloc_confirmed_by, alloc_confirmed_at: run.alloc_confirmed_at,
        no_role: run.figures.filter((e) => !pay.ROLES.includes(roles[e.emp_code])).map((e) => e.emp_code),
        preview: p, journals: await journalsOf(run.id), workbook: workbookOf(run),
      };
    }
    res.json(body);
  }));

  // PUT /payroll/settings   CFO
  app.put(`${BASE}/settings`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { cfo: true, what: "payroll settings" });
    if (!who) return;
    const b = req.body || {};
    const issues = [];
    const entity = async (slug) => (slug ? (await pool.query("SELECT id FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL", [client.id, slug])).rows[0]?.id ?? null : null);
    const payrollId = await entity(b.payroll_entity);
    if (!payrollId) issues.push("payroll_entity must be one of this client's companies");
    const contractedId = b.contracted_entity ? await entity(b.contracted_entity) : null;
    if (b.contracted_entity && !contractedId) issues.push("contracted_entity must be one of this client's companies");
    const accounts = b.accounts ?? {};
    for (const group of ["payroll", "contracted", "capdev"]) {
      for (const [k, v] of Object.entries(accounts[group] ?? {})) if (v != null && !/^[A-Za-z0-9.-]{1,10}$/.test(String(v))) issues.push(`accounts.${group}.${k} is not an account code`);
    }
    const projects = Array.isArray(b.projects) ? b.projects.map(String) : [];
    for (const p of projects) if (!pay.PROJECT.test(p)) issues.push(`${p} is not a project code (letters and digits, up to 8)`);
    const drivePath = Array.isArray(b.drive_path) ? b.drive_path.map(String) : [];
    if (b.drive_id != null && !/^[A-Za-z0-9_-]{5,100}$/.test(String(b.drive_id))) issues.push("drive_id is not a shared drive id");
    if (issues.length) return res.status(422).json({ issues });
    await pool.query(
      `INSERT INTO finance.payroll_settings (client_id, payroll_entity_id, contracted_entity_id, accounts, projects, drive_id, drive_path, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET payroll_entity_id = EXCLUDED.payroll_entity_id, contracted_entity_id = EXCLUDED.contracted_entity_id,
         accounts = EXCLUDED.accounts, projects = EXCLUDED.projects, drive_id = EXCLUDED.drive_id, drive_path = EXCLUDED.drive_path,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [client.id, payrollId, contractedId, JSON.stringify(accounts), projects, b.drive_id ?? null, JSON.stringify(drivePath), who.actorEmail]);
    await audit(pool, { actorEmail: who.actorEmail, actorRole: who.role, action: "payroll_settings_set", targetType: "client", targetId: client.id, clientId: client.id,
      payload: { payroll_entity: b.payroll_entity, contracted_entity: b.contracted_entity ?? null, accounts, projects, drive_path: drivePath }, ip: req.get("X-Forwarded-For") || req.ip });
    res.json({ ok: true });
  }));

  // PUT /payroll/roles   CFO: { roles: { emp_code: role } }
  app.put(`${BASE}/roles`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { cfo: true, what: "payroll roles" });
    if (!who) return;
    const roles = req.body?.roles;
    if (!roles || typeof roles !== "object" || Array.isArray(roles)) return res.status(422).json({ issues: ["roles must be { emp_code: role }"] });
    const issues = [];
    for (const [code, role] of Object.entries(roles)) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) issues.push(`${code} is not an employee code`);
      if (!pay.ROLES.includes(role)) issues.push(`employee ${code}: role must be director, direct or intercompany`);
    }
    if (issues.length) return res.status(422).json({ issues });
    const before = await rolesOf(client.id);
    const changed = Object.entries(roles).filter(([c, r]) => before[c] !== r);
    for (const [code, role] of changed) {
      await pool.query(
        `INSERT INTO finance.payroll_roles (client_id, emp_code, role, set_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, emp_code) DO UPDATE SET role = EXCLUDED.role, set_by = EXCLUDED.set_by, set_at = now()`,
        [client.id, code, role, who.actorEmail]);
    }
    if (changed.length) {
      await audit(pool, { actorEmail: who.actorEmail, actorRole: who.role, action: "payroll_roles_set", targetType: "client", targetId: client.id, clientId: client.id,
        payload: { changed: changed.map(([c, r]) => ({ emp_code: c, from: before[c] ?? null, to: r })) }, ip: req.get("X-Forwarded-For") || req.ip });
    }
    res.json({ changed: changed.length });
  }));

  // POST /payroll/runs   a person uploads the month's report, cut down in the browser
  app.post(`${BASE}/runs`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { what: "payroll uploads" });
    if (!who) return;
    const b = req.body || {};
    const issues = [];
    if (!isPeriod(b.period)) issues.push("period must be YYYY-MM");
    if (!isDate(b.pay_date)) issues.push("pay_date must be YYYY-MM-DD");
    else if (isPeriod(b.period) && String(b.pay_date).slice(0, 7) !== b.period) issues.push("the pay date must fall in the month");
    const sourceName = String(b.source_name ?? "").trim();
    if (!sourceName || sourceName.length > 200 || /[\\/]/.test(sourceName)) issues.push("source_name is the export's file name");
    if (!/^[0-9a-f]{64}$/.test(String(b.source_sha256 ?? ""))) issues.push("source_sha256 must be the file's SHA-256");
    issues.push(...strippedIssues(b.rows));
    if (issues.length) return res.status(422).json({ issues });
    const report = pay.readSalaryReport(b.rows);
    if (report.issues.length) return res.status(422).json({ issues: report.issues });
    if (!report.employees.length) return res.status(422).json({ issues: ["the report has no employees"] });

    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const prior = (await conn.query(
        "SELECT * FROM finance.payroll_runs WHERE client_id = $1 AND period = $2 AND superseded_at IS NULL FOR UPDATE", [client.id, b.period])).rows[0];
      if (prior?.source_sha256 === b.source_sha256) {
        await conn.query("ROLLBACK");
        return res.json({ id: prior.id, unchanged: true });
      }
      if (prior) {
        const live = (await conn.query(
          "SELECT jnl_no, state FROM finance.journals WHERE source = 'payroll' AND payroll_run_id = $1 AND state = ANY($2)", [prior.id, LIVE])).rows;
        const past = live.filter((j) => j.state !== "proposed");
        if (past.length) {
          await conn.query("ROLLBACK");
          return res.status(409).json({ issues: [`this month's journals are already ${past.map((j) => `${jnlRef(j.jnl_no)} ${j.state.replace("_", " ")}`).join(", ")}: reject or void them before replacing the report`] });
        }
        if (live.length) {
          await conn.query(
            `UPDATE finance.journals SET state = 'rejected', rejected_by = $2, rejected_at = now(), updated_at = now()
              WHERE source = 'payroll' AND payroll_run_id = $1 AND state = 'proposed'`, [prior.id, PLATFORM]);
        }
        await conn.query("UPDATE finance.payroll_runs SET superseded_at = now() WHERE id = $1", [prior.id]);
      }
      // The shares carry forward from this month's earlier upload, else the last month's.
      const from = prior ?? (await conn.query(
        "SELECT alloc FROM finance.payroll_runs WHERE client_id = $1 AND superseded_at IS NULL AND period < $2 ORDER BY period DESC LIMIT 1", [client.id, b.period])).rows[0];
      const alloc = tidyAlloc(pay.carryForward(from?.alloc ?? {}, report.employees));
      const row = (await conn.query(
        `INSERT INTO finance.payroll_runs (client_id, period, pay_date, figures, missing, source_name, source_sha256, alloc, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [client.id, b.period, b.pay_date, JSON.stringify(report.employees), report.missing, sourceName, b.source_sha256, JSON.stringify(alloc), who.actorEmail])).rows[0];
      await conn.query("COMMIT");
      await auditPay(req, { client, who, action: "payroll_uploaded", id: row.id,
        payload: { period: b.period, pay_date: b.pay_date, source_name: sourceName, employees: report.employees.length, replaces: prior?.id ?? null } });
      res.status(201).json({ id: row.id, employees: report.employees.length, missing: report.missing, replaced: Boolean(prior) });
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }));

  // POST /payroll/runs/:id/alloc   CFO confirms the month's capitalisation shares
  app.post(`${BASE}/runs/:id/alloc`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { cfo: true, what: "capitalisation shares" });
    if (!who) return;
    const run = await runById(client.id, req.params.id);
    if (!run) return res.status(404).json({ error: "payroll month not found" });
    const settings = await settingsOf(client.id);
    const alloc = req.body?.alloc ?? run.alloc;
    const issues = allocIssues(alloc, settings?.projects ?? [], run.figures.map((e) => e.emp_code));
    if (issues.length) return res.status(422).json({ issues });
    const live = (await pool.query("SELECT count(*)::int AS n FROM finance.journals WHERE source = 'payroll' AND payroll_run_id = $1 AND payroll_kind LIKE 'capdev%' AND state = ANY($2)", [run.id, LIVE])).rows[0].n;
    if (live) return res.status(409).json({ issues: ["the capitalised development journal is already proposed: reject it on the Journals page first"] });
    const tidy = tidyAlloc(alloc);
    await pool.query("UPDATE finance.payroll_runs SET alloc = $2, alloc_confirmed_by = $3, alloc_confirmed_at = now() WHERE id = $1", [run.id, JSON.stringify(tidy), who.actorEmail]);
    await auditPay(req, { client, who, action: "payroll_alloc_confirmed", id: run.id, payload: { period: run.period, alloc: tidy } });
    res.json({ ok: true });
  }));

  // POST /payroll/runs/:id/propose   the month's journals onto the Journals page
  app.post(`${BASE}/runs/:id/propose`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { agents: true, what: "payroll journals" });
    if (!who) return;
    const run = await runById(client.id, req.params.id);
    if (!run) return res.status(404).json({ error: "payroll month not found" });
    const settings = await settingsOf(client.id);
    if (!settings) return res.status(422).json({ issues: ["set the payroll settings first: companies and accounts"] });
    if (!run.alloc_confirmed_at) return res.status(422).json({ issues: ["confirm this month's capitalisation shares first"] });
    const p = preview(run, settings, await rolesOf(client.id));
    if (p.issues.length) return res.status(422).json({ issues: p.issues });
    const entityIds = Object.fromEntries((await pool.query("SELECT slug, id FROM finance.entities WHERE client_id = $1", [client.id])).rows.map((r) => [r.slug, r.id]));
    const made = [];
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const have = new Set((await conn.query(
        "SELECT payroll_kind FROM finance.journals WHERE source = 'payroll' AND payroll_run_id = $1 AND state = ANY($2) FOR UPDATE", [run.id, LIVE])).rows.map((r) => r.payroll_kind));
      for (const j of p.journals) {
        if (have.has(j.kind) || !KINDS.includes(j.kind)) continue;
        const entityId = entityIds[j.entity];
        if (!entityId) throw Object.assign(new Error(`no company ${j.entity}`), { status: 422 });
        const reason = [
          `${j.narration}, from ${run.source_name} (uploaded by ${run.uploaded_by}).`,
          j.kind === "capdev" || j.kind === "capdev_other" ? `Shares confirmed by ${run.alloc_confirmed_by}.` : null,
          `Payroll month ${run.id}.`,
        ].filter(Boolean).join(" ");
        const row = (await conn.query(
          `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by, payroll_run_id, payroll_kind)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'payroll',$8,$9,$10) RETURNING id, jnl_no`,
          [client.id, entityId, run.period, j.date, j.narration, JSON.stringify(j.lines), reason, who.actor, run.id, j.kind])).rows[0];
        await audit(conn, { actorEmail: who.actorEmail, actorRole: who.role, action: "journal_proposed", targetType: "journal", targetId: row.id, clientId: client.id,
          ip: req.get("X-Forwarded-For") || req.ip,
          payload: { jnl: jnlRef(row.jnl_no), from: "payroll", payroll_run: run.id, kind: j.kind, entity: j.entity, date: j.date, narration: j.narration, lines: j.lines } });
        made.push({ jnl: jnlRef(row.jnl_no), kind: j.kind, entity: j.entity });
      }
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      if (e.status === 422) return res.status(422).json({ issues: [e.message] });
      throw e;
    } finally {
      conn.release();
    }
    res.status(made.length ? 201 : 200).json({ proposed: made });
  }));

  // POST /payroll/runs/:id/workbook   the pack engine builds the working file on the client's drive
  app.post(`${BASE}/runs/:id/workbook`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const who = await caller(req, res, client, { what: "payroll working files" });
    if (!who) return;
    const run = await runById(client.id, req.params.id);
    if (!run) return res.status(404).json({ error: "payroll month not found" });
    const settings = await settingsOf(client.id);
    if (!settings?.drive_id) return res.status(422).json({ issues: ["no shared drive is set in the payroll settings, so there is nowhere to save the working file"] });
    const project = process.env.GCP_PROJECT;
    const region = process.env.PACK_JOB_REGION;
    const job = process.env.PACK_ENGINE_JOB;
    if (!project || !region || !job) return res.status(503).json({ error: "the pack engine is not configured on finance-api (GCP_PROJECT, PACK_JOB_REGION, PACK_ENGINE_JOB)" });
    const r = await (startJob ?? defaultStartJob)({ project, region, job, env: { JOB_KIND: "payroll_workbook", CLIENT_SLUG: req.params.slug, PAYROLL_RUN_ID: run.id } });
    await pool.query("UPDATE finance.payroll_runs SET workbook_requested_at = now(), workbook_requested_by = $2, workbook_error = NULL WHERE id = $1", [run.id, who.actorEmail]);
    await auditPay(req, { client, who, action: "payroll_workbook_requested", id: run.id, payload: { execution: r.execution } });
    res.status(202).json({ started: true, execution: r.execution });
  }));

  // GET /payroll/runs/:id/workbook-data   for the pack engine: codes and figures only
  app.get(`${BASE}/runs/:id/workbook-data`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const run = await runById(client.id, req.params.id);
    if (!run) return res.status(404).json({ error: "payroll month not found" });
    const settings = await settingsOf(client.id);
    const roles = await rolesOf(client.id);
    const p = preview(run, settings, roles);
    const clientName = (await pool.query("SELECT name FROM shared.clients WHERE id = $1", [client.id])).rows[0]?.name ?? req.params.slug;
    const [y, m] = run.period.split("-");
    res.json({
      client: clientName, period: run.period, yymm: `${y.slice(2)}${m}`,
      pay_date: String(run.pay_date instanceof Date ? run.pay_date.toISOString() : run.pay_date).slice(0, 10),
      source_name: run.source_name, source_sha256: run.source_sha256,
      drive: { drive_id: settings?.drive_id ?? null, path: expandPath(settings?.drive_path ?? [], lastDay(run.period)), file_id: run.workbook_file_id },
      entities: { payroll: settings?.payroll_entity_name ?? null, contracted: settings?.contracted_entity_name ?? null },
      projects: settings?.projects ?? [],
      employees: run.figures.map((e) => ({ ...e, role: roles[e.emp_code] ?? null })),
      alloc: run.alloc, alloc_confirmed_by: run.alloc_confirmed_by,
      journals: p.journals, by_project: p.by_project, issues: p.issues,
    });
  }));

  // POST /payroll/runs/:id/workbook-saved   { file_id, name, link } or { error }
  app.post(`${BASE}/runs/:id/workbook-saved`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const run = await runById(client.id, req.params.id);
    if (!run) return res.status(404).json({ error: "payroll month not found" });
    const b = req.body || {};
    if (b.error) {
      await pool.query("UPDATE finance.payroll_runs SET workbook_error = $2 WHERE id = $1", [run.id, String(b.error).slice(0, 2000)]);
      return res.json({ ok: true });
    }
    const fileId = String(b.file_id ?? "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return res.status(422).json({ issues: ["file_id is required"] });
    const link = /^https:\/\/(docs|drive)\.google\.com\//.test(String(b.link ?? "")) ? String(b.link) : null;
    await pool.query(
      "UPDATE finance.payroll_runs SET workbook_file_id = $2, workbook_name = $3, workbook_link = $4, workbook_saved_at = now(), workbook_error = NULL WHERE id = $1",
      [run.id, fileId, String(b.name ?? "").slice(0, 300), link]);
    await audit(pool, { actorEmail: "pack-engine", actorRole: "system", action: "payroll_workbook_saved", targetType: "payroll_run", targetId: run.id, clientId: client.id,
      payload: { file_id: fileId, name: b.name }, ip: req.get("X-Forwarded-For") || req.ip });
    res.json({ ok: true });
  }));
}

module.exports = { mountPayroll, strippedIssues, allocIssues, ALLOWED };
