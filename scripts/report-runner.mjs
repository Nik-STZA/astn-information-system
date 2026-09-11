// Builds queued reports on the operator's machine.
//
// The portal queues a report run; this claims it, runs the client's pack
// pipeline, saves the output to the Finance shared drive as a DRAFT, and
// reports back. It has to run here for now: the management pack pipeline
// (XERO REPORTING/scripts/monthly_close.py) reads Xero and Google Sheets with
// this machine's credentials, and the Cowork sandbox cannot reach Xero at all.
// Moving the build to Cloud Run is the next step, not this one.
//
// A run produces a draft, never the delivered pack. XERO REPORTING's CLAUDE.md
// requires Balance Control at 7 flagged items or fewer and CFS variance of £14
// or less before a pack is shared, and the pipeline checks neither. So files
// land in a Drafts folder with a timestamp, and the canonical file name stays a
// person's act.
//
// Usage:
//   node scripts/report-runner.mjs [--once] [--poll 10]
//
// Requires FINANCE_API_URL and FINANCE_API_KEY. The pipeline also needs
// CLIENT_DATA_ROOT (a user environment variable) to find its credentials.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API_URL = process.env.FINANCE_API_URL || "http://127.0.0.1:8080";
const API_KEY = process.env.FINANCE_API_KEY;
const XERO_REPORTING =
  process.env.XERO_REPORTING_DIR || "C:\\Users\\yogim\\Feldspar_Project\\XERO REPORTING";
const MONTH_END_ROOT = process.env.MONTH_END_ROOT || "H:\\Shared drives\\Finance\\Month-end";
const PYTHON = process.env.PACK_PYTHON || "python";
const TIMEOUT_MS = 60 * 60 * 1000;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const pad = (n) => String(n).padStart(2, "0");

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${stamp()}  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function monthOf(period) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period));
  if (!m) throw new Error(`not a YYYY-MM period: ${period}`);
  return { y: Number(m[1]), m: Number(m[2]) };
}

// Local time, and no ":" because Windows file names cannot contain one.
export function draftStamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

// One entry per client with a pack pipeline. Everything client-specific lives
// here so the runner itself stays generic.
export const PACKS = {
  "feldspar-sport-group": {
    label: "Feldspar Group",
    cwd: XERO_REPORTING,
    // The documented close command (feldspar-sport-group/recurring-tasks.md),
    // with the three prior years as comparatives.
    args: (y, m) => [
      "scripts\\monthly_close.py",
      "--reporting-month", `${y}-${pad(m)}`,
      "--prior-years", String(y - 3), String(y - 2), String(y - 1),
    ],
    // The pipeline reads the month's commentary from these. They are written
    // before the close, by the CFO or the bva-commentary skill, not by it.
    prerequisites: (y, m) => [
      join(XERO_REPORTING, "configs", `highlights_${y}-${pad(m)}.json`),
      join(XERO_REPORTING, "configs", `dashboard_${y}-${pad(m)}.json`),
    ],
    // Feldspar's year ends 31 December, so FY26 is calendar 2026 and its
    // month-end folders run 2601 to 2612.
    folder: (y, m) =>
      join(MONTH_END_ROOT, `FY${String(y).slice(2)}`, `${String(y).slice(2)}${pad(m)}`, "Drafts"),
    // Names follow what is already on the shared drive, e.g.
    // "Feldspar Group - Management Pack - Jun2026.xlsx".
    outputs: (y, m) => [
      {
        from: join(XERO_REPORTING, `Management_Pack_${MON[m - 1]}${y}.xlsx`),
        name: `Feldspar Group - Management Pack - ${MON[m - 1]}${y}`,
        ext: ".xlsx",
      },
      {
        from: join(XERO_REPORTING, `Feldspar_Board_Pack_${MON[m - 1]}${y}.pptx`),
        name: `Feldspar Group - Board Pack - ${MONTH[m - 1]} ${y}`,
        ext: ".pptx",
      },
    ],
  },
};

