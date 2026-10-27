import { describe, expect, it } from "vitest";
import { agentJobConfig, startAgentJob } from "./agent-job";

describe("agentJobConfig", () => {
  it("needs a job name, project and region, and treats none as off", () => {
    expect(agentJobConfig({ AGENT_JOB_NAME: "agent-runner", GCP_PROJECT: "p", PACK_JOB_REGION: "europe-west1" }))
      .toEqual({ job: "agent-runner", project: "p", region: "europe-west1" });
    expect(agentJobConfig({ AGENT_JOB_NAME: "agent-runner", GCP_PROJECT: "p", AGENT_JOB_REGION: "r", PACK_JOB_REGION: "x" }).region).toBe("r");
    expect(agentJobConfig({ GCP_PROJECT: "p", PACK_JOB_REGION: "r" })).toBeNull();
    expect(agentJobConfig({ AGENT_JOB_NAME: "none", GCP_PROJECT: "p", PACK_JOB_REGION: "r" })).toBeNull();
  });
});

describe("startAgentJob", () => {
  it("runs the job with no overrides and reports Google's refusal", async () => {
    const calls = [];
    const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => '{"name":"op1","metadata":{"name":"ex1"}}' }; };
    expect(await startAgentJob({ project: "p", region: "r", job: "agent-runner" }, { fetchImpl: ok, token: "t" }))
      .toEqual({ operation: "op1", execution: "ex1" });
    expect(calls[0].url).toBe("https://run.googleapis.com/v2/projects/p/locations/r/jobs/agent-runner:run");
    expect(calls[0].init.headers.Authorization).toBe("Bearer t");
    const no = async () => ({ ok: false, status: 403, text: async () => "denied" });
    await expect(startAgentJob({ project: "p", region: "r", job: "agent-runner" }, { fetchImpl: no, token: "t" }))
      .rejects.toThrow("Google Cloud refused to start agent-runner (403): denied");
  });
});
