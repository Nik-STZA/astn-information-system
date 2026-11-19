// Sets up payroll for a client from a JSON file kept in the client's folder
// (not the repo): the companies, the account for each journal line, the
// development projects, where the working file goes, each employee code's
// role, and, once that month's report is uploaded, its capitalisation shares
// for the CFO to confirm on the Payroll page.
//
// Dry run by default.
//   node scripts/payroll-setup.js <file.json> --by <cfo email> [--apply]
// The connection comes from DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
//
// The file:
//   { "client": "<slug>", "payroll_entity": "<slug>", "contracted_entity": "<slug>",
//     "accounts": { "payroll": {...}, "contracted": {...}, "capdev": {...} },
//     "projects": ["P1", ...],
//     "drive_id": "<shared drive id>" or "drive_from_vat": true,   (the VAT registration's drive)
//     "drive_path": ["Client", "Payroll", "{yymm}"],
//     "roles": { "<emp code>": "director" | "direct" | "intercompany" },
//     "alloc": { "period": "YYYY-MM", "shares": { "<emp code>": { "<project>": percent } } } }

const fs = require("fs");
const { Pool } = require("pg");
const pay = require("../lib/payroll");
const { allocIssues } = require("../lib/payroll-routes");

function check(f) {
  const issues = [];
  for (const k of ["client", "payroll_entity", "accounts", "projects", "drive_path", "roles"]) if (f[k] == null) issues.push(`${k} is missing`);
  for (const p of f.projects ?? []) if (!pay.PROJECT.test(p)) issues.push(`${p} is not a project code`);
  for (const [c, r] of Object.entries(f.roles ?? {})) if (!pay.ROLES.includes(r)) issues.push(`employee ${c}: ${r} is not a role`);
  if (!f.drive_id && !f.drive_from_vat) issues.push("drive_id or drive_from_vat is needed");
  if (f.alloc && !/^\d{4}-(0[1-9]|1[0-2])$/.test(f.alloc.period ?? "")) issues.push("alloc.period must be YYYY-MM");
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => a.endsWith(".json"));
  const by = args[args.indexOf("--by") + 1];
  const apply = args.includes("--apply");
  if (!file || !by || args.indexOf("--by") < 0) throw new Error("usage: node scripts/payroll-setup.js <file.json> --by <cfo email> [--apply]");
  const f = JSON.parse(fs.readFileSync(file, "utf8"));
  const issues = check(f);
  if (issues.length) throw new Error(issues.join("\n"));

  const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const db = await pool.connect();
  try {
    const client = (await db.query("SELECT id, name FROM shared.clients WHERE slug = $1", [f.client])).rows[0];
    if (!client) throw new Error(`no client ${f.client}`);
    const role = (await db.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, by])).rows[0].role;
    if (!/cfo|chief financial officer|finance director/i.test(String(role))) throw new Error(`${by} is not the CFO on ${f.client} (role: ${role})`);
    const ent = async (slug) => (await db.query("SELECT id, name FROM finance.entities WHERE client_id = $1 AND slug = $2 AND retired_at IS NULL", [client.id, slug])).rows[0];
    const payrollE = await ent(f.payroll_entity);
    const contractedE = f.contracted_entity ? await ent(f.contracted_entity) : null;
    if (!payrollE || (f.contracted_entity && !contractedE)) throw new Error("a company in the file is not one of this client's");
    let driveId = f.drive_id ?? null;
    if (!driveId && f.drive_from_vat) {
      const regs = (await db.query("SELECT drive_id, export_path FROM finance.vat_registrations WHERE client_id = $1 AND ended_at IS NULL AND drive_id IS NOT NULL", [client.id])).rows;
      if (regs.length !== 1) throw new Error(`expected one VAT registration with a drive, found ${regs.length}`);
      if (JSON.stringify(regs[0].export_path?.[0]) !== JSON.stringify(f.drive_path[0])) {
        throw new Error(`the VAT registration's folder starts ${JSON.stringify(regs[0].export_path?.[0])}, not ${JSON.stringify(f.drive_path[0])}: give drive_id instead`);
      }
      driveId = regs[0].drive_id;
    }

    console.log(`${client.name}: payroll in ${payrollE.name}${contractedE ? `, intercompany staff costed in ${contractedE.name}` : ""}`);
    console.log(`  accounts: ${Object.entries(f.accounts).map(([g, a]) => `${g} ${Object.keys(a).length}`).join(", ")}; projects ${f.projects.join(", ")}`);
    console.log(`  working file: shared drive ${driveId}, ${f.drive_path.join(" / ")}`);
    const heldRoles = Object.fromEntries((await db.query("SELECT emp_code, role FROM finance.payroll_roles WHERE client_id = $1", [client.id])).rows.map((r) => [r.emp_code, r.role]));
    const roleChanges = Object.entries(f.roles).filter(([c, r]) => heldRoles[c] !== r);
    console.log(`  roles: ${Object.keys(f.roles).length} codes, ${roleChanges.length} to set`);

    let run = null;
    if (f.alloc) {
      run = (await db.query("SELECT id, figures, alloc_confirmed_at FROM finance.payroll_runs WHERE client_id = $1 AND period = $2 AND superseded_at IS NULL", [client.id, f.alloc.period])).rows[0];
      if (!run) console.log(`  shares for ${f.alloc.period}: not set, as that month's report is not uploaded yet. Upload it, then run this again.`);
      else {
        const ai = allocIssues(f.alloc.shares, f.projects, run.figures.map((e) => e.emp_code));
        if (ai.length) throw new Error(ai.join("\n"));
        if (run.alloc_confirmed_at) { console.log(`  shares for ${f.alloc.period}: already confirmed on the page, left alone`); run = null; }
        else console.log(`  shares for ${f.alloc.period}: ${Object.keys(f.alloc.shares).length} employee(s), for the CFO to confirm on the Payroll page`);
      }
    }

    if (!apply) { console.log("\nDry run: nothing written. Add --apply to write."); return; }
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO finance.payroll_settings (client_id, payroll_entity_id, contracted_entity_id, accounts, projects, drive_id, drive_path, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET payroll_entity_id = EXCLUDED.payroll_entity_id, contracted_entity_id = EXCLUDED.contracted_entity_id,
         accounts = EXCLUDED.accounts, projects = EXCLUDED.projects, drive_id = EXCLUDED.drive_id, drive_path = EXCLUDED.drive_path,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [client.id, payrollE.id, contractedE?.id ?? null, JSON.stringify(f.accounts), f.projects, driveId, JSON.stringify(f.drive_path), by]);
    for (const [c, r] of roleChanges) {
      await db.query(
        `INSERT INTO finance.payroll_roles (client_id, emp_code, role, set_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, emp_code) DO UPDATE SET role = EXCLUDED.role, set_by = EXCLUDED.set_by, set_at = now()`, [client.id, c, r, by]);
    }
    if (run) await db.query("UPDATE finance.payroll_runs SET alloc = $2 WHERE id = $1", [run.id, JSON.stringify(f.alloc.shares)]);
    await db.query(
      `INSERT INTO finance.audit_log (actor_email, actor_role, action, target_type, target_id, client_id, payload)
       VALUES ($1,$2,'payroll_setup_loaded','client',$3,$4,$5)`,
      [by, role, String(client.id), client.id, JSON.stringify({ file: require("path").basename(file), roles_set: roleChanges.length, shares_period: run ? f.alloc.period : null })]);
    await db.query("COMMIT");
    console.log("\nWritten.");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
