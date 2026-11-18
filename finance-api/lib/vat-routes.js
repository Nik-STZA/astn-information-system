// VAT returns (VAT build spec 17 Nov 2026, steps 2-3; migration 058).
//
//   GET  /clients/:slug/vat                         registrations and returns
//   POST /clients/:slug/vat/returns                 { period_start, period_end, registration_id? }
//   GET  /clients/:slug/vat/returns/:id             uploads, checks, ledger tie, group build
//   POST /clients/:slug/vat/returns/:id/uploads     { entity_id, kind, file_name, sha256, sheets }
//   POST /clients/:slug/vat/returns/:id/adjustments { key, reason, evidence_ref }   CFO
//   POST /clients/:slug/vat/returns/:id/imports     record the import file generated now
//   POST /clients/:slug/vat/returns/:id/submit      { submitted_on, hmrc_receipt_ref }   CFO
//   POST /clients/:slug/vat/returns/:id/clearing    propose the group clearing journals again   CFO
//   POST /clients/:slug/vat/returns/:id/workbook    build the workbook and save it to the drive
//   GET  /clients/:slug/vat/returns/:id/workbook-data   for the pack engine (migration 059)
//   POST /clients/:slug/vat/returns/:id/workbook-saved  the pack engine reports back
//
// People only for now: the browser reads each export (it is a person's
// download from Xero) and sends its tabs as rows. Nothing here writes to Xero:
// Xero has no API for VAT returns; a person imports the file and submits.

const crypto = require("crypto");
const { parseVatExport } = require("./vat-export");
const { checkReturn, adjustmentKey } = require("./vat-checks");
const { buildGroup, confirmImport, importTemplateRows } = require("./vat-group");
const { trialBalanceByAccountId } = require("./journal");
const { isCfo } = require("./contracts");
const { metadataToken } = require("./pack-job");
const { clearingJournals } = require("./vat-clearing");
const { jnlRef } = require("./journals");

// The tabs of Xero's export kept with an upload, for the workbook.
const KEEP_TABS = ["VAT Return", "Transactions by VAT Box", "Transactions by Tax Rate"];
const MAX_ROWS = 20000;
const MAX_COLS = 30;

// Only Xero's tabs, as rows of short text; anything else in the file is dropped.
function keptSheets(sheets) {
  if (!sheets || typeof sheets !== "object") return null;
  const out = {};
  for (const tab of KEEP_TABS) {
    const rows = sheets[tab];
    if (!Array.isArray(rows)) continue;
    out[tab] = rows.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map((c) => (c === null || c === undefined ? "" : String(c).slice(0, 2000))) : []));
  }
  return Object.keys(out).length ? out : null;
}

