// Runs queued agent jobs on the operator's machine.
//
// The portal queues work and records what happened; this executes it. Execution
// has to be local because the agents need the client folder and the accounting
// MCP, neither of which exists on Cloud Run.
//
// One job at a time, deliberately. Two agents writing into the same client
// folder concurrently is a class of bug not worth inviting for a queue this
// size.
//
// Usage:
//   node scripts/agent-runner.mjs [--once] [--poll 5]
//
// Requires FINANCE_API_URL and FINANCE_API_KEY.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveProcessingPath } from "../src/modules/finance/lib/processing-path.ts";

const API_URL = process.env.FINANCE_API_URL || "http://127.0.0.1:8080";
const API_KEY = process.env.FINANCE_API_KEY;
const PLUGIN_DIR =
  process.env.STZA_PLUGIN_DIR || "C:\\Users\\yogim\\STZA Group\\stza-finance-agents";
const TRANSCRIPT_ROOT =
  process.env.CLAUDE_PROJECTS_DIR || join(process.env.USERPROFILE || "", ".claude", "projects");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${stamp()}  ${m}`);

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

// Claude writes one transcript per session, and a separate one per subagent
// under <session-id>/subagents/. Naming an agent in the prompt spawns a
// subagent, so the parent transcript records a single Agent call and nothing
// else: all the real tool use is in the child.
//
// Reading only the parent produced an audit record saying the agent touched no
// files when it had read two. A record that understates what happened is worse
// than no record, so both are walked.
//
// Only tool names and paths are extracted. File contents stay in the transcript
// and out of the database.
function encodeCwd(cwd) {
  // Each of : \ / and space becomes a dash, with nothing collapsed or
  // stripped, so "C:\Users" becomes "C--Users". Guessing this wrongly fails
  // silently: the lookup finds nothing and the run records no tools at all.
  return cwd.replace(/[:\\/ ]/g, "-");
}

function collectToolUse(file, tools, files) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== "tool_use") continue;
      tools.set(c.name, (tools.get(c.name) ?? 0) + 1);
      const input = c.input || {};
      for (const k of ["file_path", "path", "notebook_path"]) {
        if (input[k]) files.add(String(input[k]));
      }
    }
  }
}

function extractFromTranscript(cwd, sessionId) {
  const dir = join(TRANSCRIPT_ROOT, encodeCwd(cwd));
  const parent = join(dir, `${sessionId}.jsonl`);
  const tools = new Map();
  const files = new Set();

  collectToolUse(parent, tools, files);

  const subagentDir = join(dir, sessionId, "subagents");
  if (existsSync(subagentDir)) {
    for (const f of readdirSync(subagentDir)) {
      if (f.endsWith(".jsonl")) collectToolUse(join(subagentDir, f), tools, files);
    }
  }

  return {
    toolsUsed: [...tools].map(([name, count]) => ({ name, count })),
    filesTouched: [...files],
    transcriptFound: existsSync(parent),
  };
}

function runClaude(cwd, prompt, path) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--output-format", "json", "--plugin-dir", PLUGIN_DIR];
    // shell:true because claude is a .cmd shim on Windows, which Node will not
    // spawn directly.
    const child = spawn(`claude ${args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(" ")}`, {
      cwd,
      shell: true,
      windowsHide: true,
      // The path decides which commercial arrangement the client's data is
      // processed under, so it is set explicitly on every child rather than
      // inherited and hoped for.
      env: { ...process.env, ...path.env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (e) => resolve({ code: -1, stdout: "", stderr: e.message }));
  });
}

async function runJob(job) {
  const cwd = job.client?.folder_path;
  log(`claimed ${job.id.slice(0, 8)} for ${job.client?.slug}${job.agent ? ` [${job.agent}]` : ""}`);

  // An ungoverned path carries no data processing agreement and no
  // confidentiality clause. That matters where a third party's ledger is
  // involved: a duty is owed to someone who has not consented.
  //
  // Where the operator is both controller and client it does not, because there
  // is no third party to protect. What remains is a terms question on the
  // operator's own account, which is the operator's to weigh and not a
  // runner's to enforce.
  //
  // The flag is per client, set deliberately and recorded, rather than a slug
  // hardcoded here. The earlier version exempted only a sandbox, which blocked
  // the operator's own first close while the identical processing continued in
  // interactive sessions - a control on the recorded path and not the
  // unrecorded one, which is worse than none.
  if (!PATH_IN_USE.governed && !job.client?.operator_is_controller) {
    await api(`/api/finance/agent-runs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        status: "failed",
        error:
          `refused: no commercial agreement governs this processing path, and ` +
          `'${job.client?.slug}' is a third-party client. Configure Vertex or an API key.`,
        processingPath: PATH_IN_USE.kind,
        processingPathLabel: PATH_IN_USE.label,
      }),
    });
    log(`  refused: ungoverned path, and ${job.client?.slug} is a third-party client`);
    return;
  }

  if (!cwd || !existsSync(cwd)) {
    await api(`/api/finance/agent-runs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "failed", error: `client folder not found: ${cwd}` }),
    });
    log("  failed: client folder not found");
    return;
  }

  // Naming the agent is a request, not a guarantee. The record stores what was
  // asked for; the transcript shows what actually ran.
  const prompt = job.agent ? `Use the ${job.agent} agent. ${job.instruction}` : job.instruction;

  const started = Date.now();
  const { code, stdout, stderr } = await runClaude(cwd, prompt, PATH_IN_USE);
  const durationMs = Date.now() - started;

  let parsed = null;
  try {
    parsed = JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    /* handled below */
  }

  if (!parsed) {
    await api(`/api/finance/agent-runs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        status: "failed",
        error: (stderr || stdout || `exited ${code}`).slice(0, 2000),
        durationMs,
      }),
    });
    log(`  failed after ${Math.round(durationMs / 1000)}s`);
    return;
  }

  const extract = parsed.session_id ? extractFromTranscript(cwd, parsed.session_id) : { toolsUsed: [], filesTouched: [] };

  await api(`/api/finance/agent-runs/${job.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: parsed.is_error ? "failed" : "succeeded",
      sessionId: parsed.session_id ?? null,
      output: parsed.result ?? null,
      error: parsed.is_error ? String(parsed.result ?? "").slice(0, 2000) : null,
      toolsUsed: extract.toolsUsed,
      filesTouched: extract.filesTouched,
      durationMs,
      costUsd: parsed.total_cost_usd ?? null,
      processingPath: PATH_IN_USE.kind,
      processingPathLabel: PATH_IN_USE.label,
    }),
  });

  log(
    `  ${parsed.is_error ? "failed" : "done"} in ${Math.round(durationMs / 1000)}s, ` +
      `${extract.toolsUsed.length} tool type(s), ${extract.filesTouched.length} file(s)` +
      (parsed.total_cost_usd ? `, $${parsed.total_cost_usd.toFixed(4)}` : "")
  );
}

// Established once, before any job is claimed. A runner that resolved this per
// job could process one client under a commercial agreement and the next over a
// consumer sign-in without anyone noticing.
let PATH_IN_USE;

async function main() {
  if (!API_KEY) throw new Error("FINANCE_API_KEY is not set");
  PATH_IN_USE = resolveProcessingPath();

  // Vertex reads Application Default Credentials, which "gcloud auth login"
  // does NOT write - that needs "gcloud auth application-default login". Without
  // them the run does not fail fast, it hangs for three minutes and then reports
  // a credentials error, which is a slow way to learn something checkable here.
  if (PATH_IN_USE.kind === "vertex") {
    const adc =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      join(process.env.APPDATA || join(process.env.HOME || "", ".config"), "gcloud", "application_default_credentials.json");
    if (!existsSync(adc)) {
      throw new Error(
        `Vertex is configured but Application Default Credentials were not found at ${adc}. ` +
          `Run: gcloud auth application-default login`
      );
    }
  }
  const once = process.argv.includes("--once");
  const pollSeconds = Number(arg("--poll", "5"));

  log(`runner started. api=${API_URL} plugin=${PLUGIN_DIR}`);
  log(`processing path: ${PATH_IN_USE.label}`);
  if (!PATH_IN_USE.governed) {
    log("");
    log("  WARNING: no commercial agreement governs this path.");
    log("  Synthetic data only. Do not run this over a real client ledger.");
    log("  Every run will be recorded as ungoverned.");
    log("");
  }
  if (once) log("running in --once mode: one job, then exit");

  for (;;) {
    let job = null;
    try {
      job = await api("/api/finance/agent-runs/claim", { method: "POST" });
    } catch (e) {
      log(`could not reach the queue: ${e.message}`);
    }

    if (job) {
      try {
        await runJob(job);
      } catch (e) {
        log(`  runner error: ${e.message}`);
        // A job left running would never be picked up again, so it is closed
        // out even when the runner itself is what failed.
        await api(`/api/finance/agent-runs/${job.id}/complete`, {
          method: "POST",
          body: JSON.stringify({ status: "failed", error: `runner error: ${e.message}` }),
        }).catch(() => {});
      }
      if (once) return;
      continue;
    }

    if (once) {
      log("no queued jobs");
      return;
    }
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
}

main().catch((e) => {
  console.error("Runner failed:", e.message);
  process.exit(1);
});
