import { describe, expect, it } from "vitest";
import { closePlan, monthEnd, workingDay } from "./month-end";

const A = { id: "00000000-0000-4000-8000-0000000000a1", name: "Acme Ltd" };
const B = { id: "00000000-0000-4000-8000-0000000000b2", name: "Acme Holdings" };

describe("dates", () => {
  it("finds the month end and counts working days past weekends", () => {
    expect(monthEnd("2026-09").toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(monthEnd("2026-02").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(monthEnd("2026-13")).toBeNull();
    // 31 Oct 2026 is a Saturday: working day 1 is Monday 2 November.
    expect(workingDay(monthEnd("2026-10"), 1).toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(workingDay(monthEnd("2026-10"), 7).toISOString().slice(0, 10)).toBe("2026-11-10");
  });
});

describe("closePlan", () => {
  it("refuses a bad month or no one to sign off", () => {
    expect(closePlan({ period: "Sept", cfo: "a@b.c" }).issues).toEqual(["period must be a month (YYYY-MM)"]);
    expect(closePlan({ period: "2026-09" }).issues).toEqual(["the person signing off is needed"]);
  });

  it("makes a one-company close without intercompany, VAT or per-company sub-tasks", () => {
    const p = closePlan({ period: "2026-09", entities: [A], cfo: "cfo@example.com" });
    expect(p.label).toBe("September 2026");
    expect(p.tasks.map((t) => t.key)).toEqual(["close", "bank", "ap", "ar", "revenue", "payroll", "accruals", "fixed-assets", "bs-recs", "fc-review", "pack", "sign-off"]);
    expect(p.tasks[0]).toMatchObject({ title: "Month-end close: September 2026", owner: "cfo@example.com", start_on: "2026-10-01", due_on: "2026-10-09", source_ref: "month-end:2026-09" });
    expect(p.tasks.find((t) => t.key === "sign-off")).toMatchObject({ owner_kind: "person", owner: "cfo@example.com", due_on: "2026-10-09" });
    expect(p.tasks.find((t) => t.key === "bank")).toMatchObject({ owner_kind: "agent", owner: "fm1", due_on: "2026-10-02", source_ref: "month-end:2026-09:bank" });
    // Waits only on steps that are in this close.
    expect(p.blockers.filter((b) => b.task_key === "bs-recs").map((b) => b.blocking_key)).toEqual(["bank", "ap", "ar", "revenue", "payroll", "accruals", "fixed-assets"]);
    expect(p.blockers.find((b) => b.task_key === "sign-off")).toEqual({ task_key: "sign-off", blocking_key: "pack" });
    expect(p.tasks.find((t) => t.key === "revenue")).toMatchObject({ title: "Revenue and deferred revenue", owner: "fm1", due_on: "2026-10-05" });
    expect(p.blockers).toContainEqual({ task_key: "revenue", blocking_key: "ar" });
  });

  it("adds intercompany, VAT and a sub-task per company for a group", () => {
    const p = closePlan({ period: "2026-09", entities: [A, B], vat: true, cfo: "cfo@example.com" });
    const keys = p.tasks.map((t) => t.key);
    expect(keys).toContain("intercompany");
    expect(keys).toContain("vat");
    expect(p.tasks.filter((t) => t.parent_key === "bank").map((t) => [t.title, t.entity_id])).toEqual([["Bank reconciliations: Acme Ltd", A.id], ["Bank reconciliations: Acme Holdings", B.id]]);
    expect(p.tasks.filter((t) => t.parent_key === "bs-recs")).toHaveLength(2);
    expect(p.blockers).toContainEqual({ task_key: "sign-off", blocking_key: "vat" });
    expect(new Set(p.tasks.map((t) => t.source_ref)).size).toBe(p.tasks.length);
  });

  it("never makes a loop", () => {
    const p = closePlan({ period: "2026-09", entities: [A, B], vat: true, cfo: "cfo@example.com" });
    const order = p.tasks.map((t) => t.key);
    for (const b of p.blockers) expect(order.indexOf(b.blocking_key)).toBeLessThan(order.indexOf(b.task_key));
  });
});
