import { describe, expect, it } from "vitest";
import { cloudClients, executorFor, initialRun, jobRunRequest, startPackJob } from "./pack-job.js";

const cfg = {
  project: "africanstn-research",
  region: "europe-west1",
  job: "mgmt-pack-feldspar",
  runId: "run-1",
  clientSlug: "feldspar-sport-group",
  period: "2026-07",
};

describe("which clients build in the cloud", () => {
  it("is off unless clients are named", () => {
    expect(cloudClients({}).size).toBe(0);
    expect(cloudClients({ PACK_JOB_CLIENTS: "none" }).size).toBe(0);
    expect([...cloudClients({ PACK_JOB_CLIENTS: "feldspar-sport-group, stza" })]).toEqual(["feldspar-sport-group", "stza"]);
  });

  it("needs a job name as well as the client", () => {
    expect(executorFor("feldspar-sport-group", { PACK_JOB_CLIENTS: "feldspar-sport-group" })).toBe("local");
    expect(executorFor("feldspar-sport-group", { PACK_JOB_CLIENTS: "feldspar-sport-group", PACK_JOB_NAME: "j" })).toBe("cloud");
    expect(executorFor("stza", { PACK_JOB_CLIENTS: "feldspar-sport-group", PACK_JOB_NAME: "j" })).toBe("local");
  });
});

describe("jobRunRequest", () => {
  it("passes the run, client and month to the job", () => {
    const { url, body } = jobRunRequest(cfg);
    expect(url).toBe(
      "https://run.googleapis.com/v2/projects/africanstn-research/locations/europe-west1/jobs/mgmt-pack-feldspar:run"
    );
    expect(body.overrides.containerOverrides[0].env).toEqual([
      { name: "RUN_ID", value: "run-1" },
      { name: "CLIENT_SLUG", value: "feldspar-sport-group" },
      { name: "PERIOD", value: "2026-07" },
    ]);
  });

  it("refuses to guess missing configuration", () => {
    expect(() => jobRunRequest({ ...cfg, job: undefined })).toThrow(/not configured/);
  });
});

describe("startPackJob", () => {
  const fakeFetch = (status, body) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });

  it("returns the execution Cloud Run started", async () => {
    const out = await startPackJob(cfg, {
      token: "t",
      fetchImpl: fakeFetch(200, { name: "operations/op-1", metadata: { name: "executions/mgmt-pack-feldspar-abc" } }),
    });
    expect(out).toEqual({ operation: "operations/op-1", execution: "executions/mgmt-pack-feldspar-abc" });
  });

  it("carries Cloud Run's reason when it refuses", async () => {
    await expect(
      startPackJob(cfg, { token: "t", fetchImpl: fakeFetch(403, { error: { message: "Permission denied" } }) })
    ).rejects.toThrow(/refused to start the pack job \(403\).*Permission denied/);
  });
});

describe("how a run opens", () => {
  const now = new Date("2026-09-12T10:00:00Z");

  it("leaves a laptop client's build queued for the runner to claim", () => {
    expect(initialRun("local", now)).toEqual({ status: "queued", startedAt: null });
  });

  it("opens a cloud client's build already running, so the laptop runner cannot claim it", () => {
    expect(initialRun("cloud", now)).toEqual({ status: "running", startedAt: now });
  });
});
