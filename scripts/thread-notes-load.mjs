// Loads notes onto accounts' threads from a JSON file kept in the client's
// folder: working papers done outside os.stza.io (a VAT roll-forward, an
// accruals review) whose findings the agents should read before they call a
// difference unexplained. The reconciliation history (GET /recs/:id/history)
// and the rec page read an account's thread for its month.
//
// Dry run by default; --apply writes. Re-running skips a note already on the
// thread (same account, month and text).
//   node scripts/thread-notes-load.mjs <file.json> --by <email> [--apply]
//
// The file:
//   { "client": "<slug>",
//     "notes": [ { "entity": "<company slug>", "account": "<code>", "period": "YYYY-MM",
//                  "kind": "note" | "finding", "body": "<text>" } ] }
import { readFileSync } from "node:fs";
import { connect } from "./db.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const by = args[args.indexOf("--by") + 1];
const apply = args.includes("--apply");
if (!file || args.indexOf("--by") < 0 || !by) {
  console.error("usage: node scripts/thread-notes-load.mjs <file.json> --by <email> [--apply]");
  process.exit(1);
}
const f = JSON.parse(readFileSync(file, "utf8"));
const issues = [];
for (const [i, n] of (f.notes ?? []).entries()) {
  if (!n.entity || !/^[A-Za-z0-9.-]{1,20}$/.test(String(n.account ?? ""))) issues.push(`note ${i + 1}: entity and account code are needed`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(n.period ?? ""))) issues.push(`note ${i + 1}: period must be YYYY-MM`);
  if (!["note", "finding"].includes(n.kind ?? "note")) issues.push(`note ${i + 1}: kind is note or finding`);
  if (!String(n.body ?? "").trim()) issues.push(`note ${i + 1}: body is empty`);
}
if (!f.client || !(f.notes ?? []).length) issues.push("client and at least one note are needed");
if (issues.length) { console.error(issues.join("\n")); process.exit(1); }

const { client: db, release } = await connect();
try {
  await db.query("BEGIN");
  const client = (await db.query("SELECT id FROM shared.clients WHERE slug = $1", [f.client])).rows[0];
  if (!client) throw new Error(`no client ${f.client}`);
  const role = (await db.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, by])).rows[0].role;
  if (!role) throw new Error(`${by} holds no engagement role for ${f.client}`);
  let added = 0;
  for (const n of f.notes) {
    const e = (await db.query("SELECT id FROM finance.entities WHERE client_id = $1 AND slug = $2", [client.id, n.entity])).rows[0];
    if (!e) throw new Error(`no company ${n.entity}`);
    const key = `${e.id}:${n.account}`;
    const body = String(n.body).trim();
    const there = (await db.query(
      "SELECT 1 FROM finance.thread_entries WHERE client_id = $1 AND subject_kind = 'account' AND subject_key = $2 AND period = $3 AND body = $4",
      [client.id, key, n.period, body])).rows.length;
    console.log(`${there ? "already there" : apply ? "adding" : "would add"}: ${n.entity} ${n.account} ${n.period} (${n.kind ?? "note"}, ${body.length} characters)`);
    if (there || !apply) continue;
    await db.query(
      `INSERT INTO finance.thread_entries (client_id, subject_kind, subject_key, period, kind, body, author_email, actor_role)
       VALUES ($1,'account',$2,$3,$4,$5,$6,$7)`, [client.id, key, n.period, n.kind ?? "note", body, by, role]);
    added++;
  }
  await db.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(apply ? `\n${added} added.` : "\nDry run: nothing written. Add --apply to write.");
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await release();
}
