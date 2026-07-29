// Applies SQL migrations and records what has run.
//
// Two migration sets, deliberately separate:
//   migrations/                                platform-level (shared.*, schemas)
//   src/modules/finance/db/migrations/         Finance module, finance.* only
//
// Every migration in this repo is written to be idempotent, but the ledger in
// shared.schema_migrations means a re-run is a no-op rather than a re-execution.
//
// Usage:
//   node scripts/migrate.mjs                      apply anything not yet applied
//   node scripts/migrate.mjs --status             list applied and pending
//   node scripts/migrate.mjs --baseline [file...] record as applied WITHOUT running
//
// Baseline exists because migrations 003 to 024 were applied by hand before
// this runner existed, and several of them are not idempotent. Marking them
// applied stops the first real run from re-executing them. With no filenames,
// baseline marks everything currently pending.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { connect } from "./db.mjs";

const SETS = [
  { name: "platform", dir: "migrations" },
  { name: "finance", dir: join("src", "modules", "finance", "db", "migrations") },
];

const LEDGER = `
  CREATE SCHEMA IF NOT EXISTS shared;
  CREATE TABLE IF NOT EXISTS shared.schema_migrations (
    id          bigserial PRIMARY KEY,
    set_name    text NOT NULL,
    filename    text NOT NULL,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (set_name, filename)
  );
`;

function discover() {
  const out = [];
  for (const set of SETS) {
    if (!existsSync(set.dir)) continue;
    for (const f of readdirSync(set.dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(set.dir, f), "utf-8");
      out.push({
        set: set.name,
        file: f,
        path: join(set.dir, f),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex").slice(0, 16),
      });
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const statusOnly = argv.includes("--status");
  const baseline = argv.includes("--baseline");
  const baselineFiles = new Set(argv.filter((a) => !a.startsWith("--")));

  const { client, release } = await connect();

  try {
    await client.query(LEDGER);
    const { rows } = await client.query(
      "SELECT set_name, filename, checksum FROM shared.schema_migrations"
    );
    const applied = new Map(rows.map((r) => [`${r.set_name}:${r.filename}`, r.checksum]));

    const all = discover();
    const pending = [];

    for (const m of all) {
      const key = `${m.set}:${m.file}`;
      if (!applied.has(key)) {
        pending.push(m);
      } else if (applied.get(key) !== m.checksum) {
        console.log(`  CHANGED  ${key}  (already applied, file has since been edited)`);
      }
    }

    if (statusOnly) {
      console.log(`Applied: ${applied.size}`);
      for (const m of all) {
        const key = `${m.set}:${m.file}`;
        console.log(`  ${applied.has(key) ? "applied" : "PENDING"}  ${key}`);
      }
      return;
    }

    if (baseline) {
      const target = baselineFiles.size
        ? pending.filter((m) => baselineFiles.has(m.file))
        : pending;

      if (baselineFiles.size) {
        const found = new Set(target.map((m) => m.file));
        for (const f of baselineFiles) {
          if (!found.has(f)) console.log(`  skipped ${f} (not pending or not found)`);
        }
      }

      for (const m of target) {
        await client.query(
          "INSERT INTO shared.schema_migrations (set_name, filename, checksum) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [m.set, m.file, m.checksum]
        );
        console.log(`  baselined ${m.set}:${m.file}`);
      }
      console.log(`\nBaselined ${target.length} migration(s). Nothing was executed.`);
      return;
    }

    if (pending.length === 0) {
      console.log("Nothing to apply. Database is up to date.");
      return;
    }

    for (const m of pending) {
      process.stdout.write(`Applying ${m.set}:${m.file} ... `);
      // Each migration runs in its own transaction so a failure leaves the
      // ledger and the schema consistent with each other.
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          "INSERT INTO shared.schema_migrations (set_name, filename, checksum) VALUES ($1, $2, $3)",
          [m.set, m.file, m.checksum]
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (e) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw new Error(`${m.path}: ${e.message}`);
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await release();
  }
}

main().catch((e) => {
  console.error("\nMigration failed:", e.message);
  process.exit(1);
});
