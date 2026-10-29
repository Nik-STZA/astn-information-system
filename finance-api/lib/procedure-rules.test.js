import { describe, expect, it } from "vitest";
import { ruleChanges, rolesFor, standardList } from "./procedure-rules";
import { library } from "./agent-procedures";

const lib = library();
const approved = {
  id: "00000000-0000-4000-8000-000000000001", procedure: "bills-coding", kind: "addition", title: null, summary: null,
  body: "Code subscriptions to Software.", roles: null, version: 2, status: "approved", approved_by: "jo@example.com", approved_at: "2026-10-29",
};

describe("writing a client rule", () => {
  it("drafts an addition to a standard procedure", () => {
    expect(ruleChanges({ procedure: "bills-coding", kind: "addition", body: "  Code subscriptions to Software.  " }, null, lib))
      .toEqual({ set: { procedure: "bills-coding", kind: "addition", body: "Code subscriptions to Software." }, issues: [] });
  });

  it("refuses rules an agent could not use", () => {
    expect(ruleChanges({ procedure: "Stock Count", kind: "own", body: "x" }, null, lib).issues[0]).toMatch(/lower case with hyphens/);
    expect(ruleChanges({ procedure: "stock-count", kind: "addition", body: "x" }, null, lib).issues).toEqual(["There is no standard procedure stock-count to add to."]);
    expect(ruleChanges({ procedure: "vat-return", kind: "own", title: "VAT", body: "x" }, null, lib).issues[0]).toMatch(/is a standard procedure/);
    expect(ruleChanges({ procedure: "stock-count", kind: "own", body: "x" }, null, lib).issues).toEqual(["A client's own procedure needs a title."]);
    expect(ruleChanges({ procedure: "bills-coding", kind: "addition" }, null, lib).issues).toEqual(["The rule needs its text."]);
  });

  it("never lets a client set the practice controls aside", () => {
    expect(ruleChanges({ procedure: "practice-controls", kind: "replacement", body: "x" }, null, lib).issues[0]).toMatch(/cannot be replaced/);
    expect(ruleChanges({ procedure: "practice-controls", kind: "addition", body: "Two approvers over 1,000." }, null, lib).issues).toEqual([]);
  });

  it("names roles only on the client's own procedure", () => {
    expect(ruleChanges({ procedure: "stock-count", kind: "own", title: "Stock count", body: "x", roles: ["fm1", "fm1"] }, null, lib).set.roles).toEqual(["fm1"]);
    expect(ruleChanges({ procedure: "stock-count", kind: "own", title: "Stock count", body: "x", roles: ["cfo"] }, null, lib).issues[0]).toMatch(/Roles must be among/);
    expect(ruleChanges({ procedure: "bills-coding", kind: "addition", body: "x", roles: ["fm1"] }, null, lib).issues[0]).toMatch(/Only a client's own procedure/);
  });
});

describe("changing a rule", () => {
  it("sends changed words on an approved rule back for approval, at the next version", () => {
    expect(ruleChanges({ body: "Code subscriptions to Software, and SaaS to Software." }, approved, lib).set).toEqual({
      body: "Code subscriptions to Software, and SaaS to Software.", status: "draft", version: 3, approved_by: null, approved_at: null,
    });
  });

  it("leaves an approved rule approved when nothing changed", () => {
    expect(ruleChanges({ body: "Code subscriptions to Software." }, approved, lib).set).toEqual({ body: "Code subscriptions to Software." });
  });

  it("keeps the procedure and kind fixed, and a retired rule closed", () => {
    expect(ruleChanges({ procedure: "vat-return", kind: "own", body: "x" }, { ...approved, status: "draft" }, lib).set).toEqual({ body: "x" });
    expect(ruleChanges({ body: "x" }, { ...approved, status: "retired" }, lib).issues[0]).toMatch(/retired rule cannot be changed/);
  });
});

describe("the standard set as people browse it", () => {
  it("puts the always-loaded controls first and says who opens each", () => {
    const list = standardList(lib);
    expect(list.slice(0, 2).every((p) => p.always_loaded)).toBe(true);
    expect(rolesFor("practice-controls", lib)).toHaveLength(Object.keys(lib.roles).length);
    expect(rolesFor("vat-return", lib)).toContain("fm1");
    expect(rolesFor("bills-coding", lib)).toContain("ap-clerk");
  });
});
