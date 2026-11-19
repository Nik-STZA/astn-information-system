// Loads a client's accruals history from before os.stza.io (docs/accruals-spec.md
// section 9): the CFO's decisions as precedents, the accruals account per
// company, the schedule items, the pairs already posted in Xero by hand, and the
// client rules to draft. The data is a JSON file kept with the client's own
// records, not in this repository (client names stay out of it).
//
// Dry run by default: it prints what it would write and writes nothing.
//   node scripts/accruals-backload.js <file.json>            dry run
//   node scripts/accruals-backload.js <file.json> --apply    writes, in one transaction
// The connection comes from DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
// (the Cloud SQL Auth Proxy for the live database). Re-runnable: anything
// already there is left alone and reported as kept.
//
// File shape:
//   { client, decided_by,
//     settings:   [{ entity, account_code }],
//     precedents: [{ entity, supplier, test, decision, reason, applies_to, period, decided_at }],
//     items:      [{ entity, supplier, contact_id?, lines: [{ account_code, amount }], period_from, standing,
//                    end_period?, bill_lag_months, basis_kind, basis,
//                    posted: [{ period, narration?, accrual_xero, reversal_xero, posted_on }] }],
//     rules:      ["one line each, drafted as the client's addition to accruals-and-prepayments"] }

const acc = require("../lib/accruals");
const procedureRules = require("../lib/procedure-rules");

const PROCEDURE = "accruals-and-prepayments";

function fileIssues(d) {
  const issues = [];
  if (!d || typeof d !== "object") return ["the file is not a JSON object"];
  if (!d.client) issues.push("client is required");
  if (!d.decided_by || !/@/.test(d.decided_by)) issues.push("decided_by must be the CFO's email");
  for (const [i, p] of (d.precedents ?? []).entries()) {
    if (!["accept", "accept_edited", "no_accrual", "standing"].includes(p.decision)) issues.push(`precedent ${i + 1}: decision`);
    if (p.decision === "no_accrual" && !p.reason) issues.push(`precedent ${i + 1}: a no-accrual precedent needs its reason`);
    if (!acc.isPeriod(p.period)) issues.push(`precedent ${i + 1}: period`);
    if (!["this_month", "until_changed"].includes(p.applies_to ?? "this_month")) issues.push(`precedent ${i + 1}: applies_to`);
  }
  for (const [i, it] of (d.items ?? []).entries()) {
    if (!acc.isPeriod(it.period_from)) issues.push(`item ${i + 1}: period_from`);
    if (!Array.isArray(it.lines) || !it.lines.length || it.lines.some((l) => !(Number(l.amount) > 0) || !l.account_code)) issues.push(`item ${i + 1}: lines must be positive costs with codes`);
    for (const p of it.posted ?? []) if (!acc.isPeriod(p.period) || !acc.accruesIn({ ...it, standing: Boolean(it.standing) }, p.period)) issues.push(`item ${i + 1}: posted month ${p.period} is not one it accrues in`);
  }
  return issues;
}

