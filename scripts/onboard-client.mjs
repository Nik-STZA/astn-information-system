// Onboards a client: folder tree and database rows, in one command.
//
// See docs/wip-folder-convention.md for the shape and the reasoning.
//
// Idempotent. Running it against an existing client creates whatever is
// missing and changes nothing that already exists, so it is safe to re-run
// after adding an entity.
//
// Usage:
//   node scripts/onboard-client.mjs --slug acme-group --name "Acme Group" \
//     --entities "acme-holdings:AHL:Holding,acme-trading:ATL:Trading" \
//     --role "Fractional CFO" [--jurisdiction "United Kingdom"] \
//     [--framework "FRS 102"] [--year-end 2026-12-31] [--dry-run]

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./db.mjs";

const CLIENTS_ROOT = process.env.CLIENTS_ROOT || "C:\\Users\\yogim\\STZA Group\\Clients";
const TEMPLATE = join(CLIENTS_ROOT, "_template");

// State directories a WIP tree contains. Order is the order work flows.
const WIP_STATES = [
  "drafting",
  "pending-fm",
  "pending-fc",
  "pending-cfo",
  "sent-back/fm1",
  "sent-back/fm2",
  "sent-back/fc",
  "sent-back/clerk",
  "posted",
  "rejected",
];

// Present on every client, matching the live Feldspar engagement rather than
// the sparser original template.
const CLIENT_DIRS = ["diary", "policies", "reconciliations", "correspondence", "skills"];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function required(name) {
  const v = arg(name);
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// "slug:Name:Role,slug2:Name2:Role2"
function parseEntities(raw) {
  if (!raw) return [];
  return raw.split(",").map((chunk) => {
    const [slug, name, role] = chunk.split(":").map((s) => (s ?? "").trim());
    if (!slug || !name) throw new Error(`bad entity "${chunk}", expected slug:Name:Role`);
    return { slug, name, role: role || null };
  });
}

const created = [];
function ensureDir(path, dryRun) {
  if (existsSync(path)) return false;
  if (!dryRun) mkdirSync(path, { recursive: true });
  created.push(path);
  return true;
}

function copyTemplateFiles(dest, dryRun) {
  if (!existsSync(TEMPLATE)) return;
  for (const name of readdirSync(TEMPLATE)) {
    const from = join(TEMPLATE, name);
    if (statSync(from).isDirectory()) continue; // entities handled separately
    const to = join(dest, name);
    if (existsSync(to)) continue;
    if (!dryRun) copyFileSync(from, to);
    created.push(to);
  }
}

function buildWipTree(root, dryRun) {
  ensureDir(join(root, "wip"), dryRun);
  for (const state of WIP_STATES) {
    ensureDir(join(root, "wip", ...state.split("/")), dryRun);
  }
}

async function main() {
  const slug = required("--slug");
  const name = required("--name");
  const role = required("--role");
  const entities = parseEntities(arg("--entities"));
  const jurisdiction = arg("--jurisdiction", "United Kingdom");
  const framework = arg("--framework", "FRS 102");
  const yearEnd = arg("--year-end");
  const actorEmail = arg("--actor", "nik@stza.io");
  const dryRun = process.argv.includes("--dry-run");

  const clientRoot = join(CLIENTS_ROOT, slug);

  console.log(`Client:       ${name} (${slug})`);
  console.log(`Folder:       ${clientRoot}`);
  console.log(`Capacity:     ${role} (${actorEmail})`);
  console.log(`Entities:     ${entities.length ? entities.map((e) => e.slug).join(", ") : "(none given)"}`);
  console.log("");

  // ── Folders ───────────────────────────────────────────────────────────────
  ensureDir(clientRoot, dryRun);
  copyTemplateFiles(clientRoot, dryRun);
  for (const d of CLIENT_DIRS) ensureDir(join(clientRoot, d), dryRun);
  buildWipTree(clientRoot, dryRun); // group-scoped work

  ensureDir(join(clientRoot, "entities"), dryRun);
  for (const e of entities) {
    const entityRoot = join(clientRoot, "entities", e.slug);
    ensureDir(entityRoot, dryRun);
    buildWipTree(entityRoot, dryRun);
  }

  console.log(`${created.length} path(s) ${dryRun ? "would be created" : "created"}`);
  if (created.length) {
    for (const p of created.slice(0, 8)) console.log(`  ${p.replace(CLIENTS_ROOT, "...")}`);
    if (created.length > 8) console.log(`  ... and ${created.length - 8} more`);
  }

  if (dryRun) {
    console.log("\nDry run. No folders written and no database changes.");
    return;
  }

  // ── Database ──────────────────────────────────────────────────────────────
  const { client, release } = await connect();
  try {
    await client.query("BEGIN");

    const c = await client.query(
      `INSERT INTO shared.clients (slug, name, jurisdiction, framework, year_end, status, folder_path)
       VALUES ($1,$2,$3,$4,$5,'active',$6)
       ON CONFLICT (slug) DO UPDATE SET folder_path = EXCLUDED.folder_path, updated_at = now()
       RETURNING id`,
      [slug, name, jurisdiction, framework, yearEnd, clientRoot]
    );
    const clientId = c.rows[0].id;

    await client.query(
      `INSERT INTO finance.client_finance_config (client_id) VALUES ($1)
       ON CONFLICT (client_id) DO NOTHING`,
      [clientId]
    );

    for (const e of entities) {
      await client.query(
        `INSERT INTO finance.entities (client_id, slug, name, role, year_end, folder_path)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (client_id, slug) DO NOTHING`,
        [clientId, e.slug, e.name, e.role, yearEnd, join(clientRoot, "entities", e.slug)]
      );
    }

    // Capacity is required, not optional: an approval has to record the
    // capacity it was given in, and that differs per engagement.
    await client.query(
      `INSERT INTO finance.client_engagement_roles (client_id, actor_email, role)
       SELECT $1,$2,$3
       WHERE NOT EXISTS (
         SELECT 1 FROM finance.client_engagement_roles
         WHERE client_id = $1 AND actor_email = $2 AND effective_to IS NULL
       )`,
      [clientId, actorEmail, role]
    );

    await client.query("COMMIT");

    const summary = await client.query(
      `SELECT c.slug, c.name,
              (SELECT COUNT(*)::int FROM finance.entities e WHERE e.client_id = c.id) AS entities,
              (SELECT role FROM finance.client_engagement_roles r
                WHERE r.client_id = c.id AND r.actor_email = $2 AND r.effective_to IS NULL) AS capacity
       FROM shared.clients c WHERE c.id = $1`,
      [clientId, actorEmail]
    );
    const s = summary.rows[0];
    console.log(`\nDatabase: ${s.name} (${s.slug}), ${s.entities} entit(y|ies), capacity "${s.capacity}"`);
    console.log("Onboarding complete.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await release();
  }
}

main().catch((e) => {
  console.error("\nOnboarding failed:", e.message);
  process.exit(1);
});
