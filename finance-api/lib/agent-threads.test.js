import { describe, expect, it, vi } from "vitest";
const { agentThreads, entryView, openSummary } = require("./agent-threads");

const job = { id: "run-1", agent: "fm1", client: { slug: "acme" } };
const entry = (over = {}) => ({ id: "e1", subject_kind: "account", subject_key: "11111111-1111-1111-1111-111111111111:776", period: "2026-10",
  kind: "question", body: "Is the  firmware\nsoftware?", open: true, created_at: "2026-11-18T10:00:00Z", by: { name: "Nik M" }, replies: [], ...over });

function harness(reply = { ok: true, status: 201, body: { id: "new" } }) {
  const apiRequest = vi.fn(async () => reply);
  const apiCall = vi.fn(async () => ({ threads: [entry(), entry({ id: "e2", open: false })] }));
  const requesterOf = vi.fn(async () => "cfo@example.com");
  return { t: agentThreads({ apiCall, apiRequest, requesterOf }), apiRequest, apiCall, requesterOf };
}

describe("agent threads", () => {
  it("reads the subjects asked for, the month and only what waits", async () => {
    const h = harness({ ok: true, status: 200, body: { threads: [entry()], open: 1 } });
    const r = await h.t.call(job, "read_threads", { subjects: [{ kind: "asset", key: "a1" }], period: "2026-10", open_only: true });
    const url = h.apiRequest.mock.calls[0][1];
    expect(url).toBe("/api/finance/clients/acme/threads?s=asset%7Ca1&period=2026-10&open=true");
    expect(r).toMatchObject({ count: 1, open: 1 });
    expect(r.entries[0]).toMatchObject({ id: "e1", about: "account:11111111-1111-1111-1111-111111111111:776", waits_on_decision: true, by: "Nik M", at: "2026-11-18" });
  });

  it("writes as the person who asked, naming the agent and run", async () => {
    const h = harness();
    const r = await h.t.call(job, "add_thread_entry", { subject_kind: "asset", subject_key: "a1", kind: "finding", body: "Cost ties to the bill" });
    const [method, , body, headers] = h.apiRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(body).toEqual({ subject_kind: "asset", subject_key: "a1", kind: "finding", body: "Cost ties to the bill" });
    expect(headers).toEqual({ "X-Actor-Email": "cfo@example.com", "X-Work-Via": "agent:fm1:run-1" });
    expect(r).toMatchObject({ saved: true, id: "new" });
  });

  it("never records a decision for a person", async () => {
    const h = harness();
    const r = await h.t.call(job, "add_thread_entry", { subject_kind: "asset", subject_key: "a1", kind: "decision", body: "Capitalise it" });
    expect(r.saved).toBe(false);
    expect(h.apiRequest).not.toHaveBeenCalled();
  });

  it("hands a refusal back intact", async () => {
    const h = harness({ ok: false, status: 422, body: { issues: ["an account thread needs its period"] } });
    const r = await h.t.call(job, "add_thread_entry", { subject_kind: "account", subject_key: "x:1", kind: "note", body: "x" });
    expect(r).toEqual({ saved: false, status: 422, refused: { issues: ["an account thread needs its period"] } });
  });

  it("starts each run knowing what waits on a decision, in a line each", async () => {
    const h = harness();
    const c = await h.t.context(job);
    expect(c).toContain("Waiting on a decision in this client's threads (1)");
    expect(c).toContain("account:11111111-1111-1111-1111-111111111111:776 (2026-10), Nik M: Is the firmware software?");
    expect(openSummary([entry({ open: false })])).toBe("");
  });

  it("says nothing when the threads cannot be read", async () => {
    const apiCall = vi.fn(async () => { throw new Error("503"); });
    const t = agentThreads({ apiCall, apiRequest: vi.fn(), requesterOf: vi.fn() });
    expect(await t.context(job)).toBe("");
  });

  it("shows replies under their entry", () => {
    expect(entryView(entry({ replies: [{ id: "r1", kind: "decision", body: "Software", created_at: "2026-11-18T11:00:00Z", by: { name: "Nik M" } }] })).replies)
      .toEqual([{ id: "r1", kind: "decision", by: "Nik M", at: "2026-11-18", text: "Software" }]);
  });
});
