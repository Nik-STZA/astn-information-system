import { describe, it, expect } from "vitest";
import { executeRegistryReview, CUSTOM_TOOLS, SERVER_TOOLS } from "./registry-reviewer";

const job = { id: "11111111-1111-1111-1111-111111111111", agent: "registry-reviewer", instruction: "Review registry candidate c1." };
const candidate = { id: "c1", submitted_name: "Acme Sports", submitted_website: "https://acme.com" };

// A model that plays back the replies it is given, and records each request.
function scriptedModel(replies) {
  const requests = [];
  return {
    requests,
    messages: {
      create: async (req) => {
        requests.push(JSON.parse(JSON.stringify(req)));
        const next = replies.shift();
        if (!next) throw new Error("no more replies scripted");
        return { usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: next.searches ?? 0 } }, ...next };
      },
    },
  };
}

function fakeApi({ proposalOk = true } = {}) {
  const calls = [];
  return {
    calls,
    apiCall: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (path.endsWith("/candidate")) return candidate;
      return {};
    },
    apiRequest: async (method, path, body) => {
      calls.push(`${method} ${path}`);
      if (path.includes("/proposal")) return proposalOk ? { ok: true, status: 200, body: { saved: true } } : { ok: false, status: 400, body: { error: "the proposed record is not complete" } };
      return { ok: true, status: 200, body: { matches: [], body } };
    },
  };
}

const deps = (model, api) => ({ anthropic: model, model: "claude-sonnet-5", apiCall: api.apiCall, apiRequest: api.apiRequest, log: () => {} });

describe("registry reviewer", () => {
  it("offers only registry tools and Anthropic's web tools, and no way to add to the registry", () => {
    expect(CUSTOM_TOOLS.map((t) => t.name)).toEqual(["get_candidate", "search_registry", "get_reference", "record_proposal"]);
    expect(SERVER_TOOLS.map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
  });

  it("carries on after a paused search and succeeds once the proposal is recorded", async () => {
    const model = scriptedModel([
      { stop_reason: "pause_turn", searches: 2, content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Acme Sports" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "record_proposal", input: { verdict: "reject", verdict_reason: "Not African." } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Reject: based in Spain." }] },
    ]);
    const api = fakeApi();
    const r = await executeRegistryReview(job, deps(model, api));

    expect(r.status).toBe("succeeded");
    expect(r.output).toBe("Reject: based in Spain.");
    // The paused turn went back as the model's own message, without a cache marker.
    expect(model.requests[1].messages.at(-1).role).toBe("assistant");
    expect(JSON.stringify(model.requests[1].messages.at(-1))).not.toMatch(/cache_control/);
    expect(api.calls).toContain(`POST /api/registry/candidates/c1/proposal`);
    expect(r.toolsUsed).toEqual(expect.arrayContaining([{ name: "web_search", count: 1 }, { name: "record_proposal", count: 1 }]));
    // Two searches at a cent each on top of the tokens.
    expect(r.costUsd).toBeGreaterThanOrEqual(0.02);
  });

  it("fails the run and marks the candidate when no proposal was recorded", async () => {
    const model = scriptedModel([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "record_proposal", input: { verdict: "add", verdict_reason: "x" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "I could not complete the record." }] },
    ]);
    const api = fakeApi({ proposalOk: false });
    const r = await executeRegistryReview(job, deps(model, api));

    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/without recording a proposal/);
    expect(api.calls).toContain("POST /api/registry/candidates/c1/review-failed");
  });

  it("fails cleanly when the run has no candidate", async () => {
    const api = { apiCall: async () => { throw new Error("404"); }, apiRequest: async () => ({ ok: true }) };
    const r = await executeRegistryReview(job, deps(scriptedModel([]), api));
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/could not be read/);
  });
});
