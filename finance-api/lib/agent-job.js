// Starting the agent runner in Google Cloud when an agent run is queued.
//
// The Cloud Run Job agent-runner runs runner.js once: it claims every queued
// run, executes it and exits, so nothing sits polling and the cost is the
// seconds it runs (Nik, 27 Oct 2026: on demand, not always on). Claims use SKIP
// LOCKED, so a job started twice, or the laptop runner beside it, never runs
// the same request twice.
//
// AGENT_JOB_NAME names the job. Unset, a queued run waits for a polling runner
// (the laptop), as before.

const { metadataToken } = require("./pack-job");

function agentJobConfig(env = process.env) {
  const job = String(env.AGENT_JOB_NAME || "").trim();
  const project = env.GCP_PROJECT;
  const region = env.AGENT_JOB_REGION || env.PACK_JOB_REGION;
  if (!job || job.toLowerCase() === "none" || !project || !region) return null;
  return { job, project, region };
}

async function startAgentJob({ project, region, job }, { fetchImpl = fetch, token } = {}) {
  const bearer = token ?? (await metadataToken(fetchImpl));
  const r = await fetchImpl(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google Cloud refused to start ${job} (${r.status}): ${text.slice(0, 300)}`);
  const op = text ? JSON.parse(text) : {};
  return { operation: op.name ?? null, execution: op.metadata?.name ?? null };
}

module.exports = { agentJobConfig, startAgentJob };
