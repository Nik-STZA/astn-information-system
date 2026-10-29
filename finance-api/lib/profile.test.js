import { describe, expect, it } from "vitest";
import { companyChanges, groupChanges, ancestors, tree, profileIssues, vatPosition, agentView, vatNumber, retireIssues, FRAMEWORKS, FRAMEWORK_NOTES } from "./profile";

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const holdco = { id: id(1), slug: "acme-holdings", name: "Acme Holdings", parent_id: null, reporting_framework: "FRS 102", country_of_incorporation: "GB", in_vat_group: true, vat_number: null, ownership_pct: null, connected: true };
const opco = { id: id(2), slug: "acme-trading", name: "Acme Trading", parent_id: id(1), reporting_framework: "FRS 102", country_of_incorporation: "GB", in_vat_group: true, vat_number: null, ownership_pct: "100.000", connected: true };
const sub = { id: id(3), slug: "acme-za", name: "Acme ZA", parent_id: id(2), reporting_framework: "IFRS", country_of_incorporation: "ZA", in_vat_group: false, vat_number: "4000000000", ownership_pct: "75.000", connected: false };
const companies = [holdco, opco, sub];
const group = { vat_group: true, vat_group_number: "GB000000000", vat_group_representative_id: id(1) };

describe("company changes", () => {
  it("accepts the profile fields and tidies them", () => {
    const { set, issues } = companyChanges({
      company_number: " 01234567 ", country_of_incorporation: "gb", vat_number: "gb 123 4567 89",
      reporting_framework: "FRS 102 Section 1A", ownership_pct: "60", in_vat_group: true, year_end: "2026-12-31",
    }, opco, companies);
    expect(issues).toEqual([]);
    expect(set).toEqual({
      company_number: "01234567", country_of_incorporation: "GB", vat_number: "GB123456789",
      reporting_framework: "FRS 102 Section 1A", ownership_pct: 60, in_vat_group: true, year_end: "2026-12-31",
    });
  });

  it("refuses values an agent could misread", () => {
    const { issues } = companyChanges({ country_of_incorporation: "United Kingdom", reporting_framework: "UK GAAP", ownership_pct: 120, year_end: "31/12/2026", in_vat_group: "yes" }, opco, companies);
    expect(issues).toHaveLength(5);
    expect(issues[0]).toMatch(/two-letter code/);
    expect(issues[1]).toMatch(/Reporting standard must be one of/);
  });

  it("needs a name for a new company", () => {
    expect(companyChanges({ legal_name: "Acme Ltd" }, null, companies).issues).toEqual(["A company needs a name."]);
    expect(companyChanges({ name: "  " }, opco, companies).issues).toEqual(["A company needs a name."]);
  });

  it("keeps the structure a tree", () => {
    expect(companyChanges({ parent_id: id(2) }, opco, companies).issues[0]).toMatch(/own parent/);
    // Acme Holdings under its own grandchild would make a loop.
    expect(companyChanges({ parent_id: id(3) }, holdco, companies).issues[0]).toMatch(/already owned/);
    expect(companyChanges({ parent_id: id(9) }, opco, companies).issues[0]).toMatch(/another company of this client/);
    expect(companyChanges({ parent_id: "" }, opco, companies).set).toEqual({ parent_id: null });
    expect(ancestors(id(3), companies)).toEqual([id(2), id(1)]);
  });
});

describe("the group", () => {
  it("checks the representative is a member company", () => {
    expect(groupChanges({ vat_group: true, vat_group_number: "gb 000 0000 00", vat_group_representative_id: id(1) }, companies))
      .toEqual({ set: { vat_group: true, vat_group_number: "GB000000000", vat_group_representative_id: id(1) }, issues: [] });
    expect(groupChanges({ vat_group_representative_id: id(9) }, companies).issues).toHaveLength(1);
  });

  it("orders companies parent first", () => {
    expect(tree([sub, opco, holdco]).map((c) => [c.name, c.depth])).toEqual([["Acme Holdings", 0], ["Acme Trading", 1], ["Acme ZA", 2]]);
  });

  it("names the gaps without refusing to save", () => {
    const issues = profileIssues({ vat_group: true }, [
      { ...holdco, reporting_framework: null }, { ...opco, parent_id: null, vat_number: "GB999999999" }, { ...sub, in_vat_group: true },
    ]);
    expect(issues.join("\n")).toMatch(/No single parent company/);
    expect(issues.join("\n")).toMatch(/Acme Holdings: no reporting standard/);
    expect(issues.join("\n")).toMatch(/no registration number/);
    expect(issues.join("\n")).toMatch(/no representative member/);
    expect(issues.join("\n")).toMatch(/different standards/);
  });

  it("flags a representative member that is not a member", () => {
    expect(profileIssues(group, [{ ...holdco, in_vat_group: false }, opco])).toContain("Acme Holdings is the VAT group's representative member but is not ticked as a member.");
  });

  it("flags a VAT tick with no VAT group", () => {
    expect(profileIssues({ vat_group: false }, [opco])).toContain("Acme Trading is ticked as in the VAT group, but the group has no VAT group registration.");
  });
});

