import { describe, it, expect } from "vitest";
import { GROUPINGS, LIFECYCLES, isGrouping, templateFor, enableIssues, placementIssue, policyIssues } from "./asset-groupings";
import { LINES } from "./bs-matrix";

describe("asset groupings catalogue", () => {
  it("holds the four first groupings, each on a real matrix line, with a lifecycle and both templates", () => {
    expect(Object.keys(GROUPINGS)).toEqual(["dev_project", "software_internal", "ip_registered", "tangible_build"]);
    const lines = new Set(LINES.map((l) => l.key));
    for (const g of Object.values(GROUPINGS)) {
      expect(lines.has(g.line)).toBe(true);
      expect(LIFECYCLES[g.key].length).toBeGreaterThan(1);
      expect(Object.keys(g.templates).sort()).toEqual(["FRS 102", "IFRS"]);
      expect(g.proof.length).toBeGreaterThan(0);
      expect(g.evidence.length).toBeGreaterThan(0);
    }
    expect(isGrouping("goodwill")).toBe(false);
  });

  it("gives every IP class a treatment and a reason with its basis", () => {
    for (const c of Object.values(GROUPINGS.ip_registered.classes)) {
      expect(c.treatment).toBeTruthy();
      expect(c.refs.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("framework templates", () => {
  it("maps FRS 102 Section 1A to FRS 102 and IFRS to IFRS", () => {
    expect(templateFor("dev_project", "FRS 102").framework).toBe("FRS 102");
    expect(templateFor("dev_project", "FRS 102 Section 1A").framework).toBe("FRS 102");
    expect(templateFor("dev_project", "IFRS").framework).toBe("IFRS");
  });

  it("refuses, with the reason, rather than falling back", () => {
    for (const fw of ["FRS 105", "IFRS for SMEs", "US GAAP", "Other", null, ""]) {
      const t = templateFor("dev_project", fw);
      expect(t.template).toBeUndefined();
      expect(t.refused).toMatch(/\w/);
    }
    expect(templateFor("dev_project", null).refused).toMatch(/no reporting standard/);
    expect(templateFor("goodwill", "FRS 102").refused).toMatch(/No grouping/);
  });

  it("refuses to switch a grouping on for any company without a template", () => {
    const issues = enableIssues("ip_registered", [
      { name: "Jo Bloggs Ltd", reporting_framework: "FRS 102" },
      { name: "Jo Bloggs Micro", reporting_framework: "FRS 105" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Jo Bloggs Micro: FRS 105/);
  });
});

describe("placement and policy", () => {
  it("reports an account placed off the grouping's line, or not placed, and never assumes", () => {
    expect(placementIssue("dev_project", { name: "Software (WIP)", line_key: "ppe" })).toMatch(/placed on ppe; .* expects intangible/);
    expect(placementIssue("dev_project", { name: "Software (WIP)", line_key: null })).toMatch(/not placed/);
    expect(placementIssue("dev_project", { name: "Extreme Track", line_key: "intangible" })).toBeNull();
    expect(placementIssue("tangible_build", { name: "Performance Bundle - WIP", line_key: "ppe" })).toBeNull();
  });

  it("allows an indefinite life only where IFRS allows it", () => {
    expect(policyIssues("ip_registered", { life_kind: "indefinite" }, "FRS 102").issues[0]).toMatch(/not allowed under FRS 102/);
    expect(policyIssues("ip_registered", { life_kind: "indefinite" }, "IFRS").issues).toEqual([]);
    expect(policyIssues("dev_project", { life_kind: "indefinite" }, "IFRS").issues[0]).toMatch(/not allowed under IFRS/);
    expect(policyIssues("dev_project", { life_kind: "finite", life_months: 0 }, "FRS 102").issues[0]).toMatch(/whole number of months/);
  });

  it("finds a policy citing another framework than its company's (Flag 3)", () => {
    const p = { life_kind: "finite", life_months: 120, standard_refs: ["IAS 38.97"] };
    const out = policyIssues("dev_project", p, "FRS 102");
    expect(out.issues).toEqual([]);
    expect(out.findings.join(" ")).toMatch(/cites IAS 38.97 while the company reports under FRS 102/);
    expect(policyIssues("dev_project", { ...p, life_months: 150, standard_refs: [] }, "FRS 102").findings[0]).toMatch(/s18.20/);
  });
});