// Writes the file's contents for one client, in the transaction given.
// Returns what it did (or would do, without apply), line by line.
async function applyBackload(conn, d, { apply = false, library } = {}) {
  const issues = fileIssues(d);
  if (issues.length) throw new Error(`The file has problems: ${issues.join("; ")}`);
  const said = [];
  const client = (await conn.query("SELECT id FROM shared.clients WHERE slug = $1", [d.client])).rows[0];
  if (!client) throw new Error(`no client ${d.client}`);
  const entities = (await conn.query("SELECT id, slug, name FROM finance.entities WHERE client_id = $1", [client.id])).rows;
  const entity = (slug) => {
    const e = entities.find((x) => x.slug === slug);
    if (!e) throw new Error(`no company ${slug} for ${d.client}`);
    return e;
  };
  const write = async (sql, args) => (apply ? (await conn.query(sql, args)).rows : [{ id: "(dry run)" }]);

  for (const s of d.settings ?? []) {
    const e = entity(s.entity);
    const cur = (await conn.query("SELECT account_code FROM finance.accrual_settings WHERE client_id = $1 AND entity_id = $2", [client.id, e.id])).rows[0];
    if (cur) { said.push(`kept: ${e.name} accruals account ${cur.account_code}`); continue; }
    await write("INSERT INTO finance.accrual_settings (client_id, entity_id, account_code, set_by) VALUES ($1,$2,$3,$4)", [client.id, e.id, String(s.account_code), d.decided_by]);
    said.push(`set: ${e.name} accruals account ${s.account_code}`);
  }

  for (const p of d.precedents ?? []) {
    const e = entity(p.entity);
    const cur = (await conn.query(
      "SELECT id FROM finance.accrual_precedents WHERE client_id = $1 AND entity_id = $2 AND lower(supplier) = lower($3) AND period = $4 AND decision = $5",
      [client.id, e.id, p.supplier, p.period, p.decision])).rows[0];
    if (cur) { said.push(`kept: precedent ${p.supplier} ${p.period} ${p.decision}`); continue; }
    await write(
      `INSERT INTO finance.accrual_precedents (client_id, entity_id, supplier, contact_id, test, decision, reason, applies_to, period, facts, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [client.id, e.id, p.supplier, p.contact_id ?? null, p.test ?? null, p.decision, p.reason ?? null, p.applies_to ?? "this_month", p.period,
        JSON.stringify({ service_month: p.period, amount: p.amount ?? null, basis_kind: p.basis_kind ?? null, loaded: "back-load" }), d.decided_by, p.decided_at ?? new Date().toISOString()]);
    said.push(`precedent: ${e.name}, ${p.supplier}, ${p.period}, ${p.decision} (${p.applies_to ?? "this_month"})`);
  }

  const settings = apply || !(d.settings ?? []).length
    ? (await conn.query("SELECT entity_id, account_code FROM finance.accrual_settings WHERE client_id = $1", [client.id])).rows
    : (d.settings ?? []).map((s) => ({ entity_id: entity(s.entity).id, account_code: String(s.account_code) }));
  for (const it of d.items ?? []) {
    const e = entity(it.entity);
    const lines = acc.cleanLines(it.lines);
    const amount = lines.reduce((a, l) => a + Math.round(l.amount * 100), 0) / 100;
    let item = (await conn.query(
      "SELECT *, amount::text AS amount FROM finance.accrual_items WHERE client_id = $1 AND entity_id = $2 AND lower(supplier) = lower($3) AND period_from = $4",
      [client.id, e.id, it.supplier, it.period_from])).rows[0];
    if (item) said.push(`kept: item ${it.supplier} from ${it.period_from}`);
    else {
      item = (await write(
        `INSERT INTO finance.accrual_items (client_id, entity_id, supplier, contact_id, lines, amount, period_from, standing, end_period, bill_lag_months, basis_kind, basis, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *, amount::text AS amount`,
        [client.id, e.id, it.supplier, it.contact_id ?? null, JSON.stringify(lines), amount.toFixed(2), it.period_from, Boolean(it.standing), it.end_period ?? null,
          it.bill_lag_months ?? 1, it.basis_kind ?? null, it.basis ?? null, d.decided_by]))[0];
      if (!apply) item = { ...it, id: "(dry run)", entity_id: e.id, lines, amount: amount.toFixed(2), standing: Boolean(it.standing) };
      said.push(`item: ${e.name}, ${it.supplier}, ${amount.toFixed(2)} ${it.standing ? `a month from ${it.period_from}` : `for ${it.period_from}`}`);
    }
    const account = acc.accrualAccountFor({ settings, entityId: e.id });
    for (const p of it.posted ?? []) {
      if (!account) throw new Error(`${e.name} has no accruals account in the file or the database`);
      const have = apply && (await conn.query(
        "SELECT id FROM finance.journals WHERE accrual_item_id = $1 AND period = $2 AND source = 'accrual' AND state IN ('proposed','approved','draft_created','posted')", [item.id, p.period])).rows[0];
      if (have) { said.push(`kept: pair ${it.supplier} ${p.period}`); continue; }
      const j = acc.pairFor({ item, period: p.period, accrualAccount: account });
      const narration = p.narration && p.narration.length < acc.MAX_NARRATION ? p.narration : j.narration;
      const reason = `Posted in Xero outside os.stza.io on ${acc.longDate(p.posted_on)} (Xero ${p.accrual_xero} and ${p.reversal_xero}); loaded from the accruals review.`;
      await write(
        `INSERT INTO finance.journals (client_id, entity_id, period, journal_date, narration, lines, reason, source, proposed_by, state, approved_by, approved_at,
                                       xero_status, reversal_xero_status, accrual_item_id, reversal_date, drafted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'accrual','backload','posted',$8,$9,'POSTED','POSTED',$10,$11,$9)`,
        [client.id, e.id, p.period, j.journal_date, narration, JSON.stringify(j.lines), reason, d.decided_by, `${p.posted_on}T09:00:00Z`, item.id, j.reversal_date]);
      said.push(`pair, posted: ${e.name}, ${narration}, ${j.journal_date} and ${j.reversal_date}`);
    }
  }

  if ((d.rules ?? []).length) {
    const cur = (await conn.query(
      "SELECT id, procedure, kind, title, summary, body, roles, version, status FROM finance.client_procedures WHERE client_id = $1 AND procedure = $2 AND kind = 'addition' AND status <> 'retired'",
      [client.id, PROCEDURE])).rows[0];
    const fresh = d.rules.filter((r) => !String(cur?.body ?? "").includes(r));
    if (!fresh.length) said.push("kept: client rules already in the accruals addition");
    else if (cur) {
      const { set, issues } = procedureRules.ruleChanges({ body: `${cur.body.trimEnd()}\n${fresh.map((r) => `- ${r}`).join("\n")}` }, cur, library());
      if (issues.length) throw new Error(issues.join("; "));
      const keys = Object.keys(set);
      await write(`UPDATE finance.client_procedures SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [cur.id, ...keys.map((k) => set[k])]);
      said.push(`rules: ${fresh.length} added to the accruals addition, as a draft for the CFO to approve`);
    } else {
      const { set, issues } = procedureRules.ruleChanges({
        procedure: PROCEDURE, kind: "addition", title: "Accrual rules", summary: "This client's accrual rules, set by the CFO.",
        body: `This client's accrual rules:\n${fresh.map((r) => `- ${r}`).join("\n")}`,
      }, null, library());
      if (issues.length) throw new Error(issues.join("; "));
      const cols = ["client_id", "created_by", ...Object.keys(set)];
      await write(`INSERT INTO finance.client_procedures (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, [client.id, d.decided_by, ...Object.values(set)]);
      said.push(`rules: drafted the accruals addition with ${fresh.length} rule${fresh.length === 1 ? "" : "s"}, for the CFO to approve on the Procedures page`);
    }
  }
  return said;
}

module.exports = { applyBackload, fileIssues };

if (require.main === module) {
  (async () => {
    const [file, flag] = process.argv.slice(2);
    if (!file) { console.error("usage: node scripts/accruals-backload.js <file.json> [--apply]"); process.exit(2); }
    const data = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const { Pool } = require("pg");
    const pool = new Pool({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const conn = await pool.connect();
    const apply = flag === "--apply";
    try {
      await conn.query("BEGIN");
      const said = await applyBackload(conn, data, { apply, library: () => require("../lib/agent-procedures").library() });
      await conn.query(apply ? "COMMIT" : "ROLLBACK");
      console.log(said.join("\n"));
      console.log(apply ? "\nWritten." : "\nDry run: nothing was written. Add --apply to write.");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      console.error(e.message);
      process.exitCode = 1;
    } finally {
      conn.release();
      await pool.end();
    }
  })();
}