export function planFor(slug, period) {
  const pack = PACKS[slug];
  if (!pack) return null;
  const { y, m } = monthOf(period);
  return {
    label: pack.label,
    cwd: pack.cwd,
    args: pack.args(y, m),
    prerequisites: pack.prerequisites(y, m),
    folder: pack.folder(y, m),
    outputs: pack.outputs(y, m),
  };
}

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${path} returned ${res.status}`);
  return body;
}

const complete = (id, body) =>
  api(`/api/finance/report-runs/${id}/complete`, { method: "POST", body: JSON.stringify(body) });

function runPipeline(plan, logFile) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(PYTHON, plan.args, {
      cwd: plan.cwd,
      windowsHide: true,
      // Python on Windows writes cp1252 by default, which turns "£" into "Â£"
      // (XERO REPORTING CLAUDE.md, rule 12).
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let out = "";
    const onData = (d) => {
      out += d;
      if (out.length > 2_000_000) out = out.slice(-1_000_000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const timer = setTimeout(() => {
      out += `\n[runner] stopped after ${TIMEOUT_MS / 60000} minutes\n`;
      // monthly_close.py runs each stage as a child process, so kill the tree.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    }, TIMEOUT_MS);

    const finish = (code) => {
      clearTimeout(timer);
      try {
        writeFileSync(logFile, out, "utf-8");
      } catch {
        /* the tail still goes back with the run */
      }
      resolve({ code, out, durationMs: Date.now() - started });
    };
    child.on("close", finish);
    child.on("error", (e) => {
      out += `\n${e.message}`;
      finish(-1);
    });
  });
}

async function runJob(job) {
  const who = job.client?.name ?? job.client?.slug;
  log(`claimed ${job.id.slice(0, 8)}: ${job.report} ${job.period} for ${who}`);

  const plan = job.report === "management_pack" ? planFor(job.client?.slug, job.period) : null;
  if (!plan) {
    await complete(job.id, {
      status: "failed",
      error: `No ${String(job.report).replace(/_/g, " ")} pipeline is set up for ${who} yet.`,
    });
    log("  failed: no pipeline for this client");
    return;
  }

  const missing = plan.prerequisites.filter((p) => !existsSync(p));
  if (missing.length) {
    await complete(job.id, {
      status: "failed",
      error:
        `The pack reads the month's commentary from files that do not exist yet:\n` +
        `${missing.join("\n")}\n` +
        `Write them first (CFO highlights, or the bva-commentary skill), then build again.`,
    });
    log("  failed: commentary files missing");
    return;
  }

  if (!existsSync(MONTH_END_ROOT)) {
    await complete(job.id, {
      status: "failed",
      error: `The Finance shared drive is not available at ${MONTH_END_ROOT}. Is Google Drive for desktop running?`,
    });
    log("  failed: shared drive not available");
    return;
  }

  const startedAt = Date.now();
  const logFile = join(tmpdir(), `report-run-${job.id}.log`);
  const { code, out, durationMs } = await runPipeline(plan, logFile);
  const logTail = `${out.slice(-6000)}\n[runner] full log: ${logFile}`;

  if (code !== 0) {
    const failLine = out.split(/\r?\n/).reverse().find((l) => /FAIL/.test(l));
    await complete(job.id, {
      status: "failed",
      error: failLine?.trim() || `The pipeline exited with code ${code}.`,
      logTail,
      durationMs,
    });
    log(`  failed after ${Math.round(durationMs / 1000)}s (exit ${code})`);
    return;
  }

  // Copy only what this run produced. The pipeline writes fixed names at the
  // repo root, so an older file with the right name proves nothing.
  mkdirSync(plan.folder, { recursive: true });
  const when = draftStamp();
  const saved = [];
  const notProduced = [];
  for (const o of plan.outputs) {
    if (!existsSync(o.from) || statSync(o.from).mtimeMs < startedAt) {
      notProduced.push(o.from);
      continue;
    }
    const dest = join(plan.folder, `${o.name} - draft ${when}${o.ext}`);
    copyFileSync(o.from, dest);
    saved.push({ name: `${o.name}${o.ext}`, path: dest });
  }

  if (!saved.length) {
    await complete(job.id, {
      status: "failed",
      error: "The pipeline finished but produced no files in this run.",
      logTail,
      durationMs,
    });
    log("  failed: no output files");
    return;
  }

  await complete(job.id, {
    status: "succeeded",
    outputFiles: saved,
    logTail: notProduced.length
      ? `${logTail}\n[runner] not produced in this run: ${notProduced.join(", ")}`
      : logTail,
    durationMs,
  });
  log(`  done in ${Math.round(durationMs / 1000)}s, ${saved.length} file(s) saved to ${plan.folder}`);
}

async function main() {
  if (!API_KEY) throw new Error("FINANCE_API_KEY is not set");
  if (!existsSync(XERO_REPORTING)) log(`warning: ${XERO_REPORTING} not found; every build will fail`);
  if (!process.env.CLIENT_DATA_ROOT) {
    log("warning: CLIENT_DATA_ROOT is not set; the pipeline will not find its Xero credentials");
  }

  const once = process.argv.includes("--once");
  const pollMs = Number(arg("--poll", "10")) * 1000;
  log(`report runner: api=${API_URL}, pipelines for ${Object.keys(PACKS).join(", ")}`);

  for (;;) {
    let job = null;
    try {
      job = await api("/api/finance/report-runs/claim", { method: "POST" });
    } catch (e) {
      log(`claim failed: ${e.message}`);
    }

    if (job) {
      try {
        await runJob(job);
      } catch (e) {
        log(`  ${job.id.slice(0, 8)} threw: ${e.message}`);
        await complete(job.id, { status: "failed", error: e.message }).catch(() => {});
      }
    }

    if (once) break;
    if (!job) await sleep(pollMs);
  }
}

// Run only when executed directly, so the tests can import the plan helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
