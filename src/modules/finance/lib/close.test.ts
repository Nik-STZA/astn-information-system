import { describe, expect, it } from "vitest";
import { closeView, dueText, stepKey } from "./close";
import type { Task, TaskBlocker } from "./work";
import type { RecList, RecRow } from "./recs";
import type { JournalList, JournalRow } from "./journals";

let n = 0;
const t = (id: string, parent: string | null, extra: Partial<Task> = {}): Task => ({
  id, parent_id: parent, entity_id: null, entity_slug: null, entity_name: null, title: id, notes: null, status: "todo",
  shown_status: "todo", priority: null, owner_kind: "agent", owner: "fm1", start_on: null, due_on: "2026-11-04", position: n,
  source: "template", source_ref: null, created_by: "jo@example.com", created_at: `2026-11-01T10:00:${String(n++).padStart(2, "0")}Z`,
  updated_at: "", closed_at: null, blockers: [], holds_up: [], ...extra,
});
const ref = (k?: string) => `month-end:2026-10${k ? `:${k}` : ""}`;

const rec = (account_name: string, extra: Partial<RecRow> = {}): RecRow => ({
  id: account_name, account_name, codes: [], line: null, line_key: null, placed: true, proof: "schedule", status: "in_progress",
  owner: "fm1", challenge: null, class: null, with: null, ledger: "0", support: "0", difference: "0", ties: true, mixed_currency: false,
  sole_reviewer: true, recheck_reason: null, workable: true, companies: 1, prior_status: null, ...extra,
});
const recList = (recs: RecRow[], priorOpen = false): RecList => ({
  period: "2026-10", label: "October 2026", prior: { period: "2026-09", label: "September 2026", open: priorOpen },
  composed_at: "2026-11-02T09:00:00Z", entity_errors: [], notes: [], entities: [], lines: [],
  counts: { total: recs.length, signed_off: recs.filter((r) => r.status === "signed_off").length, recheck: 0 }, recs,
});
const journals = (states: JournalRow["state"][]): JournalList => ({
  period: "2026-10", label: "October 2026", entities: [],
  journals: states.map((state, i) => ({ id: `j${i}`, state } as JournalRow)),
});

const block = (taskId: string, blocking: Task): TaskBlocker => ({
  id: `b-${taskId}`, task_id: taskId, kind: "task", open: blocking.status !== "done", since: "", chase_on: null, description: null,
  resolved_at: null, resolved_by: null, party: null, task: { id: blocking.id, title: blocking.title, status: blocking.status }, bill: null,
});

function month() {
  const close = t("close", null, { source_ref: ref(), title: "Month-end close: October 2026", owner_kind: "person", owner: "jo@example.com" });
  const bank = t("bank", "close", { source_ref: ref("bank"), title: "Bank reconciliations", status: "done", shown_status: "done" });
  const bankA = t("bankA", "bank", { source_ref: ref("bank:e1"), status: "done", shown_status: "done" });
  const bankB = t("bankB", "bank", { source_ref: ref("bank:e2"), status: "done", shown_status: "done" });
  const ap = t("ap", "close", { source_ref: ref("ap"), title: "Supplier bills in for the month", owner: "ap-clerk", due_on: "2026-11-03" });
  const accruals = t("accruals", "close", { source_ref: ref("accruals"), title: "Accruals and prepayments", shown_status: "blocked" });
  accruals.blockers = [block("accruals", ap)];
  const signOff = t("sign-off", "close", { source_ref: ref("sign-off"), title: "CFO sign-off", owner_kind: "person", owner: "jo@example.com" });
  const other = t("other", null, { source: "manual", title: "Not part of the close" });
  return { close, bank, bankA, bankB, ap, accruals, signOff, other };
}

const args = (tasks: Task[], extra = {}) => ({
  period: "2026-10", tasks, slug: "acme", today: "2026-11-04",
  recs: recList([rec("Prepayments", { status: "signed_off" }), rec("Accruals", { ties: false })]),
  journals: journals(["proposed", "draft_created"]),
  review: { for_you: 3, by_kind: { bill: 2 } },
  ...extra,
});

describe("stepKey", () => {
  it("reads the template step from a source_ref, and nothing from another month or a hand-made task", () => {
    expect(stepKey("month-end:2026-10:bank", "2026-10")).toBe("bank");
    expect(stepKey("month-end:2026-10:bank:e1", "2026-10")).toBe("bank");
    expect(stepKey("month-end:2026-09:bank", "2026-10")).toBeNull();
    expect(stepKey("month-end:2026-10", "2026-10")).toBeNull();
    expect(stepKey(null, "2026-10")).toBeNull();
  });
});

