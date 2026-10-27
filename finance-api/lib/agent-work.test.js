import { describe, expect, it } from "vitest";
import { agentWork, taskView } from "./agent-work";

const RUN = "6306a21a-8684-4fd8-8c71-4180c464b6b9";
const TASK = "00000000-0000-4000-8000-000000000001";
const job = { id: RUN, agent: "fm1", client: { slug: "acme" } };
const entities = [{ id: "00000000-0000-4000-8000-0000000000e1", slug: "acme-ltd" }];

// Records what the runner would send to finance-api.
function stub(answer = () => ({ ok: true, status: 201, body: { id: TASK } })) {
  const sent = [];
  const work = agentWork({
    apiCall: async () => ({ tasks: [] }),
    apiRequest: async (method, path, body, headers) => { sent.push({ method, path, body, headers }); return answer(method, path); },
    requesterOf: async () => "cfo@example.com",
  });
  return { work, sent };
}

describe("agent work tools", () => {
  it("adds a task as the person who asked, naming the agent and run", async () => {
    const { work, sent } = stub();
    const r = await work.call(job, entities, "add_task", { title: "Clear 776", notes: "GBP 3,900", entity: "acme-ltd", waiting_on: { party: "Client" } });
    expect(r).toMatchObject({ saved: true, task_id: TASK });
    expect(sent[0]).toEqual({
      method: "POST", path: "/api/finance/clients/acme/tasks",
      body: { title: "Clear 776", notes: "GBP 3,900", entity_id: entities[0].id },
      headers: { "X-Actor-Email": "cfo@example.com", "X-Work-Via": `agent:fm1:${RUN}` },
    });
    expect(sent[1]).toMatchObject({ path: `/api/finance/clients/acme/tasks/${TASK}/blockers`, body: { kind: "external", party: "Client" } });
  });

  it("updates with the change and then the note", async () => {
    const { work, sent } = stub(() => ({ ok: true, status: 200, body: {} }));
    expect(await work.call(job, entities, "update_task", { task_id: TASK, status: "review", note: "Traced" })).toMatchObject({ saved: true });
    expect(sent.map((x) => [x.method, x.path.split("/").slice(-1)[0], x.body])).toEqual([["PATCH", TASK, { status: "review" }], ["POST", "notes", { text: "Traced" }]]);
  });

  it("hands a refusal back and stops", async () => {
    const { work, sent } = stub(() => ({ ok: false, status: 422, body: { issues: ["no"] } }));
    expect(await work.call(job, entities, "update_task", { task_id: TASK, owner: "x", owner_kind: "agent", note: "n" }))
      .toEqual({ saved: false, status: 422, refused: { issues: ["no"] } });
    expect(sent).toHaveLength(1);
    expect(await work.call(job, entities, "add_task", { title: "x", notes: "x", entity: "nope" })).toMatchObject({ saved: false });
  });

  it("shows a task's open waits in words", () => {
    expect(taskView({ id: TASK, title: "t", shown_status: "waiting", blockers: [
      { open: true, kind: "external", party: "HMRC", description: "VAT query" },
      { open: false, kind: "external", party: "Bank" },
    ] }).waiting_on).toEqual(["HMRC: VAT query"]);
  });
});
