// Read-only: what one client's Accruals and VAT reconciliations hold for a
// month, to see why they do not tie. Writes nothing.
//   node scripts/rec-check.mjs <client slug> <YYYY-MM>
import { connect } from "./db.mjs";

const [slug, period] = process.argv.slice(2);
if (!slug || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")) {
  console.error("usage: node scripts/rec-check.mjs <client slug> <YYYY-MM>");
  process.exit(1);
}
const { client: db, release } = await connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
try {
  await db.query("BEGIN READ ONLY");
  const [client] = await q("SELECT id FROM shared.clients WHERE slug = $1", [slug]);
  if (!client) throw new Error(`no client ${slug}`);
  const names = new Map((await q("SELECT id, slug FROM finance.entities WHERE client_id = $1", [client.id])).map((e) => [e.id, e.slug]));
  const recs = await q(
    `SELECT r.id, a.account_key, a.account_name, a.line_key AS account_line, a.proof AS account_proof, r.line_key, r.proof, r.status, r.dropped_at
       FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
      WHERE r.client_id = $1 AND r.period = $2
        AND (r.line_key IN ('accruals', 'vat') OR a.line_key IN ('accruals', 'vat') OR a.account_name ~* 'accru|\\mvat\\M')
      ORDER BY a.account_name`, [client.id, period]);
  for (const r of recs) {
    console.log(`\n== ${r.account_name} (${r.account_key}) status ${r.status}${r.dropped_at ? " DROPPED" : ""}`);
    console.log(`   line: rec ${r.line_key ?? "none"} / account ${r.account_line ?? "none"}; proof: rec ${r.proof} / account ${r.account_proof}`);
    for (const b of await q("SELECT entity_id, account_code, account_name, opening, closing, movement FROM finance.rec_balances WHERE rec_id = $1", [r.id])) {
      console.log(`   ledger ${names.get(b.entity_id)} ${b.account_code} ${b.account_name}: opening ${b.opening}, closing ${b.closing}`);
    }
    for (const e of await q("SELECT entity_id, kind, method, amount, left(source, 160) AS source, added_by, added_at FROM finance.rec_evidence WHERE rec_id = $1 ORDER BY added_at", [r.id])) {
      console.log(`   evidence ${names.get(e.entity_id)} ${e.kind}/${e.method ?? "keyed"} ${e.amount} by ${e.added_by} ${e.added_at.toISOString().slice(0, 16)}: ${e.source}`);
    }
    for (const i of await q("SELECT entity_id, side, kind, amount, state, source, left(description, 120) AS description, added_by FROM finance.rec_reconciling_items WHERE rec_id = $1 ORDER BY added_at", [r.id])) {
      console.log(`   item ${names.get(i.entity_id)} ${i.side} ${i.kind} ${i.amount} ${i.state} (${i.source}, ${i.added_by}): ${i.description ?? ""}`);
    }
    for (const ev of await q("SELECT at, actor, action, left(detail::text, 160) AS detail FROM finance.rec_events WHERE rec_id = $1 ORDER BY at DESC LIMIT 6", [r.id])) {
      console.log(`   event ${ev.at.toISOString().slice(0, 16)} ${ev.actor} ${ev.action} ${ev.detail}`);
    }
  }
  if (!recs.length) console.log("No Accruals or VAT reconciliation for that month.");

  console.log("\n== Accruals schedule");
  for (const i of await q("SELECT entity_id, supplier, amount, period_from, standing, end_period, stopped_period FROM finance.accrual_items WHERE client_id = $1 ORDER BY period_from", [client.id])) {
    console.log(`   ${names.get(i.entity_id)} ${i.supplier} ${i.amount} from ${i.period_from}${i.standing ? " standing" : ""}${i.end_period ? ` to ${i.end_period}` : ""}${i.stopped_period ? ` stopped ${i.stopped_period}` : ""}`);
  }
  for (const s of await q("SELECT entity_id, account_code FROM finance.accrual_settings WHERE client_id = $1", [client.id])) {
    console.log(`   accruals account for ${names.get(s.entity_id)}: ${s.account_code}`);
  }
  console.log("\n== Journals for the month (accruals and VAT)");
  for (const j of await q(
    `SELECT jnl_no, source, state, entity_id, journal_date, left(narration, 80) AS narration FROM finance.journals
      WHERE client_id = $1 AND period = $2 AND source IN ('accrual', 'vat') ORDER BY jnl_no`, [client.id, period])) {
    console.log(`   JNL-${j.jnl_no} ${j.source} ${j.state} ${names.get(j.entity_id)} ${j.journal_date}: ${j.narration}`);
  }
  await db.query("ROLLBACK");
} finally {
  await release();
}
