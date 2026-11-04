import { describe, it, expect } from "vitest";
import { agentRecs, refusal } from "./agent-recs";

const REC = "11111111-1111-4111-8111-111111111111";
const job = { id: "run-1", agent: "fc", client: { slug: "acme" } };

describe("a refused rec step reaches the model as a refusal", () => {
  it("names the issues and says it did not happen", () => {
    const r = refusal({ status: 422, body: { issues: ["This is not with the FC for review"] } });
    expect(r.saved).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/^Refused, so this did not happen: This is not with the FC for review\./);
    expect(r.error).toMatch(/do not report this step as done/);
  });

  it("falls back to the error text, then the status", () => {
    expect(refusal({ status: 409, body: { error: "Already with a reviewer" } }).error).toMatch(/Already with a reviewer/);
    expect(refusal({ status: 500, body: null }).error).toMatch(/status 500/);
  });

  it("review_rec refused by the platform is not a pass", async () => {
    const tools = agentRecs({
      apiCall: async () => ({}),
      apiRequest: async () => ({ ok: false, status: 422, body: { issues: ["This is not with the FC for review"] } }),
      requesterOf: async () => "cfo@example.com",
    });
    const r = await tools.call(job, [], "review_rec", { rec_id: REC, pass: true, note: "Passing" });
    expect(r.saved).toBe(false);
    expect(r.error).toMatch(/not with the FC for review/);
  });
});
