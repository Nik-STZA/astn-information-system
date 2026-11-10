// Outstanding documents routes: lib/outstanding-docs.js decides, this applies,
// in finance.document_uploads and finance.outstanding_documents (migration 040).
//
// A file is held only until it has been read; its contents are then deleted
// in the same transaction that saves the lines (Nik, 10 Nov 2026: a cleaned
// list is what is wanted, and the original lives on the client's drive). A
// failed read keeps the file so it can be tried again.
//
// People only for now: upload a report, have it read, accept or dismiss the
// lines, then work the register (received, chased, closed without the
// document by the CFO with a reason). Agents join in a later change.
//
// Until migration 040 is applied the list answers migration_missing and every
// other route a 503, so finance-api can deploy ahead of it.

const crypto = require("crypto");
const docs = require("./outstanding-docs");
const sheets = require("./sheet-read");
const work = require("./work");

const MISSING = "Outstanding documents are waiting for migration 040 to be applied.";
const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";
// A read still marked reading after this long did not finish; it may be tried again.
const STALE_READ_MINUTES = 10;

function mountOutstandingDocs(app, { route, pool, audit, clientIdFromSlug, generate, express, viaInput = work.viaInput }) {
  const BASE = "/api/finance/clients/:slug/outstanding-documents";
  const rawBody = express.raw({ type: () => true, limit: docs.MAX_UPLOAD_BYTES + 1024 });

  const tolerant = (fn) => route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.status(503).json({ error: MISSING, migration_missing: true });
    }
  });

  // A person, in os.stza.io. Agents and Claude are refused for now.
  function person(req, res) {
    const actorEmail = (req.get("X-Actor-Email") || "").trim();
    if (!actorEmail) { res.status(400).json({ error: "X-Actor-Email is required" }); return null; }
    const origin = viaInput(req.get("X-Work-Via"), req.get("X-Work-Ref"));
    if (origin.issues.length) { res.status(400).json({ issues: origin.issues }); return null; }
    if (origin.via) { res.status(403).json({ error: "only a person works outstanding documents, in os.stza.io" }); return null; }
    return { actorEmail };
  }

  // A short transaction with the person's role.
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

  const log = (db, req, { client, actorEmail, role, action, targetType = "outstanding_document", id, payload }) => audit(db, {
    actorEmail, actorRole: role, action, targetType, targetId: id, clientId: client.id, payload,
    ip: req.get("X-Forwarded-For") || req.ip,
  });

  const entitiesOf = async (db, clientId) => (await db.query(
    "SELECT id, slug, name, legal_name FROM finance.entities WHERE client_id = $1 AND retired_at IS NULL ORDER BY name", [clientId])).rows;

  const thresholdOf = async (db, clientId) => {
    const r = (await db.query("SELECT doc_vat_threshold FROM finance.client_finance_config WHERE client_id = $1", [clientId])).rows[0];
    return r?.doc_vat_threshold != null ? Number(r.doc_vat_threshold) : docs.DEFAULT_THRESHOLD;
  };

  const ITEM_SELECT = `SELECT d.*, e.slug AS entity_slug, e.name AS entity_name, u.file_name AS upload_name
                         FROM finance.outstanding_documents d
                         LEFT JOIN finance.entities e ON e.id = d.entity_id
                         LEFT JOIN finance.document_uploads u ON u.id = d.upload_id`;

  const num = (v) => (v == null ? null : Number(v));
  const day = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const itemView = (d, threshold) => {
    const base = {
      id: d.id, state: d.state, entity_slug: d.entity_slug, entity_name: d.entity_name,
      bank_account: d.bank_account, txn_date: day(d.txn_date), payee: d.payee, reference: d.reference,
      direction: d.direction, amount: num(d.amount), currency: d.currency, amount_gbp: num(d.amount_gbp),
      concern: d.concern, note: d.note, source: d.source, upload_id: d.upload_id, upload_name: d.upload_name,
      source_line: d.source_line, duplicate_of: d.duplicate_of, xero_type: d.xero_type, xero_id: d.xero_id,
      created_by: d.created_by, created_at: d.created_at, opened_at: d.opened_at, opened_by: d.opened_by,
      last_chased_at: day(d.last_chased_at), chase_count: d.chase_count,
      closed_at: d.closed_at, closed_by: d.closed_by, close_reason: d.close_reason, updated_at: d.updated_at,
    };
    return { ...base, vat: docs.vatFlag(base, threshold) };
  };
  const uploadView = (u) => ({
    id: u.id, file_name: u.file_name, content_type: u.content_type, size_bytes: u.size_bytes,
    uploaded_by: u.uploaded_by, uploaded_at: u.uploaded_at, read_state: u.read_state, read_error: u.read_error,
    read_at: u.read_at, read_with: u.read_with, line_count: u.line_count, file_deleted_at: u.bytes_cleared_at,
  });
  const UPLOAD_COLUMNS = "id, file_name, content_type, size_bytes, uploaded_by, uploaded_at, read_state, read_error, read_at, read_with, line_count, bytes_cleared_at";

  // ── The register ──────────────────────────────────────────────────────────

  // GET /outstanding-documents?state=live|all   live: candidates and open
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const all = req.query.state === "all";
    let rows, uploads, threshold;
    try {
      threshold = await thresholdOf(pool, client.id);
      rows = (await pool.query(
        `${ITEM_SELECT} WHERE d.client_id = $1 ${all ? "" : "AND d.state IN ('candidate', 'open')"}
          ORDER BY d.txn_date DESC, d.created_at DESC LIMIT 5000`, [client.id])).rows;
      uploads = (await pool.query(
        `SELECT ${UPLOAD_COLUMNS} FROM finance.document_uploads WHERE client_id = $1 ORDER BY uploaded_at DESC LIMIT 200`, [client.id])).rows;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return res.json({ migration_missing: true, items: [], uploads: [], companies: [], summary: docs.summary([]), threshold: docs.DEFAULT_THRESHOLD, concerns: docs.CONCERNS });
    }
    const items = rows.map((r) => itemView(r, threshold));
    const companies = (await entitiesOf(pool, client.id)).map((e) => ({ slug: e.slug, name: e.name }));
    res.json({
      items, uploads: uploads.map(uploadView), threshold, concerns: docs.CONCERNS, companies,
      summary: docs.summary(items, { threshold }),
    });
  }));

  // PATCH /outstanding-documents/settings   body: { vat_threshold }   CFO only
  app.patch(`${BASE}/settings`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const t = docs.amountOf(req.body?.vat_threshold);
    if (t == null || t < 0 || t > 100000) return res.status(422).json({ issues: ["vat_threshold must be an amount of 0 or more"] });
    send(res, await tx(client, who, async (conn, w) => {
      if (!docs.isCfo(w.role)) return { status: 403, body: { error: "only the CFO sets the VAT threshold" } };
      const r = await conn.query("UPDATE finance.client_finance_config SET doc_vat_threshold = $2 WHERE client_id = $1 RETURNING doc_vat_threshold", [client.id, t]);
      if (!r.rowCount) return { status: 404, body: { error: "this client has no finance set-up" } };
      await log(conn, req, { client, ...w, action: "outstanding_docs_threshold", targetType: "client", id: client.id, payload: { vat_threshold: t } });
      return { status: 200, body: { threshold: Number(r.rows[0].doc_vat_threshold) } };
    }));
  }));

  // POST /outstanding-documents   body: { entity, txn_date, payee, amount, currency?, amount_gbp?, direction?, bank_account?, reference?, concern?, note? }
  app.post(BASE, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const entities = await entitiesOf(pool, client.id);
    const { line, issues } = docs.newItemInput(req.body || {}, entities);
    if (issues.length) return res.status(422).json({ issues });
    send(res, await tx(client, who, async (conn, w) => {
      const twin = (await conn.query(
        `SELECT id, state, txn_date, direction, amount, currency, payee FROM finance.outstanding_documents
          WHERE client_id = $1 AND txn_date = $2 AND amount = $3 AND state IN ('candidate', 'open', 'received', 'accepted')`,
        [client.id, line.txn_date, line.amount])).rows.find((x) => docs.dupKey({ ...x, txn_date: day(x.txn_date) }) === docs.dupKey(line));
      if (twin && req.body?.allow_duplicate !== true) return { status: 409, body: { error: `This transaction is already on the register (${twin.state})`, duplicate_of: twin.id } };
      const r = await conn.query(
        `INSERT INTO finance.outstanding_documents
           (client_id, entity_id, bank_account, txn_date, payee, reference, direction, amount, currency, amount_gbp, concern, note,
            state, source, created_by, opened_at, opened_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open','person',$13, now(), $13) RETURNING id`,
        [client.id, line.entity_id, line.bank_account, line.txn_date, line.payee, line.reference, line.direction, line.amount,
          line.currency, line.amount_gbp, line.concern, line.note, w.actorEmail]);
      const id = r.rows[0].id;
      await log(conn, req, { client, ...w, action: "outstanding_doc_added", id, payload: { ...line } });
      return { status: 201, body: { id } };
    }));
  }));

  // ── Uploads ───────────────────────────────────────────────────────────────

  // POST /outstanding-documents/uploads   raw body, X-File-Name header
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
    if (bytes.length > docs.MAX_UPLOAD_BYTES) return res.status(413).json({ issues: [`${fileName} is over ${docs.MAX_UPLOAD_BYTES / 1048576} MB`] });
    const kind = sheets.kindOf(bytes, fileName, req.get("Content-Type") || "");
    if (kind === "xls") return res.status(422).json({ issues: [`${fileName} is an old Excel (.xls) file: save it as .xlsx and upload again`] });
    if (!kind) return res.status(422).json({ issues: [`${fileName} is not a PDF, an Excel workbook (.xlsx) or a CSV`] });
    const contentType = { pdf: "application/pdf", xlsx: sheets.XLSX_TYPE, csv: "text/csv" }[kind];
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    send(res, await tx(client, who, async (conn, w) => {
      const had = (await conn.query(`SELECT ${UPLOAD_COLUMNS} FROM finance.document_uploads WHERE client_id = $1 AND sha256 = $2`, [client.id, sha256])).rows[0];
      if (had) return { status: 200, body: { upload: uploadView(had), already: true } };
      const r = await conn.query(
        `INSERT INTO finance.document_uploads (client_id, file_name, content_type, size_bytes, sha256, bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${UPLOAD_COLUMNS}`,
        [client.id, fileName, contentType, bytes.length, sha256, bytes, w.actorEmail]);
      await log(conn, req, { client, ...w, action: "outstanding_docs_uploaded", targetType: "document_upload", id: r.rows[0].id, payload: { file_name: fileName, size_bytes: bytes.length, sha256 } });
      return { status: 201, body: { upload: uploadView(r.rows[0]), already: false } };
    }));
  }));

  // POST /outstanding-documents/uploads/:id/read
  // Reads the file into candidate lines. Runs while the caller waits (a minute
  // or so); the page reads files one or two at a time.
  app.post(`${BASE}/uploads/:id/read`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: "no such upload" });
    const role = (await pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, who.actorEmail])).rows[0].role;
    if (!role) return res.status(403).json({ error: `${who.actorEmail} holds no engagement role for this client` });

    // Claim it: one read at a time per file.
    const claimed = (await pool.query(
      `UPDATE finance.document_uploads SET read_state = 'reading', read_error = NULL, read_by = $3, read_at = now()
        WHERE id = $1 AND client_id = $2 AND bytes IS NOT NULL
          AND (read_state IN ('waiting', 'failed')
               OR (read_state = 'reading' AND read_at < now() - make_interval(mins => $4)))
        RETURNING id, file_name, content_type, bytes`,
      [req.params.id, client.id, who.actorEmail, STALE_READ_MINUTES])).rows[0];
    if (!claimed) {
      const u = (await pool.query(`SELECT ${UPLOAD_COLUMNS} FROM finance.document_uploads WHERE id = $1 AND client_id = $2`, [req.params.id, client.id])).rows[0];
      if (!u) return res.status(404).json({ error: "no such upload" });
      return res.status(409).json({ error: u.read_state === "reading" ? "This file is being read now" : "This file has been read and its contents deleted; its lines are on the page", upload: uploadView(u) });
    }

    const entities = await entitiesOf(pool, client.id);
    let parsed, readWith, truncated = false;
    try {
      const kind = sheets.kindOf(claimed.bytes, claimed.file_name, claimed.content_type);
      let sheetText = null;
      if (kind === "xlsx" || kind === "csv") {
        const out = sheets.sheetsAsText(sheets.readSheets(claimed.bytes, kind));
        if (!out.text.replace(/^===.*$/gm, "").trim()) throw new Error("the spreadsheet has no rows");
        sheetText = out.text;
        truncated = out.truncated;
      } else if (kind !== "pdf") throw new Error("this file type cannot be read");
      const answer = await generate(docs.buildReadRequest({ kind, bytes: claimed.bytes, sheetText, fileName: claimed.file_name, entities }));
      readWith = `${answer.model ?? "model"} ${answer.location ?? ""}`.trim();
      parsed = docs.placeByOrganisation(docs.parseRead(answer.text, entities), entities);
    } catch (e) {
      const message = String(e.message || e).slice(0, 500);
      await pool.query("UPDATE finance.document_uploads SET read_state = 'failed', read_error = $2 WHERE id = $1", [claimed.id, message]);
      return res.status(e.httpStatus === 502 ? 502 : 422).json({ error: `${claimed.file_name} could not be read: ${message}` });
    }

    const out = await tx(client, who, async (conn, w) => {
      const existing = (await conn.query(
        `SELECT id, state, txn_date, direction, amount, currency, payee FROM finance.outstanding_documents
          WHERE client_id = $1 AND state IN ('candidate', 'open', 'received', 'accepted')`, [client.id])).rows
        .map((x) => ({ ...x, txn_date: day(x.txn_date) }));
      const lines = docs.markDuplicates(parsed.lines, existing);
      const ids = [];
      for (const l of lines) {
        const r = await conn.query(
          `INSERT INTO finance.outstanding_documents
             (client_id, entity_id, bank_account, txn_date, payee, reference, direction, amount, currency, amount_gbp, concern, note,
              state, source, upload_id, source_line, duplicate_of, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'candidate','upload',$13,$14,$15,$16) RETURNING id`,
          [client.id, l.entity_id, l.bank_account, l.txn_date, l.payee, l.reference, l.direction, l.amount, l.currency, l.amount_gbp,
            l.concern, l.note, claimed.id, l.source_line, /^[0-9a-f-]{36}$/i.test(String(l.duplicate_of)) ? l.duplicate_of : null, w.actorEmail]);
        ids.push(r.rows[0].id);
      }
      const u = (await conn.query(
        `UPDATE finance.document_uploads SET read_state = 'read', read_error = NULL, read_with = $2, line_count = $3, read_at = now(),
                bytes = NULL, bytes_cleared_at = now()
          WHERE id = $1 RETURNING ${UPLOAD_COLUMNS}`, [claimed.id, readWith, lines.length])).rows[0];
      await log(conn, req, {
        client, ...w, action: "outstanding_docs_read", targetType: "document_upload", id: claimed.id,
        payload: { lines: lines.length, duplicates: lines.filter((l) => l.duplicate_of).length, skipped: parsed.skipped.length, report: parsed.report, read_with: readWith, file_deleted: true },
      });
      return {
        status: 200,
        body: {
          upload: uploadView(u), report: parsed.report, lines: lines.length,
          duplicates: lines.filter((l) => l.duplicate_of).length, unplaced: lines.filter((l) => !l.entity_id).length,
          skipped: parsed.skipped, truncated,
        },
      };
    });
    if (out.status >= 400) await pool.query("UPDATE finance.document_uploads SET read_state = 'failed', read_error = $2 WHERE id = $1", [claimed.id, out.body?.error ?? "not saved"]);
    send(res, out);
  }));

  // ── One item ──────────────────────────────────────────────────────────────

  // Loads the item locked, runs the step's checks, applies it, logs it.
  async function step(req, res, name, apply) {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: "no such item" });
    const entities = await entitiesOf(pool, client.id);
    send(res, await tx(client, who, async (conn, w) => {
      const item = (await conn.query("SELECT * FROM finance.outstanding_documents WHERE id = $1 AND client_id = $2 FOR UPDATE", [req.params.id, client.id])).rows[0];
      if (!item) return { status: 404, body: { error: "no such item" } };
      return apply(conn, w, { client, item, entities });
    }));
  }

  // The state of the live item this one repeats, if any.
  async function liveTwin(conn, item) {
    const rows = (await conn.query(
      `SELECT id, state, txn_date, direction, amount, currency, payee FROM finance.outstanding_documents
        WHERE client_id = $1 AND id <> $2 AND txn_date = $3 AND amount = $4 AND state IN ('open', 'received', 'accepted')`,
      [item.client_id, item.id, item.txn_date, item.amount])).rows;
    const key = docs.dupKey({ ...item, txn_date: day(item.txn_date) });
    return rows.find((x) => docs.dupKey({ ...x, txn_date: day(x.txn_date) }) === key) ?? null;
  }

  async function applyStep(conn, req, w, { client, item }, name, body = req.body || {}) {
    const twin = name === "accept" ? await liveTwin(conn, item) : null;
    const issues = docs.stepIssues(name, item, { role: w.role, reason: body.reason, allowDuplicate: body.allow_duplicate === true, duplicateState: twin?.state ?? null });
    if (issues.length) return { status: 422, body: { issues } };
    const to = docs.stepTarget(name, item);
    const sets = ["state = $3", "updated_at = now()"];
    const vals = [item.id, client.id, to];
    const add = (sql, v) => { vals.push(v); sets.push(sql.replace("?", `$${vals.length}`)); };
    if (name === "accept") { add("opened_at = now(), opened_by = ?", w.actorEmail); }
    if (["dismiss", "received", "accept_without"].includes(name)) {
      add("closed_at = now(), closed_by = ?", w.actorEmail);
      add("close_reason = ?", String(body.reason ?? body.note ?? "").trim().slice(0, docs.MAX_NOTE) || null);
    }
    if (name === "reopen") sets.push("closed_at = NULL", "closed_by = NULL", "close_reason = NULL");
    if (name === "chased") sets.push("chase_count = chase_count + 1", "last_chased_at = CURRENT_DATE");
    await conn.query(`UPDATE finance.outstanding_documents SET ${sets.join(", ")} WHERE id = $1 AND client_id = $2`, vals);
    await log(conn, req, { client, ...w, action: `outstanding_doc_${name}`, id: item.id, payload: { from: item.state, to, reason: body.reason ?? body.note ?? null } });
    return { status: 200, body: { id: item.id, state: to } };
  }

  // PATCH /outstanding-documents/:id   the fields of editInput
  app.patch(`${BASE}/:id`, tolerant(async (req, res) => step(req, res, "edit", async (conn, w, ctx) => {
    const { set, issues } = docs.editInput(req.body, ctx.entities);
    const stop = docs.stepIssues("edit", ctx.item, { role: w.role });
    if (stop.length || issues.length) return { status: 422, body: { issues: [...stop, ...issues] } };
    if (!Object.keys(set).length) return { status: 422, body: { issues: ["nothing to change"] } };
    if (ctx.item.state === "open" && "entity_id" in set && !set.entity_id) return { status: 422, body: { issues: ["an item on the register keeps its company"] } };
    const cols = Object.keys(set);
    await conn.query(
      `UPDATE finance.outstanding_documents SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")}, updated_at = now() WHERE id = $1 AND client_id = $2`,
      [ctx.item.id, ctx.client.id, ...cols.map((c) => set[c])]);
    const before = Object.fromEntries(cols.map((c) => [c, ctx.item[c] instanceof Date ? day(ctx.item[c]) : ctx.item[c]]));
    await log(conn, req, { client: ctx.client, ...w, action: "outstanding_doc_edited", id: ctx.item.id, payload: { before, after: set } });
    return { status: 200, body: { id: ctx.item.id } };
  })));

  // POST /outstanding-documents/:id/:step   accept | dismiss | received | accept-without | reopen | chased
  for (const name of ["accept", "dismiss", "received", "accept_without", "reopen", "chased"]) {
    app.post(`${BASE}/:id/${name.replace("_", "-")}`, tolerant(async (req, res) => step(req, res, name, (conn, w, ctx) => applyStep(conn, req, w, ctx, name))));
  }

  // POST /outstanding-documents/bulk   body: { step: accept|dismiss, ids: [...] }
  // Each item checked on its own; the ones that fail come back with why.
  app.post(`${BASE}/bulk`, tolerant(async (req, res) => {
    const who = person(req, res);
    if (!who) return;
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const name = req.body?.step;
    if (!["accept", "dismiss"].includes(name)) return res.status(422).json({ issues: ["step must be accept or dismiss"] });
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length || ids.length > 1000) return res.status(422).json({ issues: ["give between 1 and 1,000 item ids"] });
    send(res, await tx(client, who, async (conn, w) => {
      const items = (await conn.query("SELECT * FROM finance.outstanding_documents WHERE client_id = $1 AND id = ANY($2::uuid[]) ORDER BY txn_date FOR UPDATE", [client.id, ids])).rows;
      const done = [], refused = [];
      for (const item of items) {
        const out = await applyStep(conn, req, w, { client, item }, name, { reason: req.body?.reason });
        if (out.status === 200) done.push(item.id); else refused.push({ id: item.id, payee: item.payee, issues: out.body.issues });
      }
      return { status: 200, body: { done, refused, missing: ids.length - items.length } };
    }));
  }));
}

module.exports = { mountOutstandingDocs };
