// The scheduled Bills fetch: what the Fetch button does, for each company of each
// client named in BILLS_CLIENTS, as a Cloud Run Job started by Cloud Scheduler.
//
// It reads new documents and starts the AP Clerk where any were queued. From there
// the agents work as they do from the button: a reviewed bill reaches Awaiting
// Approval, and the CFO approves it in Xero. Nothing here approves or pays.
//
// One company's failure does not stop the others, and the job exits non-zero so the
// failure shows on the run. Where agents are already working on a client it leaves
// that client until the next run.
//   BILLS_CLIENTS  client slugs, comma separated (set on the job, not in the repo)
//   BILLS_ACTOR    the person the runs act for (set on the job)
//   FINANCE_API_URL, FINANCE_API_KEY
const MAX_CALLS = 10;
const LIVE = ["queued", "running"];
// A run ends within the runner's 30-minute limit, so one still open after two
// hours is stuck, and must not hold the schedule up for ever.
const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

// An agent at work on this client, as the Bills page reads it: a run with no agent
// named is not one.
const working = (run, now) => LIVE.includes(run.status) && !!run.agent
  && now - Date.parse(run.queued_at) < STUCK_AFTER_MS;

// Keep in step with clerkInstruction in src/modules/finance/components/FetchDocuments.tsx.
const clerkInstruction = (entity) =>
  `Work the Bills queue for ${entity}: every open item with no recommendation yet. Open each document, check it is not already in Xero, and save your recommended coding on it. List anything you could not support and what you need from me.`;

const queuedIn = (results = []) => results.filter((r) => r.state && !r.skipped).length;

// call(method, path, body) answers { ok, status, body }.
async function fetchClient(slug, call, log, now = Date.now()) {
  const base = `/api/finance/clients/${encodeURIComponent(slug)}`;
  const failures = [];
  const runs = await call("GET", `${base}/agent-runs`);
  if (!runs.ok) return { failures: [`${slug}: agent runs could not be read (${runs.status})`] };
  if ((runs.body?.data ?? []).some((r) => working(r, now))) {
    log(`${slug}: agents are working, left until the next run`);
    return { failures, skipped: true };
  }
  const entities = await call("GET", `${base}/entities`);
  if (!entities.ok) return { failures: [`${slug}: companies could not be read (${entities.status})`] };
  for (const entity of entities.body?.data ?? []) {
    let queued = 0;
    let closed = 0;
    for (let n = 0; n < MAX_CALLS; n += 1) {
      const r = await call("POST", `${base}/xero/${encodeURIComponent(entity.slug)}/ap/intake`, {});
      if (!r.ok) {
        failures.push(`${slug}/${entity.slug}: fetch failed (${r.status})`);
        break;
      }
      queued += queuedIn(r.body?.results);
      closed += r.body?.closed ?? 0;
      if (!r.body?.remaining) break;
    }
    log(`${slug}/${entity.slug}: ${queued} queued, ${closed} finished in Xero`);
    if (queued) {
      const started = await call("POST", `${base}/agent-runs`, { agent: "ap-clerk", instruction: clerkInstruction(entity.slug) });
      if (!started.ok) failures.push(`${slug}/${entity.slug}: the AP Clerk could not be started (${started.status})`);
    }
  }
  return { failures };
}

async function main() {
  const { BILLS_CLIENTS, BILLS_ACTOR, FINANCE_API_URL, FINANCE_API_KEY } = process.env;
  if (!BILLS_CLIENTS || !BILLS_ACTOR || !FINANCE_API_URL || !FINANCE_API_KEY) {
    throw new Error("BILLS_CLIENTS, BILLS_ACTOR, FINANCE_API_URL and FINANCE_API_KEY are required");
  }
  const call = async (method, path, body) => {
    const r = await fetch(`${FINANCE_API_URL}${path}`, {
      method,
      headers: { "X-API-Key": FINANCE_API_KEY, "X-Actor-Email": BILLS_ACTOR, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  };
  const failures = [];
  for (const slug of BILLS_CLIENTS.split(",").map((s) => s.trim()).filter(Boolean)) {
    failures.push(...(await fetchClient(slug, call, console.log)).failures);
  }
  if (failures.length) throw new Error(failures.join("; "));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Bills fetch failed: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { fetchClient, clerkInstruction };
