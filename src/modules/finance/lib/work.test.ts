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

import { boardColumns } from "./work";

describe("boardColumns", () => {
  const tasks = [
    t("close", null),
    t("payroll", "close", { shown_status: "waiting", status: "todo" }),
    t("pack", "close", { shown_status: "blocked", priority: "P1", due_on: "2026-11-10" }),
    t("prepay", "close", { due_on: "2026-11-03" }),
    t("urgent", null, { priority: "P1", due_on: "2026-11-20" }),
    t("bank", "close", { shown_status: "done", status: "done" }),
  ];

  it("shows the pieces of work, not the parents, each in its status column", () => {
    const cols = boardColumns(tasks);
    expect(cols.map((c) => c.status)).toEqual(["todo", "in_progress", "blocked", "waiting", "review"]);
    expect(cols.flatMap((c) => c.tasks.map((x) => x.id))).not.toContain("close");
    expect(cols.find((c) => c.status === "waiting")!.tasks.map((x) => [x.id, x.parentTitle])).toEqual([["payroll", "close"]]);
  });

  it("puts P1 first, then the earliest due date", () => {
    expect(boardColumns(tasks).find((c) => c.status === "todo")!.tasks.map((x) => x.id)).toEqual(["urgent", "prepay"]);
  });

  it("adds the Done column only when asked", () => {
    expect(boardColumns(tasks, { showDone: true }).at(-1)).toMatchObject({ status: "done", tasks: [{ id: "bank" }] });
  });
});

import { timelineLayout } from "./work";

describe("timelineLayout", () => {
  const blockedBy = (id: string): TaskBlocker => ({ id: `b-${id}`, task_id: "x", kind: "task", open: true, since: "", chase_on: null,
    description: null, resolved_at: null, resolved_by: null, party: null, task: { id, title: id, status: "todo" }, bill: null });
  const tasks = [
    t("close", null),
    t("payroll", "close", { start_on: "2026-10-26", due_on: "2026-10-30" }),
    t("pack", "close", { due_on: "2026-11-10", start_on: "2026-11-05", blockers: [blockedBy("payroll")] }),
    t("undated", null),
  ];

  it("spans a parent with no dates over its sub-tasks, and pads the range", () => {
    const l = timelineLayout(taskTree(tasks), tasks, "2026-10-27");
    expect(l.first).toBe("2026-10-23");
    expect(l.days.at(-1)).toBe("2026-11-13");
    expect(l.todayIndex).toBe(4);
    const close = l.bars.find((b) => b.id === "close")!;
    expect(close).toMatchObject({ row: 0, from: 3, to: 18, parent: true, dated: false });
    expect(l.bars.find((b) => b.id === "pack")).toMatchObject({ from: 13, to: 18, parent: false });
  });

  it("draws no bar for a task with no dates, and links blocking to blocked", () => {
    const l = timelineLayout(taskTree(tasks), tasks, "2026-10-27");
    expect(l.bars.map((b) => b.id)).not.toContain("undated");
    expect(l.links).toEqual([{ from: "payroll", to: "pack" }]);
  });

  it("drops links to a collapsed sub-task", () => {
    const l = timelineLayout(taskTree(tasks, { collapsed: new Set(["close"]) }), tasks, "2026-10-27");
    expect(l.links).toEqual([]);
    expect(l.bars.map((b) => b.id)).toEqual(["close"]);
  });
});

describe("timelineLayout scheduling", () => {
  it("starts a task with only a due date after the tasks blocking it", () => {
    const by = (id: string): TaskBlocker => ({ id: `b-${id}`, task_id: "x", kind: "task", open: true, since: "", chase_on: null,
      description: null, resolved_at: null, resolved_by: null, party: null, task: { id, title: id, status: "todo" }, bill: null });
    const tasks = [
      t("payroll", null, { due_on: "2026-10-30", created_at: "2026-10-27T09:00:00Z" }),
      t("prepay", null, { due_on: "2026-11-03", created_at: "2026-10-27T09:00:00Z" }),
      t("pack", null, { due_on: "2026-11-10", created_at: "2026-10-27T09:00:00Z", blockers: [by("payroll"), by("prepay")] }),
    ];
    const l = timelineLayout(taskTree(tasks), tasks, "2026-10-27");
    const day = (id: string) => l.days[l.bars.find((b) => b.id === id)!.from];
    expect(day("payroll")).toBe("2026-10-27");
    expect(day("pack")).toBe("2026-11-04");
  });
});
