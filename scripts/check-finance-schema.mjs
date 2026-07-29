// Enforces portal spec section 15.2: every object a Finance migration creates
// must live in the finance schema, never in public.
//
// The platform database is shared. AfricanSTN's 63 tables sit in public,
// including tables owned by the africanstn-research-agent repo (approvals,
// classified_items, publishing_queue and friends). A Finance migration that
// forgets its schema prefix would land alongside them and quietly break the
// extraction guarantee, so this runs in CI.
//
// Usage: node scripts/check-finance-schema.mjs

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join("src", "modules", "finance", "db", "migrations");

// CREATE <object> [IF NOT EXISTS] <name>. Captures the name so we can check
// whether it carries the finance. prefix.
const CREATE_PATTERN =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+|MATERIALIZED\s+)?(TABLE|VIEW|SEQUENCE|INDEX|TYPE|FUNCTION|TRIGGER|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;

// Objects that are not schema-qualified by nature, or are legitimately global.
const EXEMPT_OBJECT_TYPES = new Set(["INDEX", "TRIGGER", "SCHEMA"]);

function stripSqlNoise(sql) {
  // Remove line comments, block comments and string literals so that a comment
  // mentioning "create table foo" does not trip the check.
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.log(`No Finance migrations yet at ${MIGRATIONS_DIR}. Nothing to check.`);
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No Finance migration files found. Nothing to check.");
    return;
  }

  const violations = [];

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = stripSqlNoise(readFileSync(path, "utf-8"));

    for (const match of sql.matchAll(CREATE_PATTERN)) {
      const [, objectType, rawName] = match;
      const type = objectType.toUpperCase();
      if (EXEMPT_OBJECT_TYPES.has(type)) continue;

      const name = rawName.replace(/"/g, "").toLowerCase();

      if (!name.startsWith("finance.")) {
        const line = sql.slice(0, match.index).split("\n").length;
        violations.push(
          `${path}:${line}  CREATE ${type} ${rawName} is not in the finance schema`
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("Finance schema check FAILED.\n");
    violations.forEach((v) => console.error("  " + v));
    console.error(
      `\n${violations.length} object(s) would be created outside finance.*.` +
        "\nQualify every table, view, sequence, type and function as finance.<name>."
    );
    process.exit(1);
  }

  console.log(
    `Finance schema check passed. ${files.length} migration file(s), all objects in finance.*`
  );
}

main();