// A short code for a company's columns and tabs: its slug when short (udl ->
// UDL), otherwise the initials of its name without Limited/Ltd.
function companyCode(entity) {
  if (entity.code) return entity.code;
  const slug = String(entity.slug ?? "");
  if (/^[a-z0-9]{2,5}$/i.test(slug)) return slug.toUpperCase();
  const words = String(entity.entity_name ?? entity.name ?? "").replace(/\b(limited|ltd|plc|llp)\b\.?/gi, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (words.map((w) => w[0]).join("").toUpperCase() || slug.toUpperCase()).slice(0, 6);
}

// The folder path inside the drive for a period: {yyyy} 2026, {yymm} 2610,
// {period} 2026-10, {fy} 26 (the calendar year of the period end).
function expandPath(parts, periodEnd) {
  const [y, m] = String(periodEnd).split("-");
  return (Array.isArray(parts) ? parts : []).map((part) => String(part)
    .replace(/\{yyyy\}/g, y).replace(/\{yymm\}/g, `${y.slice(2)}${m}`).replace(/\{period\}/g, `${y}-${m}`).replace(/\{fy\}/g, y.slice(2)));
}

const MISSING = "VAT returns are waiting for migration 058 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? ""));
const KINDS = ["member_export", "representative_pre_import", "representative_post_import"];
const FILED = ["submitted", "paid", "part_paid", "outstanding"];
const FIXED = "This return is submitted; its figures are fixed.";
const dayBefore = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const xeroDate = (d) => d.split("-").map(Number).join(",");

// Whether a return can be recorded as submitted, and from which upload. A
// group's representative must have been exported again after the import and
// show the group on every box; a single registration's own export, checks
// clear, is the return.
function submittable(ret, uploads, checks, group, confirmation) {
  if (FILED.includes(ret.status)) return { ok: false, why: "This return is already recorded as submitted." };
  if (!checks?.ok) return { ok: false, why: "The checks are not clear yet." };
  if (ret.registration_kind === "group") {
    const after = uploads.find((u) => u.entity_id === ret.representative_id && u.kind === "representative_post_import");
    if (!group || !after) return { ok: false, why: "Upload the representative's return exported after the import first." };
    if (!Array.isArray(confirmation) || confirmation.length) return { ok: false, why: "The representative's return does not yet show the group on every box." };
    return { ok: true, upload: after };
  }
  const own = uploads.find((u) => u.kind === "member_export");
  return own ? { ok: true, upload: own } : { ok: false, why: "Upload the company's export first." };
}

function mountVat(app, { route, pool, audit, clientIdFromSlug, xeroEntityContext, xeroGet, viaInput, startJob = null }) {
  const BASE = "/api/finance/clients/:slug/vat";

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  function person(req, res) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    if (origin.via) { res.status(403).json({ error: "VAT returns are uploaded by a person, in os.stza.io" }); return null; }
    return { actorEmail };
  }
  const roleOf = async (db, clientId, email) => (await db.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [clientId, email])).rows[0].role;

  async function registrationOf(db, clientId, id) {
    const r = (await db.query(
      `SELECT r.*, e.name AS representative_name FROM finance.vat_registrations r LEFT JOIN finance.entities e ON e.id = r.representative_id
        WHERE r.client_id = $1 AND r.ended_at IS NULL ${id ? "AND r.id = $2" : ""} ORDER BY r.created_at`, id ? [clientId, id] : [clientId])).rows;
    return r;
  }
  const membersOn = async (db, registrationId, date) => (await db.query(
    `SELECT m.entity_id, e.name AS entity_name, e.slug, m.code FROM finance.vat_registration_members m JOIN finance.entities e ON e.id = m.entity_id
      WHERE m.registration_id = $1 AND m.effective_from <= $2 AND (m.effective_to IS NULL OR m.effective_to >= $2) ORDER BY e.name`,
    [registrationId, date])).rows;

  // GET /vat
  app.get(BASE, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const regs = await registrationOf(pool, client.id);
    const returns = (await pool.query(
      `SELECT v.id, v.registration_id, v.period_start::text, v.period_end::text, v.status, v.submitted_on::text,
              (SELECT count(*)::int FROM finance.vat_return_uploads u WHERE u.return_id = v.id AND u.superseded_at IS NULL) AS uploads
         FROM finance.vat_returns v WHERE v.client_id = $1 ORDER BY v.period_end DESC`, [client.id])).rows;
    const out = [];
    for (const r of regs) out.push({ ...r, members: await membersOn(pool, r.id, new Date().toISOString().slice(0, 10)) });
    res.json({ registrations: out, returns });
  }));

  // POST /vat/returns
  app.post(`${BASE}/returns`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const b = req.body || {};
    if (!isDate(b.period_start) || !isDate(b.period_end) || b.period_end < b.period_start) return res.status(422).json({ issues: ["period_start and period_end must be dates, start first"] });
    const regs = await registrationOf(pool, client.id, b.registration_id && isGuid(b.registration_id) ? b.registration_id : null);
    if (regs.length !== 1) return res.status(422).json({ issues: [regs.length ? "say which VAT registration (registration_id)" : "this client has no VAT registration set up"] });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!role) return res.status(403).json({ error: "you have no role on this client" });
    const row = (await pool.query(
      `INSERT INTO finance.vat_returns (client_id, registration_id, period_start, period_end) VALUES ($1,$2,$3,$4)
       ON CONFLICT (registration_id, period_start, period_end) DO UPDATE SET updated_at = now() RETURNING id, status`,
      [client.id, regs[0].id, b.period_start, b.period_end])).rows[0];
    await audit(pool, { actorEmail: who.actorEmail, actorRole: role, action: "vat_return_opened", targetType: "vat_return", targetId: row.id, clientId: client.id,
      payload: { period_start: b.period_start, period_end: b.period_end }, ip: req.get("X-Forwarded-For") || req.ip });
    res.status(201).json(row);
  }));

  async function loadReturn(db, clientId, id) {
    if (!isGuid(id)) return null;
    return (await db.query(
      `SELECT v.*, v.period_start::text AS period_start, v.period_end::text AS period_end, v.submitted_on::text AS submitted_on, r.kind AS registration_kind, r.representative_id, r.vat_number,
              r.drive_id, r.export_path, r.workbook_title
         FROM finance.vat_returns v JOIN finance.vat_registrations r ON r.id = v.registration_id WHERE v.id = $1 AND v.client_id = $2`, [id, clientId])).rows[0] ?? null;
  }

  // POST /vat/returns/:id/uploads
  app.post(`${BASE}/returns/:id/uploads`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    if (FILED.includes(ret.status)) return res.status(409).json({ error: FIXED });
    const b = req.body || {};
    const kind = KINDS.includes(b.kind) ? b.kind : null;
    const fileName = String(b.file_name ?? "").replace(/[\\/\u0000-\u001f]+/g, " ").trim().slice(0, 200);
    if (!kind || !fileName || !isGuid(b.entity_id)) return res.status(422).json({ issues: ["entity_id, kind (member_export, representative_pre_import, representative_post_import) and file_name are required"] });
    const members = await membersOn(pool, ret.registration_id, ret.period_end);
    if (!members.some((m) => m.entity_id === b.entity_id)) return res.status(422).json({ issues: ["that company is not on this VAT registration at the period end"] });
    if (kind !== "member_export" && b.entity_id !== ret.representative_id) return res.status(422).json({ issues: ["only the representative member's return is uploaded before or after an import"] });
    const parsed = parseVatExport(b.sheets);
    if (parsed.errors.length) return res.status(422).json({ issues: parsed.errors });
    const sha256 = /^[0-9a-f]{64}$/.test(String(b.sha256 ?? "")) ? b.sha256
      : crypto.createHash("sha256").update(JSON.stringify(b.sheets)).digest("hex");
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!role) return res.status(403).json({ error: "you have no role on this client" });

    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("UPDATE finance.vat_return_uploads SET superseded_at = now() WHERE return_id = $1 AND entity_id = $2 AND kind = $3 AND superseded_at IS NULL",
        [ret.id, b.entity_id, kind]);
      const up = (await conn.query(
        `INSERT INTO finance.vat_return_uploads (return_id, entity_id, kind, file_name, sha256, parsed, sheets, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [ret.id, b.entity_id, kind, fileName, sha256, JSON.stringify({ ...parsed, lines: undefined }), JSON.stringify(keptSheets(b.sheets)), who.actorEmail])).rows[0];
      for (let box = 1; box <= 9; box++) {
        await conn.query("INSERT INTO finance.vat_return_figures (return_id, upload_id, entity_id, box, amount) VALUES ($1,$2,$3,$4,$5)",
          [ret.id, up.id, b.entity_id, box, parsed.boxes[box]]);
      }
      for (const l of parsed.lines) {
        await conn.query(
          `INSERT INTO finance.vat_return_lines (return_id, upload_id, entity_id, box, section, kind, reverse_charge, line_date, account, account_code, reference, details, vat, net, created_on)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [ret.id, up.id, b.entity_id, l.box, l.section.slice(0, 200), l.kind, l.reverse_charge || l.memo, l.date, l.account, l.account_code, l.reference, l.details, l.vat, l.net, l.created_on]);
      }
      await audit(conn, { actorEmail: who.actorEmail, actorRole: role, action: "vat_return_uploaded", targetType: "vat_return", targetId: ret.id, clientId: client.id,
        payload: { entity_id: b.entity_id, kind, file_name: fileName, sha256, lines: parsed.lines.length, box5: parsed.boxes[5] }, ip: req.get("X-Forwarded-For") || req.ip });
      await conn.query("COMMIT");
      res.status(201).json({ upload_id: up.id, lines: parsed.lines.length, boxes: parsed.boxes, warnings: parsed.warnings });
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }));

  // Every page of a Xero list (100 a page), so lines come back.
  async function pagedList(ctx, path, key, where) {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const batch = (await xeroGet(ctx.accessToken, ctx.tenantId, path, { where, page }))?.[key] ?? [];
      out.push(...batch);
      if (batch.length < 100) return out;
    }
    throw new Error(`more than 50 pages of ${key} in the period`);
  }

  // The VAT control's movement in the period, less clearing journals and
  // HMRC receipts, for one company (spec check 3). Null when Xero cannot be read.
  async function ledgerMovement(slug, entity, ret) {
    const ctx = await xeroEntityContext(slug, entity.slug);
    if (!ctx || ctx.error) return { error: ctx?.error ?? "not connected to Xero" };
    const accounts = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", { where: 'SystemAccount=="GST"' }))?.Accounts ?? [];
    const vat = accounts[0];
    if (!vat) return { error: "no VAT control account (system account GST) in Xero" };
    const bal = async (date) => {
      const rep = (await xeroGet(ctx.accessToken, ctx.tenantId, "/Reports/TrialBalance", { date }))?.Reports?.[0];
      const t = trialBalanceByAccountId(rep)[vat.AccountID];
      return t ? Math.round((t.ytdDebit - t.ytdCredit) * 100) : 0;
    };
    const close = await bal(ret.period_end);
    const open = await bal(dayBefore(ret.period_start));
    const where = `Date >= DateTime(${xeroDate(ret.period_start)}) AND Date <= DateTime(${xeroDate(ret.period_end)})`;
    // Xero returns journal and bank lines only on paged reads: unpaged, every
    // journal comes back with no lines and nothing would be taken out.
    const journals = await pagedList(ctx, "/ManualJournals", "ManualJournals", `${where} AND Status=="POSTED"`);
    const bank = await pagedList(ctx, "/BankTransactions", "BankTransactions", `${where} AND Status=="AUTHORISED"`);
    let excluded = 0;
    const named = [];
    for (const j of journals) for (const l of j.JournalLines ?? []) if (l.AccountCode === vat.Code) { excluded += Math.round(Number(l.LineAmount) * 100); named.push(`journal "${String(j.Narration ?? "").slice(0, 60)}"`); }
    for (const t of bank) for (const l of t.LineItems ?? []) if (l.AccountCode === vat.Code) {
      const sign = String(t.Type).startsWith("SPEND") ? 1 : -1;
      excluded += sign * Math.round(Number(l.LineAmount) * 100); named.push(`bank ${t.Type} ${t.Contact?.Name ?? ""}`.trim());
    }
    return { account: vat.Code, open, close, movement: close - open, excluded, trading: close - open - excluded, named };
  }

  // A return's uploads, checks and group build, shared by the page and the
  // workbook.
  async function viewOf(ret) {
    const members = await membersOn(pool, ret.registration_id, ret.period_end);
    const uploads = (await pool.query(
      `SELECT u.id, u.entity_id, u.kind, u.file_name, u.sha256, u.parsed, u.uploaded_by, u.uploaded_at, e.name AS entity_name, (u.sheets IS NOT NULL) AS has_sheets
         FROM finance.vat_return_uploads u LEFT JOIN finance.entities e ON e.id = u.entity_id
        WHERE u.return_id = $1 AND u.superseded_at IS NULL ORDER BY e.name, u.kind`, [ret.id])).rows;
    const lines = (await pool.query("SELECT * , line_date::text AS line_date, created_on::text AS created_on FROM finance.vat_return_lines WHERE return_id = $1 AND upload_id = ANY($2::uuid[])",
      [ret.id, uploads.map((u) => u.id)])).rows;
    const parsedOf = (u) => ({
      ...u.parsed,
      lines: lines.filter((l) => l.upload_id === u.id).map((l) => ({
        box: l.box, section: l.section, kind: l.kind, reverse_charge: l.reverse_charge,
        memo: l.reverse_charge && ((l.box === 1 && /reclaimed vat/i.test(l.section)) || (l.box === 4 && !/reclaimed vat/i.test(l.section))),
        date: l.line_date, account: l.account, account_code: l.account_code, reference: l.reference, details: l.details,
        vat: Number(l.vat), net: Number(l.net), created_on: l.created_on, id: l.id,
      })),
    });
    const accepted = new Set((await pool.query(
      `SELECT a.line_id FROM finance.vat_adjustment_reasons a JOIN finance.vat_return_lines l ON l.id = a.line_id
        WHERE l.return_id = $1 AND a.accepted_at IS NOT NULL`, [ret.id])).rows.map((r) => r.line_id));
    const memberExports = uploads.filter((u) => u.kind === "member_export" || (u.kind === "representative_pre_import" && !uploads.some((x) => x.entity_id === u.entity_id && x.kind === "member_export")));
    const exports = memberExports.map((u) => ({ entity_id: u.entity_id, entity_name: u.entity_name, parsed: parsedOf(u) }));
    const acceptedKeys = new Set();
    for (const x of exports) for (const l of x.parsed.lines) if (accepted.has(l.id)) acceptedKeys.add(adjustmentKey(x.entity_id, l));
    const checks = checkReturn({ exports, ret, members, accepted: acceptedKeys });

    let group = null;
    let confirmation = null;
    if (ret.registration_kind === "group" && checks.ok) {
      const repUpload = uploads.find((u) => u.entity_id === ret.representative_id && u.kind === "representative_post_import")
        ?? uploads.find((u) => u.entity_id === ret.representative_id && u.kind === "representative_pre_import")
        ?? uploads.find((u) => u.entity_id === ret.representative_id && u.kind === "member_export");
      const cols = exports.map((x) => ({ ...x, representative: x.entity_id === ret.representative_id }));
      const repLatest = repUpload ? parsedOf(repUpload) : null;
      group = buildGroup(cols, (l) => accepted.has(l.id), repLatest);
      if (repUpload?.kind === "representative_post_import") confirmation = confirmImport(group.target, repLatest);
      group.template_rows = importTemplateRows(group.import);
    }
    return { members, uploads, exports, checks, group, confirmation, accepted };
  }

  // The group clearing journals (migration 061), proposed on the Journals page
  // for the CFO to approve, dated the day the return was submitted. Once per
  // return: while any of its journals is proposed, approved or in Xero,
  // nothing more is proposed. Returns { proposed: [jnl], issues }.
  async function proposeClearing(client, ret, actorEmail, role, ip) {
    if (ret.registration_kind !== "group" || !ret.submitted_on) return { proposed: [], issues: [] };
    const open = (await pool.query(
      "SELECT count(*)::int AS n FROM finance.journals WHERE vat_return_id = $1 AND state IN ('proposed','approved','draft_created','posted')", [ret.id])).rows[0].n;
    if (open) return { proposed: [], issues: [], already: true };
    const { members, group } = await viewOf(ret);
    if (!group) return { proposed: [], issues: ["the group return could not be built from the uploads"] };
    const pairs = (await pool.query(
      `SELECT member_entity_id, member_account_code, representative_account_code FROM finance.vat_ic_pairs
        WHERE registration_id = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)`, [ret.registration_id, ret.submitted_on])).rows;
    const vatCode = {};
    const issues = [];
    for (const m of members) {
      try {
        const ctx = await xeroEntityContext(client.slug, m.slug);
        if (!ctx || ctx.error) throw new Error(ctx?.error ?? "not connected to Xero");
        const acc = ((await xeroGet(ctx.accessToken, ctx.tenantId, "/Accounts", { where: 'SystemAccount=="GST"' }))?.Accounts ?? [])[0];
        if (acc?.Code) vatCode[m.entity_id] = String(acc.Code);
      } catch (e) {
        issues.push(`${companyCode(m)}: Xero could not be read (${String(e.message || e).slice(0, 120)})`);
      }
    }
    if (issues.length) return { proposed: [], issues };
    const codes = Object.fromEntries(members.map((m) => [m.entity_id, companyCode(m)]));
    const built = clearingJournals({ ret, columns: group.columns, pairs, vatCode, codes });
    if (built.issues.length) return { proposed: [], issues: built.issues };
    const proposed = [];
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      for (const j of built.journals) {
        const row = (await conn.query(
          `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by, vat_return_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'vat',$8,$9) RETURNING id, jnl_no`,
          [client.id, j.entity_id, j.journal_date.slice(0, 7), j.journal_date, j.narration, JSON.stringify(j.lines), j.reason, actorEmail, ret.id])).rows[0];
        await audit(conn, { actorEmail, actorRole: role, action: "journal_proposed", targetType: "journal", targetId: row.id, clientId: client.id, ip,
          payload: { jnl: jnlRef(row.jnl_no), from: "vat_clearing", vat_return: ret.id, entity: j.entity_id, date: j.journal_date, narration: j.narration, lines: j.lines } });
        proposed.push(jnlRef(row.jnl_no));
      }
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    return { proposed, issues: [] };
  }

  const clearingOf = async (ret) => (await pool.query(
    `SELECT j.id, j.jnl_no, e.name AS entity_name, j.journal_date::text AS journal_date, j.state, j.lines, j.period, j.xero_journal_no
       FROM finance.journals j JOIN finance.entities e ON e.id = j.entity_id
      WHERE j.vat_return_id = $1 AND j.state <> 'superseded' ORDER BY j.created_at`, [ret.id])).rows
    .map((j) => ({ id: j.id, jnl: jnlRef(j.jnl_no), entity: j.entity_name, journal_date: j.journal_date, period: j.period, state: j.state, xero_journal_no: j.xero_journal_no,
      total: (j.lines || []).reduce((s, l) => s + Math.max(Number(l.amount) || 0, 0), 0) }));

  const workbookOf = (ret) => ({
    requested_at: ret.workbook_requested_at, requested_by: ret.workbook_requested_by, name: ret.workbook_name,
    link: ret.workbook_link, saved_at: ret.workbook_saved_at, error: ret.workbook_error,
  });

  // GET /vat/returns/:id
  app.get(`${BASE}/returns/:id`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const { members, uploads, exports, checks, group, confirmation } = await viewOf(ret);

    let ledger = null;
    if (req.query.ledger === "1") {
      ledger = [];
      for (const x of exports) {
        const ent = (await pool.query("SELECT id, slug, name FROM finance.entities WHERE id = $1", [x.entity_id])).rows[0];
        try {
          const m = await ledgerMovement(req.params.slug, ent, ret);
          if (m.error) { ledger.push({ entity: ent.name, error: m.error }); continue; }
          const own = x.parsed.lines.filter((l) => !l.memo && ["standard", "adjusted"].includes(l.kind) && l.date >= ret.period_start && l.date <= ret.period_end);
          const expected = own.reduce((s, l) => s + (l.box === 4 ? 1 : l.box === 1 ? -1 : 0) * Math.round(l.vat * 100), 0);
          ledger.push({ entity: ent.name, account: m.account, movement: m.movement / 100, excluded: m.excluded / 100, trading: m.trading / 100,
            from_return: expected / 100, difference: (m.trading - expected) / 100, excluded_items: m.named });
        } catch (e) {
          ledger.push({ entity: ent.name, error: `Xero could not be read: ${String(e.message || e).slice(0, 200)}` });
        }
      }
    }
    const imports = (await pool.query("SELECT id, kind, boxes, generated_by, generated_at, confirmed_at FROM finance.vat_imports WHERE return_id = $1 ORDER BY generated_at", [ret.id])).rows;
    res.json({
      return: { id: ret.id, period_start: ret.period_start, period_end: ret.period_end, status: ret.status, vat_number: ret.vat_number, kind: ret.registration_kind, representative_id: ret.representative_id },
      workbook: { ...workbookOf(ret), drive_set: Boolean(ret.drive_id) },
      submission: ret.submitted_on ? { submitted_on: ret.submitted_on, hmrc_receipt_ref: ret.hmrc_receipt_ref, boxes: ret.submitted_boxes, signed_by: ret.signed_by, signed_at: ret.signed_at } : null,
      can_submit: submittable(ret, uploads, checks, group, confirmation).ok,
      clearing: ret.registration_kind === "group" ? await clearingOf(ret) : null,
      members, uploads: uploads.map(({ parsed, ...u }) => ({ ...u, boxes: parsed?.boxes, period_start: parsed?.period_start, period_end: parsed?.period_end })),
      checks, group, confirmation, imports, ledger,
    });
  }));

  // POST /vat/returns/:id/adjustments   { line_id, reason, evidence_ref }   CFO
  app.post(`${BASE}/returns/:id/adjustments`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    if (FILED.includes(ret.status)) return res.status(409).json({ error: FIXED });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO accepts an adjustment with no accounting transaction" });
    const b = req.body || {};
    const reason = String(b.reason ?? "").trim();
    if (!isGuid(b.line_id) || reason.length < 10) return res.status(422).json({ issues: ["line_id and a reason (10 characters or more) are required"] });
    const line = (await pool.query("SELECT id FROM finance.vat_return_lines WHERE id = $1 AND return_id = $2 AND kind = 'no_transaction'", [b.line_id, ret.id])).rows[0];
    if (!line) return res.status(404).json({ error: "no adjustment with no accounting transaction with that id on this return" });
    const row = (await pool.query(
      `INSERT INTO finance.vat_adjustment_reasons (line_id, reason, evidence_ref, accepted_by, accepted_at, created_by) VALUES ($1,$2,$3,$4,now(),$4) RETURNING id`,
      [line.id, reason.slice(0, 2000), String(b.evidence_ref ?? "").slice(0, 300) || null, who.actorEmail])).rows[0];
    await audit(pool, { actorEmail: who.actorEmail, actorRole: role, action: "vat_adjustment_accepted", targetType: "vat_return", targetId: ret.id, clientId: client.id,
      payload: { line_id: line.id, reason }, ip: req.get("X-Forwarded-For") || req.ip });
    res.status(201).json({ id: row.id });
  }));

  // POST /vat/returns/:id/imports   records the import file generated now, from the current group build
  app.post(`${BASE}/returns/:id/imports`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    if (FILED.includes(ret.status)) return res.status(409).json({ error: FIXED });
    const boxes = req.body?.boxes;
    if (!boxes || ![1, 2, 4, 6, 7, 8, 9].every((b) => Number.isFinite(Number(boxes[b])))) return res.status(422).json({ issues: ["boxes 1, 2, 4 and 6-9 are required"] });
    const kind = (await pool.query("SELECT count(*)::int AS n FROM finance.vat_imports WHERE return_id = $1", [ret.id])).rows[0].n ? "correction" : "group";
    const role = await roleOf(pool, client.id, who.actorEmail);
    const row = (await pool.query("INSERT INTO finance.vat_imports (return_id, kind, boxes, generated_by) VALUES ($1,$2,$3,$4) RETURNING id, kind",
      [ret.id, kind, JSON.stringify(boxes), who.actorEmail])).rows[0];
    await pool.query("UPDATE finance.vat_returns SET status = 'import_ready', updated_at = now() WHERE id = $1 AND status = 'building'", [ret.id]);
    await audit(pool, { actorEmail: who.actorEmail, actorRole: role, action: "vat_import_generated", targetType: "vat_return", targetId: ret.id, clientId: client.id,
      payload: { kind, boxes }, ip: req.get("X-Forwarded-For") || req.ip });
    res.status(201).json(row);
  }));

  // POST /vat/returns/:id/submit   { submitted_on, hmrc_receipt_ref }   CFO
  // Records the return as filed in Xero: the boxes are the representative's
  // return as last exported (after the import, for a group), and are fixed
  // from now on. Only once that return shows the group on every box.
  app.post(`${BASE}/returns/:id/submit`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    if (FILED.includes(ret.status)) return res.status(409).json({ error: "This return is already recorded as submitted." });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO records a VAT return as submitted" });
    const b = req.body || {};
    const ref = String(b.hmrc_receipt_ref ?? "").trim();
    const today = new Date().toISOString().slice(0, 10);
    const issues = [];
    if (!isDate(b.submitted_on) || b.submitted_on > today || b.submitted_on <= ret.period_end) issues.push("submitted_on must be a date after the period end and not in the future");
    if (ref.length < 4 || ref.length > 80) issues.push("hmrc_receipt_ref is HMRC's receipt reference for the submission");
    if (issues.length) return res.status(422).json({ issues });
    const { uploads, checks, group, confirmation } = await viewOf(ret);
    const can = submittable(ret, uploads, checks, group, confirmation);
    if (!can.ok) return res.status(409).json({ error: can.why });
    const boxes = can.upload.parsed.boxes;
    await pool.query(
      `UPDATE finance.vat_returns SET status = 'submitted', submitted_on = $2, hmrc_receipt_ref = $3, submitted_boxes = $4, signed_by = $5, signed_at = now(), updated_at = now()
        WHERE id = $1 AND status NOT IN ('submitted','paid','part_paid','outstanding')`,
      [ret.id, b.submitted_on, ref, JSON.stringify(boxes), who.actorEmail]);
    if (ret.registration_kind === "group") {
      await pool.query("UPDATE finance.vat_imports SET confirmed_by_upload_id = $2, confirmed_at = now() WHERE return_id = $1 AND confirmed_at IS NULL", [ret.id, can.upload.id]);
    }
    await audit(pool, { actorEmail: who.actorEmail, actorRole: role, action: "vat_return_submitted", targetType: "vat_return", targetId: ret.id, clientId: client.id,
      payload: { submitted_on: b.submitted_on, hmrc_receipt_ref: ref, boxes, from_upload: can.upload.id }, ip: req.get("X-Forwarded-For") || req.ip });
    // The clearing journals follow at once; if they cannot be proposed now, the
    // return stays recorded and the page says why, with a button to try again.
    let clearing;
    try {
      clearing = await proposeClearing(client, { ...ret, submitted_on: b.submitted_on }, who.actorEmail, role, req.get("X-Forwarded-For") || req.ip);
    } catch (e) {
      clearing = { proposed: [], issues: [`the clearing journals could not be proposed: ${String(e.message || e).slice(0, 200)}`] };
    }
    res.status(201).json({ status: "submitted", boxes, clearing });
  }));

  // POST /vat/returns/:id/clearing   proposes the clearing journals again (after
  // the intercompany accounts are set, or after the CFO rejected them)
  app.post(`${BASE}/returns/:id/clearing`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!isCfo(role)) return res.status(403).json({ error: "only the CFO proposes the VAT clearing journals" });
    if (!FILED.includes(ret.status)) return res.status(409).json({ error: "Record the return as submitted first: the clearing is dated the day it was filed." });
    if (ret.registration_kind !== "group") return res.status(409).json({ error: "A single registration has nothing to clear." });
    const out = await proposeClearing(client, ret, who.actorEmail, role, req.get("X-Forwarded-For") || req.ip);
    if (out.already) return res.status(409).json({ error: "This return's clearing journals are already on the Journals page." });
    if (out.issues.length) return res.status(422).json({ issues: out.issues });
    res.status(201).json(out);
  }));

  // POST /vat/returns/:id/workbook   builds the workbook in the pack engine and saves it to the client's drive
  app.post(`${BASE}/returns/:id/workbook`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const role = await roleOf(pool, client.id, who.actorEmail);
    if (!role) return res.status(403).json({ error: "you have no role on this client" });
    if (!ret.drive_id) return res.status(422).json({ issues: ["no shared drive is set for this VAT registration, so there is nowhere to save the workbook"] });
    const withSheets = (await pool.query("SELECT count(*)::int AS n FROM finance.vat_return_uploads WHERE return_id = $1 AND superseded_at IS NULL AND sheets IS NOT NULL", [ret.id])).rows[0].n;
    if (!withSheets) return res.status(422).json({ issues: ["upload the companies' exports again: files uploaded before 19 Nov 2026 did not keep Xero's tabs"] });
    const project = process.env.GCP_PROJECT;
    const region = process.env.PACK_JOB_REGION;
    const job = process.env.PACK_ENGINE_JOB;
    if (!project || !region || !job) return res.status(503).json({ error: "the pack engine is not configured on finance-api (GCP_PROJECT, PACK_JOB_REGION, PACK_ENGINE_JOB)" });
    const r = await (startJob ?? defaultStartJob)({ project, region, job, env: { JOB_KIND: "vat_workbook", CLIENT_SLUG: req.params.slug, VAT_RETURN_ID: ret.id } });
    await pool.query("UPDATE finance.vat_returns SET workbook_requested_at = now(), workbook_requested_by = $2, workbook_error = NULL, updated_at = now() WHERE id = $1", [ret.id, who.actorEmail]);
    await audit(pool, { actorEmail: who.actorEmail, actorRole: role, action: "vat_workbook_requested", targetType: "vat_return", targetId: ret.id, clientId: client.id,
      payload: { execution: r.execution }, ip: req.get("X-Forwarded-For") || req.ip });
    res.status(202).json({ started: true, execution: r.execution });
  }));

  // GET /vat/returns/:id/workbook-data   everything the pack engine needs, sheets included
  app.get(`${BASE}/returns/:id/workbook-data`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const { members, uploads, checks, group, confirmation } = await viewOf(ret);
    const sheets = new Map((await pool.query("SELECT id, sheets FROM finance.vat_return_uploads WHERE return_id = $1 AND superseded_at IS NULL", [ret.id])).rows.map((r) => [r.id, r.sheets]));
    const pick = (entityId, kinds) => { for (const k of kinds) { const u = uploads.find((x) => x.entity_id === entityId && x.kind === k); if (u) return u; } return null; };
    const ordered = [...members].sort((a, b) => (a.entity_id === ret.representative_id ? -1 : b.entity_id === ret.representative_id ? 1 : 0));
    const companies = ordered.map((m) => {
      const own = pick(m.entity_id, ["member_export", "representative_pre_import"]);
      const after = m.entity_id === ret.representative_id ? pick(m.entity_id, ["representative_post_import"]) : null;
      return {
        entity_id: m.entity_id, name: m.entity_name, code: companyCode(m), representative: m.entity_id === ret.representative_id,
        file_name: own?.file_name ?? null, boxes: own?.parsed?.boxes ?? null, sheets: own ? sheets.get(own.id) ?? null : null,
        after_import: after ? { file_name: after.file_name, boxes: after.parsed?.boxes ?? null, sheets: sheets.get(after.id) ?? null } : null,
      };
    });
    const clientName = (await pool.query("SELECT name FROM shared.clients WHERE id = $1", [client.id])).rows[0]?.name ?? req.params.slug;
    res.json({
      client: clientName,
      return: { id: ret.id, period_start: ret.period_start, period_end: ret.period_end, status: ret.status, vat_number: ret.vat_number, kind: ret.registration_kind,
        submitted_on: ret.submitted_on ?? null, hmrc_receipt_ref: ret.hmrc_receipt_ref ?? null, submitted_boxes: ret.submitted_boxes ?? null },
      drive: { drive_id: ret.drive_id, path: expandPath(ret.export_path, ret.period_end), file_id: ret.workbook_file_id },
      title: ret.workbook_title || clientName,
      companies, checks, group, confirmation,
    });
  }));

  // POST /vat/returns/:id/workbook-saved   { file_id, name, link } or { error }
  app.post(`${BASE}/returns/:id/workbook-saved`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const b = req.body || {};
    if (b.error) {
      await pool.query("UPDATE finance.vat_returns SET workbook_error = $2, updated_at = now() WHERE id = $1", [ret.id, String(b.error).slice(0, 2000)]);
      return res.json({ ok: true });
    }
    const fileId = String(b.file_id ?? "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return res.status(422).json({ issues: ["file_id is required"] });
    const link = /^https:\/\/(docs|drive)\.google\.com\//.test(String(b.link ?? "")) ? String(b.link) : null;
    await pool.query(
      `UPDATE finance.vat_returns SET workbook_file_id = $2, workbook_name = $3, workbook_link = $4, workbook_saved_at = now(), workbook_error = NULL, updated_at = now() WHERE id = $1`,
      [ret.id, fileId, String(b.name ?? "").slice(0, 300), link]);
    await audit(pool, { actorEmail: "pack-engine", actorRole: "system", action: "vat_workbook_saved", targetType: "vat_return", targetId: ret.id, clientId: client.id,
      payload: { file_id: fileId, name: b.name }, ip: req.get("X-Forwarded-For") || req.ip });
    res.json({ ok: true });
  }));
}

// Starts the pack engine's Cloud Run Job with the given environment.
async function defaultStartJob({ project, region, job, env }, { fetchImpl = fetch } = {}) {
  const bearer = await metadataToken(fetchImpl);
  const r = await fetchImpl(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
    method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env: Object.entries(env).map(([name, value]) => ({ name, value: String(value) })) }] } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google Cloud refused to start the pack engine (${r.status}): ${text.slice(0, 300)}`);
  const op = text ? JSON.parse(text) : {};
  return { execution: op.metadata?.name ?? null };
}

module.exports = { mountVat, keptSheets, companyCode, expandPath, submittable };
