// Where a client's management pack is built, and starting it as a Cloud Run Job.
//
// The portal's Build button creates a report_runs row. For a client whose packs
// build in Google Cloud, finance-api starts the job straight away with the run's
// id, client and month, and the job reports back through
// /report-runs/:id/complete exactly as the laptop runner does.
//
// Which clients build where is configuration, so a client moves only when
// someone decides it should:
//   PACK_ENGINE_CLIENTS + PACK_ENGINE_JOB  the client-neutral pack engine (pack-engine/)
//   PACK_JOB_CLIENTS    + PACK_JOB_NAME    the legacy Feldspar pipeline in Cloud Run
//   LOCAL_PACK_CLIENTS                     the laptop runner (scripts/report-runner.mjs)
// A client in none of these has no pipeline, and a build for it is refused
// rather than queued: a queued row that nothing can run sits there for ever and
// blocks every later build of that month (STZA, 13 Sep 2026).

function clientSet(raw) {
  const s = String(raw || "").trim();
  if (!s || s.toLowerCase() === "none") return new Set();
  return new Set(s.split(/[\s,]+/).filter(Boolean));
}

// Kept for callers that only ask about the legacy cloud list.
function cloudClients(env = process.env) {
  return clientSet(env.PACK_JOB_CLIENTS);
}

function packRouting(slug, env = process.env) {
  if (clientSet(env.PACK_ENGINE_CLIENTS).has(slug) && env.PACK_ENGINE_JOB) {
    return { executor: "cloud", job: env.PACK_ENGINE_JOB, pipeline: "engine" };
  }
  if (clientSet(env.PACK_JOB_CLIENTS).has(slug) && env.PACK_JOB_NAME) {
    return { executor: "cloud", job: env.PACK_JOB_NAME, pipeline: "legacy" };
  }
  if (clientSet(env.LOCAL_PACK_CLIENTS).has(slug)) {
    return { executor: "local", job: null, pipeline: "legacy" };
  }
  return { executor: "none", job: null, pipeline: null };
}

function executorFor(slug, env = process.env) {
  return packRouting(slug, env).executor;
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
    throw new Error("the pack job is not configured: GCP_PROJECT, PACK_JOB_REGION and a job name are all needed");
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

// A queued build nobody picked up. The laptop runner claims within a minute when
// it is running, so half a day means it was not, and the row should stop
// blocking the month.
const STALE_QUEUED_HOURS = 12;

const NO_PIPELINE_MESSAGE =
  "No management pack pipeline is set up for this client yet, so a build would never run.";

module.exports = {
  cloudClients,
  packRouting,
  executorFor,
  initialRun,
  jobRunRequest,
  startPackJob,
  STALE_RUNNING_MINUTES,
  STALE_QUEUED_HOURS,
  NO_PIPELINE_MESSAGE,
};
