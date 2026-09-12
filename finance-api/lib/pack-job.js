// Starting a management pack build as a Cloud Run Job.
//
// The portal's Build button creates a report_runs row. For a client whose packs
// build in Google Cloud, finance-api starts the job straight away with the run's
// id, client and month, and the job reports back through
// /report-runs/:id/complete exactly as the laptop runner does. Which clients
// build in the cloud is configuration (PACK_JOB_CLIENTS), so a client moves only
// when someone decides it should, and the laptop runner stays the fallback.

function cloudClients(env = process.env) {
  const raw = String(env.PACK_JOB_CLIENTS || "").trim();
  if (!raw || raw.toLowerCase() === "none") return new Set();
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

function executorFor(slug, env = process.env) {
  return cloudClients(env).has(slug) && env.PACK_JOB_NAME ? "cloud" : "local";
}

// A cloud client's run is created already running: /report-runs/claim only
// takes queued rows, so this is what keeps the laptop runner from also building
// a month the Cloud Run Job was handed directly.
function initialRun(executor, now = new Date()) {
  return executor === "cloud"
    ? { status: "running", startedAt: now }
    : { status: "queued", startedAt: null };
}

function jobRunRequest({ project, region, job, runId, clientSlug, period }) {
  if (!project || !region || !job) {
    throw new Error("the pack job is not configured: GCP_PROJECT, PACK_JOB_REGION and PACK_JOB_NAME are all needed");
  }
  return {
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`,
    body: {
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "RUN_ID", value: String(runId) },
              { name: "CLIENT_SLUG", value: String(clientSlug) },
              { name: "PERIOD", value: String(period) },
            ],
          },
        ],
      },
    },
  };
}

// On Cloud Run the metadata server issues the service's own access token.
async function metadataToken(fetchImpl = fetch) {
  const r = await fetchImpl(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!r.ok) throw new Error(`could not get an access token from the metadata server (${r.status})`);
  return (await r.json()).access_token;
}

async function startPackJob(opts, { fetchImpl = fetch, token } = {}) {
  const { url, body } = jobRunRequest(opts);
  const bearer = token ?? (await metadataToken(fetchImpl));
  const r = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`Google Cloud refused to start the pack job (${r.status}): ${text.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  const op = text ? JSON.parse(text) : {};
  return { operation: op.name ?? null, execution: op.metadata?.name ?? null };
}

// A build that never reported back (the job crashed, or its completion call
// failed) is treated as failed after this long, so the one-build-in-flight rule
// (migration 015) cannot block its month for ever. Longer than the laptop
// runner's 60-minute limit.
const STALE_RUNNING_MINUTES = 75;

module.exports = { cloudClients, executorFor, initialRun, jobRunRequest, startPackJob, STALE_RUNNING_MINUTES };
