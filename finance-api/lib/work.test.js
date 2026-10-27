import { describe, expect, it } from "vitest";
import { taskInput, blockerInput, blockerOpen, shownStatus, wouldLoop, wouldNestLoop, changes } from "./work";

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";

describe("taskInput", () => {
  it("cleans a new task and needs a title", () => {
    expect(taskInput({ title: "  Q3 VAT return ", priority: "P1", owner_kind: "agent", owner: "fm1", due_on: "2026-11-07" }))
      .toEqual({ issues: [], fields: { title: "Q3 VAT return", priority: "P1", owner_kind: "agent", owner: "fm1", due_on: "2026-11-07" } });
    expect(taskInput({}).issues).toEqual(["a title is required"]);
  });

  it("refuses bad statuses, owners, dates and unknown fields", () => {
    const r = taskInput({ title: "x", status: "blocked", owner_kind: "agent", owner: "robot", start_on: "2026-11-09", due_on: "2026-11-01", client_id: "x" });
    expect(r.issues).toEqual([
      "client_id cannot be set here",
      "status must be one of todo, in_progress, review, done",
      "an agent owner is one of ap-clerk, ar-clerk, fm1, fm2, fc, fpa",
      "the start date is after the due date",
    ]);
    expect(taskInput({ title: "x", owner_kind: "person", owner: "not-an-email" }).issues).toEqual(["a person owner is an email address"]);
    expect(taskInput({ title: "x", owner: "jo@example.com" }).issues).toEqual(["owner and owner_kind go together"]);
    expect(taskInput({ title: "x", due_on: "2026-02-30" }).issues).toEqual(["due_on must be a date (YYYY-MM-DD)"]);
  });

  it("checks an edit against the task as it stands", () => {
    const current = { id: ID1, start_on: "2026-11-05", due_on: "2026-11-10" };
    expect(taskInput({ due_on: "2026-11-01" }, { partial: true, current }).issues).toEqual(["the start date is after the due date"]);
    expect(taskInput({ parent_id: ID1 }, { partial: true, current }).issues).toEqual(["a task cannot be its own parent"]);
    expect(taskInput({ status: "done" }, { partial: true, current })).toEqual({ issues: [], fields: { status: "done" } });
  });
});

describe("blockers and the shown status", () => {
  it("clears a task blocker when that task is done, and a Bills blocker when the bill is decided", () => {
    const tb = { kind: "task", blocking_task_id: ID2 };
    expect(blockerOpen(tb, { blockingTask: { status: "in_progress" } })).toBe(true);
    expect(blockerOpen(tb, { blockingTask: { status: "done" } })).toBe(false);
    const ab = { kind: "ap_item", ap_item_id: ID3 };
    expect(blockerOpen(ab, { apItem: { state: "exception" } })).toBe(true);
    expect(blockerOpen(ab, { apItem: { state: "written" } })).toBe(false);
    expect(blockerOpen({ kind: "external", party: "Client", resolved_at: "2026-10-27" })).toBe(false);
  });

  it("shows Blocked for a task or Bills blocker, Waiting for an outside one, and done as done", () => {
    expect(shownStatus({ status: "todo" }, [{ kind: "external" }])).toBe("waiting");
    expect(shownStatus({ status: "in_progress" }, [{ kind: "external" }, { kind: "ap_item" }])).toBe("blocked");
    expect(shownStatus({ status: "done" }, [{ kind: "task" }])).toBe("done");
    expect(shownStatus({ status: "review" }, [])).toBe("review");
  });

  it("cleans a blocker as sent", () => {
    expect(blockerInput({ kind: "external", party: " Client ", description: "September payroll file", chase_on: "2026-10-28" }))
      .toEqual({ issues: [], fields: { kind: "external", party: "Client", description: "September payroll file", chase_on: "2026-10-28" } });
    expect(blockerInput({ kind: "external" }).issues).toEqual(["say who it is waiting on (client, supplier, HMRC...)"]);
    expect(blockerInput({ kind: "nope" }).issues).toEqual(["kind must be task, ap_item or external"]);
  });
});

describe("loops", () => {
  it("refuses a blocker that would make two tasks wait for each other", () => {
    const edges = [{ task_id: ID2, blocking_task_id: ID3 }, { task_id: ID3, blocking_task_id: ID1 }];
    expect(wouldLoop(ID1, ID2, edges)).toBe(true);
    expect(wouldLoop(ID3, ID2, [])).toBe(false);
    expect(wouldLoop(ID1, ID1, [])).toBe(true);
  });

  it("refuses a parent that is the task's own sub-task", () => {
    const tasks = [{ id: ID1, parent_id: null }, { id: ID2, parent_id: ID1 }, { id: ID3, parent_id: ID2 }];
    expect(wouldNestLoop(ID1, ID3, tasks)).toBe(true);
    expect(wouldNestLoop(ID3, ID1, tasks)).toBe(false);
  });
});

describe("changes", () => {
  it("records only what moved, dates compared as dates", () => {
    expect(changes({ title: "A", due_on: new Date("2026-11-07T00:00:00Z"), status: "todo" }, { title: "A", due_on: "2026-11-07", status: "done" }))
      .toEqual({ status: { from: "todo", to: "done" } });
  });
});

import { openItemTask } from "./work";

describe("open items into tasks", () => {
  const base = { id: "oi-1", title: " Chase HSBC for the facility letter ", is_closed: false, priority: "P1", owner_label: "CFO",
    category: "Financial reporting", ref: "C7", notes: "Letter needed for audit." };

  it("leaves done items out, but not partly done ones", () => {
    expect(openItemTask({ ...base, status: "DONE (with parked follow-on)" })).toBeNull();
    expect(openItemTask({ ...base, status: "Open", is_closed: true })).toBeNull();
    expect(openItemTask({ ...base, status: "Partially DONE (schema); reader pending" }).task.status).toBe("in_progress");
  });

  it("turns an outside wait into a Waiting blocker and keeps the register's words", () => {
    const r = openItemTask({ ...base, status: "Awaiting external (HSBC) - repeated CFO chase, no reply" });
    expect(r.task).toMatchObject({ title: "Chase HSBC for the facility letter", status: "todo", priority: "P1", source: "open_item", source_ref: "oi-1" });
    expect(r.blockers).toEqual([{ kind: "external", party: "HSBC", description: "Awaiting external (HSBC) - repeated CFO chase, no reply" }]);
    expect(r.task.notes).toBe("Letter needed for audit.\nFrom the open-items register:\nRef: C7\nStatus: Awaiting external (HSBC) - repeated CFO chase, no reply\nOwner: CFO\nCategory: Financial reporting");
  });

  it("reads a paused decision as waiting on that person", () => {
    expect(openItemTask({ ...base, status: "Paused pending CEO decision" }).blockers[0]).toMatchObject({ kind: "external", party: "CEO" });
    expect(openItemTask({ ...base, status: "In progress" })).toMatchObject({ task: { status: "in_progress" }, blockers: [] });
  });
});
