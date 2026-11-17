import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const t = require("./threads");

const ACC = "11111111-0000-0000-0000-000000000001:776";
const ID = "22222222-0000-0000-0000-000000000002";

describe("subjects", () => {
  it("knows each subject's key", () => {
    expect(t.subjectIssue("account", ACC)).toBeNull();
    expect(t.subjectIssue("account", "776")).toMatch(/company id/);
    expect(t.subjectIssue("asset", ID)).toBeNull();
    expect(t.subjectIssue("cost_line", "nope")).toMatch(/cost line's key is its id/);
    expect(t.subjectIssue("register_month", "ip_registered")).toBeNull();
    expect(t.subjectIssue("invoice", ID)).toMatch(/subject_kind must be one of/);
  });
});

describe("a new entry", () => {
  it("is cleaned", () => {
    const r = t.entryInput({ subject_kind: "account", subject_key: ACC, period: "2026-10", kind: "note", body: "  Agreed.  " });
    expect(r.issues).toEqual([]);
    expect(r.entry).toMatchObject({ subject_kind: "account", period: "2026-10", kind: "note", body: "Agreed.", needs_decision: false, parent_id: null });
  });

  it("needs a period on an account or a register month", () => {
    expect(t.entryInput({ subject_kind: "account", subject_key: ACC, body: "x" }).issues).toContain("an account thread needs its period");
  });

  it("refuses an empty entry, a finding from a person, and a reply that waits on a decision", () => {
    const base = { subject_kind: "asset", subject_key: ID };
    expect(t.entryInput({ ...base, body: " " }).issues).toContain("say something: the entry is empty");
    expect(t.entryInput({ ...base, body: "x", kind: "finding" }).issues).toContain("only an agent records a finding");
    expect(t.entryInput({ ...base, body: "x", kind: "finding" }, { kind: "agent", agent: "fm1" }).issues).toEqual([]);
    expect(t.entryInput({ ...base, body: "x", parent_id: ID, needs_decision: true }).issues[0]).toMatch(/a reply cannot itself wait/);
    expect(t.entryInput({ ...base, body: "x", kind: "decision", needs_decision: true }).issues).toContain("a decision does not wait on one");
  });
});

describe("what still waits", () => {
  const e = (id, over) => ({ id, parent_id: null, kind: "question", needs_decision: true, created_at: "2026-11-18T10:00:00Z", author_email: "jo@example.com", ...over });
  it("an entry needing a decision is open until a decision answers it", () => {
    const entries = [e("a"), e("b"), e("c", { needs_decision: false }), e("r1", { parent_id: "a", kind: "note", needs_decision: false }),
      e("r2", { parent_id: "b", kind: "decision", needs_decision: false })];
    expect([...t.openIds(entries)]).toEqual(["a"]);
  });

  it("shapes threads: open first, replies under their entry, agents with initials and on whose behalf", () => {
    const people = new Map([["jo@example.com", { initials: "JB", display_name: "Jo Bloggs" }], ["fm1@agents.stza.io", { initials: "FM1", display_name: "FM1" }]]);
    const entries = [
      e("old", { needs_decision: false, kind: "note", created_at: "2026-11-01T00:00:00Z" }),
      e("q", { via_agent: "fm1", via_run_id: ID, created_at: "2026-11-02T00:00:00Z" }),
      e("r", { parent_id: "q", kind: "note", needs_decision: false, created_at: "2026-11-03T00:00:00Z" }),
    ];
    const s = t.shape(entries, people);
    expect(s.map((x) => x.id)).toEqual(["q", "old"]);
    expect(s[0]).toMatchObject({ open: true, by: { initials: "FM1", name: "FM1, for Jo Bloggs", on_behalf_of: "JB" } });
    expect(s[0].replies.map((x) => x.id)).toEqual(["r"]);
    expect(s[0].replies[0].by.initials).toBe("JB");
  });
});

describe("profiles", () => {
  it("makes initials from a name", () => {
    expect(t.initialsOf("Jo Bloggs")).toBe("JB");
    expect(t.initialsOf("Jo van der Bloggs")).toBe("JB");
    expect(t.initialsOf("Jo")).toBe("JO");
    expect(t.initialsOf("", "jo@example.com")).toBe("JO");
  });

  it("cleans a profile change", () => {
    expect(t.profileInput({ display_name: "Jo Bloggs" })).toEqual({ issues: [], profile: { display_name: "Jo Bloggs", initials: "JB", title: null } });
    expect(t.profileInput({ display_name: "Jo Bloggs", initials: "jb1" }).profile.initials).toBe("JB1");
    expect(t.profileInput({ display_name: "", initials: "TOOLONG" }).issues).toEqual(["a display name is required", "initials are 1 to 4 letters or digits"]);
  });
});
