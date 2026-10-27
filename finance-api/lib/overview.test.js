import { describe, expect, it } from "vitest";
import { overview, isOpen } from "./overview";

const today = "2026-10-27";
const client = { slug: "acme", name: "Acme Group", reporting_currency: "GBP" };

describe("finance overview", () => {
  const data = [{
    client,
    entities: 3,
    apItems: [
      { state: "exception" }, { state: "exception" }, { state: "clean" }, { state: "approved" },
      { state: "written", written_at: "2026-10-26T12:00:00Z" }, { state: "written", written_at: "2026-10-10T12:00:00Z" },
    ],
    wip: [
      { panel: "awaiting-decision", title: "VAT return" },
      { panel: "blocked-external", title: "Payroll journal", blocked_on: "Client: payroll file", updated_at: "2026-10-21T10:00:00Z" },
    ],
    openItems: [
      { title: "Chase supplier", status: "Open", is_closed: false, priority: "P1", due_at: "2026-10-20", owner_role: "AP" },
      { title: "Tidy", status: "DONE - filed", is_closed: false, priority: "P1", due_at: "2026-10-01" },
      { title: "Later", status: "Open", is_closed: false, priority: "P2", due_at: "2026-11-30" },
    ],
    runs: [{ agent: "fc", status: "succeeded", finished_at: "2026-10-27T14:06:00Z", queued_at: "2026-10-27T14:05:00Z" }, { agent: "ap-clerk", status: "queued", queued_at: "2026-10-27T15:00:00Z" }],
    packs: [{ period: "2026-09", status: "succeeded", finished_at: "2026-10-12T09:00:00Z" }],
  }];

  it("counts what needs the CFO, what is ready, and what went out this week", () => {
    const o = overview(data, today);
    expect(o.clients[0]).toMatchObject({
      entities: 3,
      bills: { for_you: 2, ready: 2, sent_this_week: 1 },
      approvals: { awaiting: 1, blocked: 1 },
      open_items: { open: 2, p1: 1, overdue: 1 },
      agents: { in_flight: 1, last: { agent: "fc", status: "succeeded" } },
      pack: { period: "2026-09", status: "succeeded" },
    });
    expect(o.totals).toEqual({ needs_you: 3, bills_for_you: 2, approvals_awaiting: 1, blocked: 2, tasks_open: 0, ready_to_send: 2, agents_in_flight: 1 });
  });

  it("lists what is stuck, oldest first, with why and where to go", () => {
    const o = overview(data, today);
    expect(o.blocked.map((b) => [b.kind, b.title, b.href])).toEqual([
      ["overdue", "Chase supplier", "/finance/clients/acme/open-items"],
      ["waiting", "Payroll journal", "/finance/clients/acme/approvals"],
    ]);
    expect(o.blocked[0].why).toBe("Overdue since 2026-10-20, with AP");
    expect(o.blocked[1].why).toBe("Client: payroll file");
  });

  it("treats a DONE status as done, but not Partially DONE", () => {
    expect(isOpen({ is_closed: false, status: "DONE" })).toBe(false);
    expect(isOpen({ is_closed: false, status: "Partially DONE" })).toBe(true);
    expect(isOpen({ is_closed: true, status: "Open" })).toBe(false);
  });
});

describe("Work in the overview", () => {
  it("counts open, blocked, waiting and overdue tasks, and lists the stuck ones with a link", () => {
    const tasks = [
      { id: "t1", title: "Management pack", due_on: "2026-11-10", blockers: [{ kind: "task", blocking_title: "Payroll journal", since: "2026-10-26T08:00:00Z" }] },
      { id: "t2", title: "Payroll journal", due_on: "2026-10-30", blockers: [{ kind: "external", party: "Client", description: "payroll file", since: "2026-10-21T10:00:00Z" }] },
      { id: "t3", title: "Approve retainer", due_on: "2026-10-24", blockers: [] },
      { id: "t4", title: "Later", due_on: null, blockers: [] },
    ];
    const o = overview([{ client, tasks }], today);
    expect(o.clients[0].work).toEqual({ open: 4, blocked: 1, waiting: 1, overdue: 1 });
    expect(o.blocked.map((b) => [b.kind, b.title, b.why, b.href])).toEqual([
      ["waiting", "Payroll journal", "Waiting on Client: payroll file", "/finance/clients/acme/work?task=t2"],
      ["overdue", "Approve retainer", "Overdue since 2026-10-24", "/finance/clients/acme/work?task=t3"],
      ["blocked", "Management pack", "Blocked by: Payroll journal", "/finance/clients/acme/work?task=t1"],
    ]);
    expect(o.totals.tasks_open).toBe(4);
  });
});
