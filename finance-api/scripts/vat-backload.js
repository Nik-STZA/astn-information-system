// Loads VAT returns filed before os.stza.io from HMRC's own record: the pages
// a person saves from "Manage your VAT account" on GOV.UK (each submitted
// return, and the payment history for each year), as text (.md or .txt).
// Nothing is typed by hand: the boxes, the date filed and HMRC's payments come
// from those pages (lib/hmrc-vat-printout.js), checked as they are read.
//
// Each return is held as filed (status submitted, or paid once HMRC's payment
// history shows the repayment), with history_note saying where it came from.
// Its clearing was done by hand at the time, so the return page offers none,
// and the members hold nothing for it on their VAT recs (lib/vat-evidence.js).
// A return already in os.stza.io is left alone, and its boxes are compared
// with HMRC's as a check.
//
// Dry run by default.
//   node scripts/vat-backload.js <folder> --client <slug> --from 2025-10 --by <cfo email> [--apply]
// The connection comes from DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.

const fs = require("fs");
const path = require("path");
const { parseSubmittedReturn, parsePaymentHistory } = require("../lib/hmrc-vat-printout");

const pence = (n) => Math.round(Number(n || 0) * 100);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const BOXES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// The pages in a folder, read and checked. Returns { returns, payments, problems }.
function readFolder(folder) {
  const returns = [];
  const payments = [];
  const problems = [];
  for (const f of fs.readdirSync(folder).filter((x) => /\.(md|txt)$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(folder, f), "utf8");
    if (/^Submitted return/i.test(f)) {
      const r = parseSubmittedReturn(text);
      if (r.ok) returns.push({ ...r, file: f }); else problems.push(`${f}: ${r.issues.join("; ")}`);
    } else if (/^Payment history/i.test(f)) {
      const year = Number(/(\d{4})/.exec(f)?.[1]);
      const h = parsePaymentHistory(text, year);
      if (h.ok) payments.push(...h.rows.map((row) => ({ ...row, file: f })));
      else problems.push(`${f}: ${h.issues.join("; ")}`);
    }
  }
  return { returns, payments, problems };
}

// What to write for each return from `from` on, against what is already held.
//   held  [{ id, period_start, period_end, submitted_boxes }]
function plan({ returns, payments, held, from }) {
  const out = [];
  for (const r of returns.filter((x) => x.period_start.slice(0, 7) >= from).sort((a, b) => a.period_start.localeCompare(b.period_start))) {
    const name = `${longDate(r.period_start)} to ${longDate(r.period_end)}`;
    const have = held.find((h) => h.period_start === r.period_start && h.period_end === r.period_end);
    if (have) {
      const differ = BOXES.filter((b) => have.submitted_boxes && pence(Math.abs(have.submitted_boxes[b] ?? 0)) !== pence(Math.abs(r.boxes[b])));
      out.push({ kind: "kept", name, note: differ.length ? `HMRC's boxes ${differ.join(", ")} differ from those recorded here: check` : "already here; HMRC's boxes agree" });
      continue;
    }
    const expected = pence(r.boxes[4]) - pence(r.boxes[3]);
    const pay = payments.find((p) => p.period_start === r.period_start && p.period_end === r.period_end);
    const amount = pay ? pence(pay.hmrc_paid) - pence(pay.you_paid) : null;
    out.push({
      kind: "load", name, period_start: r.period_start, period_end: r.period_end, submitted_on: r.submitted_on, boxes: r.boxes,
      history_note: `Filed before os.stza.io, on ${longDate(r.submitted_on)}. Loaded from HMRC's record (period ${r.period_key ?? "key not shown"}); cleared by hand at the time.`,
      status: !pay ? "submitted" : amount === expected ? "paid" : "part_paid",
      payment: pay ? { paid_on: pay.date, amount: amount / 100, difference: (amount - expected) / 100 } : null,
      expected: expected / 100,
    });
  }
  return out;
}

async function applyVatBackload(conn, { client: slug, folder, from, by, apply = false }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(from))) throw new Error("--from must be a month, YYYY-MM");
  if (!/@/.test(String(by))) throw new Error("--by must be the CFO's email");
  const said = [];
  const read = readFolder(folder);
  for (const p of read.problems) said.push(`not read: ${p}`);
  const client = (await conn.query("SELECT id FROM shared.clients WHERE slug = $1", [slug])).rows[0];
  if (!client) throw new Error(`no client ${slug}`);
  const regs = (await conn.query("SELECT id, vat_number FROM finance.vat_registrations WHERE client_id = $1 AND ended_at IS NULL", [client.id])).rows;
  if (regs.length !== 1) throw new Error(`expected one VAT registration for ${slug}, found ${regs.length}`);
  const held = (await conn.query(
    "SELECT id, period_start::text, period_end::text, submitted_boxes FROM finance.vat_returns WHERE registration_id = $1", [regs[0].id])).rows;
  for (const step of plan({ returns: read.returns, payments: read.payments, held, from })) {
    if (step.kind === "kept") { said.push(`kept: ${step.name}, ${step.note}`); continue; }
    const box5 = step.expected >= 0 ? `refund ${step.expected.toFixed(2)}` : `payable ${(-step.expected).toFixed(2)}`;
    const paid = step.payment ? `, HMRC ${step.payment.amount >= 0 ? "paid" : "was paid"} ${Math.abs(step.payment.amount).toFixed(2)} on ${longDate(step.payment.paid_on)}${step.payment.difference ? ` (difference ${step.payment.difference.toFixed(2)})` : ""}` : ", not paid yet";
    said.push(`return: ${step.name}, filed ${longDate(step.submitted_on)}, ${box5}${paid}: ${step.status}`);
    if (!apply) continue;
    const id = (await conn.query(
      `INSERT INTO finance.vat_returns (client_id, registration_id, period_start, period_end, status, submitted_on, submitted_boxes, signed_by, signed_at, history_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING id`,
      [client.id, regs[0].id, step.period_start, step.period_end, step.status, step.submitted_on, JSON.stringify(step.boxes), by, step.history_note])).rows[0].id;
    if (step.payment) {
      await conn.query(
        `INSERT INTO finance.vat_payments (return_id, xero_bank_txn_id, paid_on, amount, difference, set_off_reason, matched_by)
         VALUES ($1,NULL,$2,$3,$4,$5,'HMRC payment history (back-load)')`,
        [id, step.payment.paid_on, step.payment.amount, step.payment.difference, step.payment.difference ? "As HMRC's payment history shows; see the return's history" : null]);
    }
  }
  return said;
}

module.exports = { readFolder, plan, applyVatBackload };

if (require.main === module) {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  (async () => {
    const folder = process.argv[2];
    if (!folder || !arg("client") || !arg("from") || !arg("by")) {
      console.error("usage: node scripts/vat-backload.js <folder> --client <slug> --from YYYY-MM --by <cfo email> [--apply]");
      process.exit(2);
    }
    const { Pool } = require("pg");
    const pool = new Pool({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const conn = await pool.connect();
    const apply = process.argv.includes("--apply");
    try {
      await conn.query("BEGIN");
      const said = await applyVatBackload(conn, { client: arg("client"), folder, from: arg("from"), by: arg("by"), apply });
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
