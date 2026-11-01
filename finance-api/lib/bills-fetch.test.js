import { describe, expect, it } from "vitest";
const { fetchClient } = require("./bills-fetch");

function fake({ runs = [], entities = ["a", "b"], intake = {} } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (path.endsWith("/agent-runs") && method === "GET") return { ok: true, body: { data: runs } };
    if (path.endsWith("/entities")) return { ok: true, body: { data: entities.map((slug) => ({ slug })) } };
    if (path.endsWith("/agent-runs")) return { ok: true, status: 201, body: { id: "r", got: body } };
    const slug = path.split("/xero/")[1].split("/")[0];
    const answers = intake[slug] ?? [{ ok: true, body: { remaining: 0, results: [] } }];
    return answers.length > 1 ? answers.shift() : answers[0];
  };
  return { call, calls, started: () => calls.filter((c) => c.startsWith("POST") && c.endsWith("/agent-runs")).length };
}
const read = (results, remaining = 0) => ({ ok: true, body: { remaining, results } });

describe("fetchClient", () => {
  it("leaves a client alone while agents are working", async () => {
    const f = fake({ runs: [{ status: "running", agent: "fm2", queued_at: "2026-11-02T06:30:00Z" }] });
    const r = await fetchClient("c", f.call, () => {}, Date.parse("2026-11-02T07:00:00Z"));
    expect(r.skipped).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
  it("is not held up by a run with no agent, or one stuck for hours", async () => {
    const now = Date.parse("2026-11-02T07:00:00Z");
    const noAgent = fake({ runs: [{ status: "running", agent: null, queued_at: "2026-11-02T06:59:00Z" }] });
    expect((await fetchClient("c", noAgent.call, () => {}, now)).skipped).toBeUndefined();
    const stuck = fake({ runs: [{ status: "running", agent: "fc", queued_at: "2026-11-02T04:59:00Z" }] });
    expect((await fetchClient("c", stuck.call, () => {}, now)).skipped).toBeUndefined();
  });
  it("reads every company and starts no agent when nothing is queued", async () => {
    const f = fake();
    expect((await fetchClient("c", f.call, () => {})).failures).toEqual([]);
    expect(f.calls.filter((c) => c.includes("/ap/intake"))).toHaveLength(2);
    expect(f.started()).toBe(0);
  });
  it("keeps reading until nothing remains, then starts one AP Clerk", async () => {
    const f = fake({ intake: { a: [read([{ state: "exception" }], 2), read([{ state: "clean" }, { skipped: true }])] } });
    await fetchClient("c", f.call, () => {});
    expect(f.calls.filter((c) => c.includes("/a/ap/intake"))).toHaveLength(2);
    expect(f.started()).toBe(1);
  });
  it("reports one company's failure and carries on with the next", async () => {
    const f = fake({ intake: { a: [{ ok: false, status: 502 }], b: [read([{ state: "clean" }])] } });
    const r = await fetchClient("c", f.call, () => {});
    expect(r.failures).toEqual(["c/a: fetch failed (502)"]);
    expect(f.started()).toBe(1);
  });
  it("stops at the call limit", async () => {
    const f = fake({ entities: ["a"], intake: { a: [read([], 5)] } });
    await fetchClient("c", f.call, () => {});
    expect(f.calls.filter((c) => c.includes("/ap/intake"))).toHaveLength(10);
  });
});