describe("what an agent reads", () => {
  it("states each company's VAT position in words", () => {
    expect(vatPosition(holdco, group)).toBe("Member of the VAT group GB000000000 (representative member).");
    expect(vatPosition(sub, group)).toBe("Registered on its own, VAT number 4000000000.");
    expect(vatPosition({ ...sub, vat_number: null }, group)).toMatch(/Check get_organisation/);
  });

  it("gives the structure, the standard and what the standard decides", () => {
    const v = agentView({ name: "Acme", legal_name: "Acme Holdings Ltd" }, group, companies);
    expect(v.vat_group).toEqual({ number: "GB000000000", representative: "Acme Holdings", members: ["Acme Holdings", "Acme Trading"] });
    expect(v.companies[2]).toMatchObject({ name: "Acme ZA", parent: "Acme Trading", ownership_pct: 75, reporting_framework: "IFRS", connected_to_xero: false });
    expect(v.companies[2].framework_note).toMatch(/expected credit loss/);
    expect(v.gaps).toContain("The companies report under different standards (FRS 102, IFRS). Consolidation adjustments may be needed.");
  });

  it("has a note for every standard", () => {
    for (const f of FRAMEWORKS) expect(FRAMEWORK_NOTES[f], f).toBeTruthy();
  });
});

describe("VAT numbers in one form", () => {
  it("gives a UK number its GB prefix, and leaves others as given", () => {
    expect(vatNumber("000 0000 00", true)).toBe("GB000000000");
    expect(vatNumber("gb000000000", true)).toBe("GB000000000");
    expect(vatNumber("4000000000", false)).toBe("4000000000");
    expect(vatNumber("000000000", false)).toBe("000000000");
    expect(companyChanges({ vat_number: "000000000" }, opco, companies).set.vat_number).toBe("GB000000000");
    expect(groupChanges({ vat_group_number: "000000000" }, companies).set.vat_group_number).toBe("GB000000000");
  });

  it("reads a number saved without the prefix the same as one saved with it", () => {
    const v = agentView({ name: "Acme" }, { ...group, vat_group_number: "000000000" }, companies);
    expect(v.vat_group.number).toBe("GB000000000");
    expect(profileIssues({ ...group, vat_group_number: "000000000" }, [{ ...opco, vat_number: "GB000000000" }, holdco])).toEqual([]);
  });
});

describe("the profile over time", () => {
  it("names the likely parent when several companies have none", () => {
    const issues = profileIssues({ vat_group: false }, [{ ...holdco, in_vat_group: false }, { ...opco, parent_id: null, in_vat_group: false }, { ...sub, parent_id: id(1) }]);
    expect(issues[0]).toBe("No single parent company: Acme Holdings and Acme Trading have no parent recorded. The group's parent needs none; if Acme Holdings owns Acme Trading, set its parent to Acme Holdings.");
  });

  it("tells the agent when a person last changed it", () => {
    expect(agentView({ name: "Acme" }, group, companies, "2026-10-29T15:35:00Z").profile_last_changed).toBe("2026-10-29T15:35:00Z");
  });
});

describe("retiring a company", () => {
  it("refuses while it is connected, owns another, or represents the VAT group", () => {
    expect(retireIssues(holdco, companies, group)).toEqual([
      "Acme Holdings is connected to Xero. Disconnect it on the Finance set-up before retiring it.",
      "Acme Holdings owns Acme Trading. Give it another parent first.",
      "Acme Holdings is the VAT group's representative member. Choose another first.",
    ]);
    expect(retireIssues({ ...sub, connected: false }, companies, group)).toEqual([]);
  });
});
