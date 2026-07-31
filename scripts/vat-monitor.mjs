// Reports a client's rolling twelve-month turnover against its VAT
// registration threshold.
//
// No model and no agent. This is a Xero query and some arithmetic, and it was
// sitting behind a quota grant for no better reason than being adjacent to work
// that does need one.
//
// The monitor definition lives in the client's configs/monitors.json. This
// script evaluates it and prints the result whether or not it fires, because a
// monitor that only leaves a trace when it breaches cannot later be told apart
// from one nobody ran.
//
// Usage:
//   node scripts/vat-monitor.mjs --client stza [--as-at 2026-07-31]

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const readSecret = (name) =>
  gcloud(["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT}`]);

async function xeroAccessToken(secretName) {
  const refreshToken = readSecret(secretName);
  const clientId = readSecret("xero-app-client-id");
  const clientSecret = readSecret("xero-app-client-secret");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!r.ok) {
    throw new Error(`Xero refused the token refresh (${r.status}). Reconnect the entity.`);
  }
  // Refresh tokens are single use and rotate. Not writing the new one back
  // would leave the stored token dead after this run.
  const tokens = await r.json();
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    execSync(
      `gcloud secrets versions add ${secretName} --project=${PROJECT} --data-file=-`,
      { input: tokens.refresh_token, stdio: ["pipe", "ignore", "pipe"] }
    );
  }
  return tokens.access_token;
}

const iso = (d) => d.toISOString().slice(0, 10);

// Rolling twelve months ending on the given date, inclusive. The VAT test is
// any consecutive twelve months, not the financial year, which is precisely why
// it gets missed.
function rollingWindow(asAt) {
  const to = new Date(`${asAt}T00:00:00Z`);
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  from.setUTCDate(from.getUTCDate() + 1);
  return { from: iso(from), to: iso(to) };
}

// Xero's report shape is nested sections of rows of cells. Rather than trust a
// section title, every candidate is printed so the figure can be checked
// against the accounts rather than taken on faith.
function extractIncome(report) {
  const sections = [];
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (row.RowType === "Section") {
        const summary = (row.Rows ?? []).find((r) => r.RowType === "SummaryRow");
        const value = summary?.Cells?.[1]?.Value;
        sections.push({
          title: row.Title || "(untitled)",
          total: value === undefined || value === "" ? null : Number(value),
          lines: (row.Rows ?? [])
            .filter((r) => r.RowType === "Row")
            .map((r) => ({ name: r.Cells?.[0]?.Value, value: Number(r.Cells?.[1]?.Value ?? 0) })),
        });
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(report?.Rows);
  return sections;
}

const money = (n) =>
  n === null || n === undefined
    ? "-"
    : `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const slug = arg("--client", "stza");
  const asAt = arg("--as-at", iso(new Date()));
  const { from, to } = rollingWindow(asAt);

  const { client, release } = await connect();
  let entity, clientRoot;
  try {
    const { rows } = await client.query(
      `SELECT c.folder_path,
              e.slug,
              e.accounting_system_config->>'tenant_id'   AS tenant_id,
              e.accounting_system_config->>'tenant_name' AS tenant_name,
              e.accounting_system_config->>'secret_name' AS secret_name
         FROM shared.clients c
         JOIN finance.entities e ON e.client_id = c.id
        WHERE c.slug = $1`,
      [slug]
    );
    if (!rows.length) throw new Error(`no entities registered for client '${slug}'`);
    const mapped = rows.filter((r) => r.tenant_id);
    if (!mapped.length) {
      throw new Error(`no entity for '${slug}' is mapped to a Xero organisation yet`);
    }
    if (mapped.length > 1) {
      // Deliberately refuses rather than summing. Turnover for a VAT threshold
      // is per registrable person, and which entities aggregate is a question
      // about group registration, not something to assume here.
      throw new Error(
        `'${slug}' has ${mapped.length} mapped entities. This monitor covers a single ` +
          `registrable entity; group aggregation is a separate determination.`
      );
    }
    entity = mapped[0];
    clientRoot = rows[0].folder_path;
  } finally {
    await release();
  }

  const monitorPath = join(clientRoot, "configs", "monitors.json");
  if (!existsSync(monitorPath)) throw new Error(`no monitors.json at ${monitorPath}`);
  const config = JSON.parse(readFileSync(monitorPath, "utf-8").replace(/^﻿/, ""));
  const monitor = config.monitors.find((m) => m.measure === "taxable_turnover_rolling_12m");
  if (!monitor) throw new Error("no rolling twelve-month turnover monitor defined");

  const token = await xeroAccessToken(entity.secret_name || `xero-refresh-${slug}-${entity.slug}`);
  const url =
    `https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss` +
    `?fromDate=${from}&toDate=${to}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-tenant-id": entity.tenant_id,
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`Xero report failed (${r.status}): ${(await r.text()).slice(0, 200)}`);

  const sections = extractIncome((await r.json()).Reports?.[0]);
  const income = sections.find((s) => /income|revenue|turnover/i.test(s.title));

  console.log(`\n${entity.tenant_name} — VAT registration monitor`);
  console.log(`Rolling twelve months, ${from} to ${to}\n`);

  if (!income) {
    console.log("  Could not identify an income section in the report. Sections seen:");
    sections.forEach((s) => console.log(`    ${s.title.padEnd(28)} ${money(s.total)}`));
    console.log("\n  Reporting nothing rather than guessing which section is turnover.\n");
    process.exit(1);
  }

  income.lines.forEach((l) => console.log(`  ${String(l.name).padEnd(34)} ${money(l.value)}`));
  const turnover = income.total ?? income.lines.reduce((a, l) => a + l.value, 0);
  const threshold = Number(monitor.threshold);
  const headroom = threshold - turnover;
  const ratio = turnover / threshold;

  console.log(`  ${"".padEnd(34, "-")} ${"".padEnd(14, "-")}`);
  console.log(`  ${"Turnover".padEnd(34)} ${money(turnover)}`);
  console.log(`  ${"Threshold".padEnd(34)} ${money(threshold)}`);
  console.log(`  ${"Headroom".padEnd(34)} ${money(headroom)}`);
  console.log(`  ${"Used".padEnd(34)} ${(ratio * 100).toFixed(1)}%\n`);

  if (ratio >= 1) {
    console.log("  BREACH. Registration is compulsory.");
    console.log(`  ${monitor.breachAction}\n`);
    process.exitCode = 2;
  } else if (ratio >= Number(monitor.warnAt)) {
    console.log(`  WARNING at ${Number(monitor.warnAt) * 100}% of the threshold.`);
    console.log(`  ${monitor.warnAction}\n`);
  } else {
    console.log("  Clear.\n");
  }

  // Said every time, because the figure is a proxy and the difference between
  // it and taxable turnover is exactly where this goes wrong.
  console.log("  Basis and limits of this figure:");
  console.log("    Profit and loss income for the period, per Xero.");
  console.log("    It is NOT the same as taxable turnover. It does not exclude");
  console.log("    supplies outside the scope of UK VAT, exempt supplies, or");
  console.log("    disposals of capital assets, and it follows the accounting");
  console.log("    basis rather than the VAT tax point.");
  console.log(`    Threshold £${threshold.toLocaleString("en-GB")} as at ${monitor.thresholdAsAt},`);
  console.log(`    to be verified each ${monitor.verifyEach}.\n`);
}

main().catch((e) => {
  console.error("\nMonitor failed:", e.message, "\n");
  process.exit(1);
});
