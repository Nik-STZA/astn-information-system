// General ledger drill-down: every transaction on an account, from Xero.
//
// Written because a balance looked wrong and inferring from a trial balance is
// guessing. Two balances being equal and opposite is a hypothesis; the journal
// that made them is the answer.
//
// No model. Reading a ledger is a query.
//
// Usage:
//   node scripts/account-transactions.mjs --client stza --account 826
//   node scripts/account-transactions.mjs --client stza --account 826,830 --from 2025-11-12

import { execSync } from "node:child_process";
import { connect } from "./db.mjs";

const PROJECT = "africanstn-research";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function gcloud(args) {
  const cmd = ["gcloud", ...args]
    .map((a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(" ");
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const readSecret = (n) =>
  gcloud(["secrets", "versions", "access", "latest", `--secret=${n}`, `--project=${PROJECT}`]);

async function xeroAccessToken(secretName) {
  const refreshToken = readSecret(secretName);
  const basic = Buffer.from(
    `${readSecret("xero-app-client-id")}:${readSecret("xero-app-client-secret")}`
  ).toString("base64");
  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!r.ok) throw new Error(`Xero refused the token refresh (${r.status})`);
  const t = await r.json();
  if (t.refresh_token && t.refresh_token !== refreshToken) {
    execSync(`gcloud secrets versions add ${secretName} --project=${PROJECT} --data-file=-`, {
      input: t.refresh_token,
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  return t.access_token;
}

const money = (n) =>
  `${Number(n) < 0 ? "-" : " "}£${Math.abs(Number(n)).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function main() {
  const slug = arg("--client", "stza");
  const codes = String(arg("--account", "")).split(",").map((c) => c.trim()).filter(Boolean);
  if (!codes.length) throw new Error("--account is required, e.g. --account 826 or --account 826,830");
  const from = arg("--from", "2000-01-01");
  const to = arg("--to", new Date().toISOString().slice(0, 10));

  const { client, release } = await connect();
  let entity;
  try {
    const { rows } = await client.query(
      `SELECT e.slug,
              e.accounting_system_config->>'tenant_id'   AS tenant_id,
              e.accounting_system_config->>'tenant_name' AS tenant_name,
              e.accounting_system_config->>'secret_name' AS secret_name
         FROM shared.clients c JOIN finance.entities e ON e.client_id = c.id
        WHERE c.slug = $1 AND e.accounting_system_config->>'tenant_id' IS NOT NULL`,
      [slug]
    );
    if (!rows.length) throw new Error(`no mapped Xero entity for '${slug}'`);
    if (rows.length > 1) throw new Error(`'${slug}' has several mapped entities; name one with --entity`);
    entity = rows[0];
  } finally {
    await release();
  }

  const token = await xeroAccessToken(entity.secret_name || `xero-refresh-${slug}-${entity.slug}`);
  const head = {
    Authorization: `Bearer ${token}`,
    "Xero-tenant-id": entity.tenant_id,
    Accept: "application/json",
  };

  const accounts = (await (await fetch("https://api.xero.com/api.xro/2.0/Accounts", { headers: head })).json())
    .Accounts ?? [];

  console.log(`\n${entity.tenant_name} — account transactions, ${from} to ${to}`);

  for (const code of codes) {
    const account = accounts.find((a) => String(a.Code) === code);
    if (!account) {
      console.log(`\n  ${code}: no such account in this organisation.`);
      continue;
    }

    const url =
      `https://api.xero.com/api.xro/2.0/Reports/AccountTransactions` +
      `?accountID=${account.AccountID}&fromDate=${from}&toDate=${to}`;
    const r = await fetch(url, { headers: head });
    if (!r.ok) {
      console.log(`\n  ${code} ${account.Name}: report failed (${r.status})`);
      continue;
    }

    const report = (await r.json()).Reports?.[0];
    console.log(`\n  ${code} · ${account.Name} · ${account.Type}`);
    console.log(`  ${"".padEnd(96, "-")}`);

    const lines = [];
    const walk = (rows) => {
      for (const row of rows ?? []) {
        if (row.RowType === "Row" && row.Cells?.length) {
          lines.push(row.Cells.map((c) => c.Value ?? ""));
        }
        if (row.Rows) walk(row.Rows);
      }
    };
    walk(report?.Rows);

    if (!lines.length) {
      console.log("  No transactions in the period.");
      continue;
    }

    // Header cells vary by report; print what Xero labelled them rather than
    // assuming a shape.
    const header = report?.Rows?.find((r) => r.RowType === "Header")?.Cells?.map((c) => c.Value);
    if (header) console.log(`  ${header.map((h) => String(h).padEnd(15)).join("")}`);
    for (const cells of lines) {
      console.log(`  ${cells.map((c) => String(c).slice(0, 14).padEnd(15)).join("")}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("\nDrill-down failed:", e.message, "\n");
  process.exit(1);
});
