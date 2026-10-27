import { describe, expect, it } from "vitest";
import { blockerText, eventText, ownerInitials, taskTree, type Task, type TaskBlocker } from "./work";

let n = 0;
const t = (id: string, parent: string | null, extra: Partial<Task> = {}): Task => ({
  id, parent_id: parent, entity_id: null, entity_slug: null, entity_name: null, title: id, notes: null, status: "todo",
  shown_status: "todo", priority: null, owner_kind: null, owner: null, start_on: null, due_on: null, position: 0,
  source: "manual", created_by: "jo@example.com", created_at: `2026-10-27T10:00:${String(n++).padStart(2, "0")}Z`, updated_at: "", closed_at: null,
  blockers: [], holds_up: [], ...extra,
});

describe("taskTree", () => {
  const tasks = [t("close", null), t("pack", "close", { position: 2 }), t("payroll", "close", { position: 1 }), t("vat", null), t("old", null, { status: "done" })];

  it("puts each parent before its sub-tasks, in position order", () => {
    expect(taskTree(tasks).map((r) => `${"-".repeat(r.depth)}${r.task.id}`)).toEqual(["close", "-payroll", "-pack", "vat", "old"]);
  });

  it("hides a collapsed parent's sub-tasks, and done tasks unless asked", () => {
    expect(taskTree(tasks, { collapsed: new Set(["close"]), showDone: false }).map((r) => r.task.id)).toEqual(["close", "vat"]);
    expect(taskTree(tasks, { collapsed: new Set(["close"]) })[0]).toMatchObject({ hasChildren: true, open: false });
  });

  it("keeps a done parent while any of its sub-tasks is still open", () => {
    const rows = taskTree([t("p", null, { status: "done" }), t("c", "p")], { showDone: false });
    expect(rows.map((r) => r.task.id)).toEqual(["p", "c"]);
  });
});

describe("wording", () => {
  const b = (x: Partial<TaskBlocker>): TaskBlocker => ({ id: "b", task_id: "t", kind: "external", open: true, since: "", chase_on: null,
    description: null, resolved_at: null, resolved_by: null, party: null, task: null, bill: null, ...x });

  it("says what holds a task up", () => {
    expect(blockerText(b({ kind: "external", party: "Client", description: "payroll file" }))).toBe("Waiting on Client: payroll file");
    expect(blockerText(b({ kind: "task", task: { id: "x", title: "Payroll journal", status: "todo" } }))).toBe("Blocked by: Payroll journal");
    expect(blockerText(b({ kind: "ap_item", bill: { id: "x", supplier: "Example Ltd", total: "422.91", currency: "GBP", state: "exception", entity: null } })))
      .toBe("Waiting for a Bills decision: Example Ltd (GBP 422.91)");
  });

  it("reads history rows as sentences", () => {
    expect(eventText({ id: "1", at: "", actor: "", action: "status", detail: { changes: { status: { from: "todo", to: "done" } } } })).toBe("Status: To do → Done");
    expect(eventText({ id: "2", at: "", actor: "", action: "changed", detail: { changes: { due_on: {}, title: {} } } })).toBe("Changed due date, title");
    expect(eventText({ id: "3", at: "", actor: "automatic", action: "unblocked", detail: { reason: "Payroll journal is done" } })).toBe("Unblocked: Payroll journal is done");
  });

  it("gives people and agents initials", () => {
    expect(ownerInitials({ owner_kind: "agent", owner: "fm1" })).toBe("F1");
    expect(ownerInitials({ owner_kind: "person", owner: "jo.bloggs@example.com" })).toBe("JB");
    expect(ownerInitials({ owner_kind: null, owner: null })).toBe("-");
  });
});
