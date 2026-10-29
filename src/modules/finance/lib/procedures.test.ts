import { describe, expect, it } from "vitest";
import { ownProcedures, procedureName, ruleNote, type ClientRule } from "./procedures";

const rule = (x: Partial<ClientRule>): ClientRule => ({
  id: "r", procedure: "bills-coding", kind: "addition", title: null, summary: null, body: "x", roles: null, version: 1,
  status: "approved", created_by: "jo@example.com", created_at: "2026-10-29", updated_at: "2026-10-29", approved_by: null, approved_at: null, ...x,
});

describe("what a procedure's row says", () => {
  it("shows nothing when the client has no live rules", () => {
    expect(ruleNote([])).toBeNull();
    expect(ruleNote([rule({ status: "retired" })])).toBeNull();
  });
  it("says when rules are approved, in draft, or replace the standard", () => {
    expect(ruleNote([rule({})])).toEqual({ text: "Client rules", pill: "s-green" });
    expect(ruleNote([rule({ status: "draft" })])).toEqual({ text: "Client rules in draft", pill: "s-amber" });
    expect(ruleNote([rule({ kind: "replacement" }), rule({ status: "draft" })])).toEqual({ text: "Replaced for this client · 1 draft", pill: "s-amber" });
  });
});

describe("the client's own procedures", () => {
  it("lists each once, by title, from its live version", () => {
    const list = ownProcedures([
      rule({ kind: "own", procedure: "stock-count", title: "Stock count v1", status: "retired" }),
      rule({ kind: "own", procedure: "stock-count", title: "Stock count", status: "draft" }),
      rule({ kind: "own", procedure: "grant-claim", title: "Grant claim" }),
      rule({}),
    ]);
    expect(list.map((p) => [p.name, p.title, p.rules.length])).toEqual([["grant-claim", "Grant claim", 1], ["stock-count", "Stock count", 2]]);
  });
  it("names a procedure from its title", () => {
    expect(procedureName("Stock count (year end)")).toBe("stock-count-year-end");
    expect(procedureName("  Café float  ")).toBe("cafe-float");
  });
});
