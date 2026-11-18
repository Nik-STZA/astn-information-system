// VAT returns (VAT build spec 17 Nov 2026, steps 2-3; migration 058).
//
//   GET  /clients/:slug/vat                         registrations and returns
//   POST /clients/:slug/vat/returns                 { period_start, period_end, registration_id? }
//   GET  /clients/:slug/vat/returns/:id             uploads, checks, ledger tie, group build
//   POST /clients/:slug/vat/returns/:id/uploads     { entity_id, kind, file_name, sha256, sheets }
//   POST /clients/:slug/vat/returns/:id/adjustments { key, reason, evidence_ref }   CFO
//   POST /clients/:slug/vat/returns/:id/imports     record the import file generated now
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

const MISSING = "VAT returns are waiting for migration 058 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? ""));
const KINDS = ["member_export", "representative_pre_import", "representative_post_import"];
const dayBefore = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const xeroDate = (d) => d.split("-").map(Number).join(",");

function mountVat(app, { route, pool, audit, clientIdFromSlug, xeroEntityContext, xeroGet, viaInput }) {
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
    `SELECT m.entity_id, e.name AS entity_name, e.slug FROM finance.vat_registration_members m JOIN finance.entities e ON e.id = m.entity_id
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
      `SELECT v.*, v.period_start::text AS period_start, v.period_end::text AS period_end, r.kind AS registration_kind, r.representative_id, r.vat_number
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
    if (["submitted", "paid", "part_paid", "outstanding"].includes(ret.status)) return res.status(409).json({ error: "This return is submitted; its figures are fixed." });
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
        `INSERT INTO finance.vat_return_uploads (return_id, entity_id, kind, file_name, sha256, parsed, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ret.id, b.entity_id, kind, fileName, sha256, JSON.stringify({ ...parsed, lines: undefined }), who.actorEmail])).rows[0];
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
    const journals = (await xeroGet(ctx.accessToken, ctx.tenantId, "/ManualJournals", { where: `${where} AND Status=="POSTED"` }))?.ManualJournals ?? [];
    const bank = (await xeroGet(ctx.accessToken, ctx.tenantId, "/BankTransactions", { where: `${where} AND Status=="AUTHORISED"` }))?.BankTransactions ?? [];
    let excluded = 0;
    const named = [];
    for (const j of journals) for (const l of j.JournalLines ?? []) if (l.AccountCode === vat.Code) { excluded += Math.round(Number(l.LineAmount) * 100); named.push(`journal "${String(j.Narration ?? "").slice(0, 60)}"`); }
    for (const t of bank) for (const l of t.LineItems ?? []) if (l.AccountCode === vat.Code) {
      const sign = String(t.Type).startsWith("SPEND") ? 1 : -1;
      excluded += sign * Math.round(Number(l.LineAmount) * 100); named.push(`bank ${t.Type} ${t.Contact?.Name ?? ""}`.trim());
    }
    return { account: vat.Code, open, close, movement: close - open, excluded, trading: close - open - excluded, named };
  }

  // GET /vat/returns/:id
  app.get(`${BASE}/returns/:id`, tolerant(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const ret = await loadReturn(pool, client.id, req.params.id);
    if (!ret) return res.status(404).json({ error: "VAT return not found" });
    const members = await membersOn(pool, ret.registration_id, ret.period_end);
    const uploads = (await pool.query(
      `SELECT u.id, u.entity_id, u.kind, u.file_name, u.sha256, u.parsed, u.uploaded_by, u.uploaded_at, e.name AS entity_name
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
      return: { id: ret.id, period_start: ret.period_start, period_end: ret.period_end, status: ret.status, vat_number: ret.vat_number, kind: ret.registration_kind },
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
}

module.exports = { mountVat };