describe("closeView", () => {
  it("says the month is not started when Work has no close for it", () => {
    const v = closeView(args([month().other]));
    expect(v.started).toBe(false);
    expect(v.steps).toEqual([]);
    expect(v.readyToSignOff).toBe(false);
  });

  it("lists the close's steps in order, with sign-off kept apart", () => {
    const m = month();
    const v = closeView(args(Object.values(m)));
    expect(v.started).toBe(true);
    expect(v.steps.map((s) => s.key)).toEqual(["bank", "ap", "accruals"]);
    expect(v.signOff?.key).toBe("sign-off");
    expect(v.done).toBe(1);
    expect(v.total).toBe(3);
  });

  it("counts companies, what a step waits for, and lateness", () => {
    const v = closeView(args(Object.values(month())));
    const [bank, ap, accruals] = v.steps;
    expect(bank.companies).toEqual({ done: 2, total: 2 });
    expect(bank.late).toBe(false);
    expect(ap.late).toBe(true);
    expect(ap.owner).toBe("AP Clerk");
    expect(accruals.waitsFor).toEqual(["Supplier bills in for the month"]);
    expect(accruals.statusLabel).toBe("Blocked");
    expect(accruals.href).toBe("/finance/clients/acme/work?task=accruals");
  });

  it("shows the month's evidence on the steps it belongs to", () => {
    const v = closeView(args(Object.values(month())));
    const ap = v.steps.find((s) => s.key === "ap");
    const accruals = v.steps.find((s) => s.key === "accruals");
    expect(ap?.evidence).toMatchObject({ text: "2 bills still open in Bills", tone: "amber" });
    expect(accruals?.evidence).toMatchObject({ text: "1 of 2 recs signed off, 1 not tying", tone: "red" });
    expect(v.steps.find((s) => s.key === "bank")?.evidence).toBeNull();
  });

  it("does not call a rec nobody has started 'not tying'", () => {
    const v = closeView(args(Object.values(month()), { recs: recList([rec("Accruals", { status: "not_started", ties: false }), rec("Prepayments", { status: "not_started", ties: false })]) }));
    expect(v.recs?.not_tying).toBe(0);
    expect(v.steps.find((s) => s.key === "accruals")?.evidence).toMatchObject({ text: "0 of 2 recs signed off", tone: "amber" });
  });

  it("lists what is left before sign-off, and is not ready while anything is", () => {
    const v = closeView(args(Object.values(month()), { recs: recList([rec("Prepayments")], true) }));
    expect(v.left.map((l) => l.text)).toEqual([
      "2 steps not done: Supplier bills in for the month, Accruals and prepayments",
      "1 reconciliation not signed off",
      "1 journal waiting for approval",
      "September 2026 is still open",
    ]);
    expect(v.priorOpen?.href).toBe("/finance/clients/acme/close?period=2026-09");
    expect(v.readyToSignOff).toBe(false);
  });

  it("is ready to sign off once every step, rec and journal is through", () => {
    const m = month();
    for (const k of ["ap", "accruals"] as const) { m[k].status = "done"; m[k].shown_status = "done"; }
    m.accruals.blockers = [];
    const v = closeView(args(Object.values(m), {
      recs: recList([rec("Prepayments", { status: "signed_off" })]),
      journals: journals(["draft_created"]),
    }));
    expect(v.left).toEqual([]);
    expect(v.readyToSignOff).toBe(true);
    expect(v.signedOff).toBe(false);
  });

  it("does not offer sign-off twice, and copes with sources it could not read", () => {
    const m = month();
    for (const k of ["ap", "accruals", "signOff"] as const) { m[k].status = "done"; m[k].shown_status = "done"; }
    const v = closeView(args(Object.values(m), { recs: null, journals: null, review: null }));
    expect(v.signedOff).toBe(true);
    expect(v.readyToSignOff).toBe(false);
    expect(v.recs).toBeNull();
    expect(v.journalsWaiting).toBeNull();
    expect(v.steps.find((s) => s.key === "ap")?.evidence).toBeNull();
  });
});

describe("dueText", () => {
  it("says when a step is due, as a person would", () => {
    expect(dueText("2026-11-06", "2026-11-04")).toBe("Due 6 Nov");
    expect(dueText("2026-11-04", "2026-11-04")).toBe("Due today");
    expect(dueText("2026-11-02", "2026-11-04")).toBe("Was due 2 Nov");
    expect(dueText(null, "2026-11-04")).toBe("No due date");
  });
});

describe("worked in place", () => {
  it("gives each step its own recs and companies, and counts what FM1 can start", async () => {
    const { nextOpen, recsForStep, canStart } = await import("./close");
    const m = month();
    const v = closeView(args(Object.values(m), {
      recs: recList([rec("Prepayments", { status: "signed_off" }), rec("Accruals", { status: "not_started" }), rec("Business Bank", { status: "with_fc" }), rec("Patents", { workable: false, status: "not_started" })]),
    }));
    const accruals = v.steps.find((s) => s.key === "accruals")!;
    expect(accruals.recs.map((r) => r.account_name)).toEqual(["Prepayments", "Accruals"]);
    expect(v.steps.find((s) => s.key === "bank")!.subs.map((x) => x.done)).toEqual([true, true]);
    expect(v.startable).toBe(1);
    expect(canStart(rec("x", { status: "sent_back" }))).toBe(true);
    expect(canStart(rec("x", { status: "with_cfo" }))).toBe(false);
    expect(recsForStep("bs-recs", [rec("a"), rec("b")])).toHaveLength(2);
    expect(recsForStep(null, [rec("a")])).toEqual([]);
    // After the bills step, the next not done; done steps are passed over.
    expect(nextOpen(v.steps, m.ap.id)?.task.id).toBe("accruals");
    expect(nextOpen(v.steps, m.accruals.id)?.task.id).toBe("ap");
  });
});

describe("recs under a step", () => {
  it("by matrix line first, so a bank named for its bank sits under Bank; by name when unplaced", async () => {
    const { recsForStep } = await import("./close");
    const list = [rec("HSBC Innovation: Alpha", { line_key: "cash" }), rec("Business Bank"), rec("Beta Intercompany Loan", { line_key: "loans" }), rec("Directors' Loan", { line_key: "loans" }), rec("VAT", { line_key: "vat" })];
    expect(recsForStep("bank", list).map((r) => r.account_name)).toEqual(["HSBC Innovation: Alpha", "Business Bank"]);
    expect(recsForStep("intercompany", list).map((r) => r.account_name)).toEqual(["Beta Intercompany Loan"]);
    expect(recsForStep("vat", list).map((r) => r.account_name)).toEqual(["VAT"]);
  });
});
