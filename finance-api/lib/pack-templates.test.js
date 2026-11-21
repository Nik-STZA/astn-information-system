import { describe, expect, it } from "vitest";

const { TEMPLATES, TEMPLATE_KEYS, DEFAULT_TEMPLATE, SUBTOTALS, templateRows, layoutOf, categoryForHeading, templateList } =
  require("./pack-templates");
const { effectiveCategories, validateCategory, PNL_SECTIONS } = require("./coa-mapping");

const standard = [
  { client_id: null, key: "turnover", label: "Turnover", statement: "pnl", section: "turnover", sort_order: 10, cash_flow: null, active: true },
  { client_id: null, key: "staff_costs", label: "Staff costs", statement: "pnl", section: "overheads", sort_order: 30, cash_flow: null, active: true },
  { client_id: null, key: "depreciation", label: "Depreciation and amortisation", statement: "pnl", section: "overheads", sort_order: 70, cash_flow: "non_cash", active: true },
];

describe("pack templates", () => {
  it("every template is valid: known sections, whole-number order, every subtotal labelled", () => {
    for (const key of TEMPLATE_KEYS) {
      const t = TEMPLATES[key];
      expect(t.key).toBe(key);
      expect(Object.keys(t.labels).sort()).toEqual([...SUBTOTALS].sort());
      for (const c of t.categories) {
        const { errors } = validateCategory(c.key, c);
        expect(errors, `${key}.${c.key}`).toEqual([]);
        expect(PNL_SECTIONS).toContain(c.section);
      }
      const keys = new Set(t.categories.map((c) => c.key));
      for (const cat of Object.keys(t.sublines)) {
        expect(keys.has(cat) || ["turnover", "cost_of_sales", "staff_costs", "professional_fees", "other_income"].includes(cat), `${key} sublines ${cat}`).toBe(true);
      }
    }
  });

  it("the default draws what the pack drew before templates", () => {
    expect(DEFAULT_TEMPLATE).toBe("standard_management");
    const l = layoutOf("standard_management");
    expect(l.ebitda).toBe(true);
    expect(l.labels.total_overheads).toBe("Total overheads");
    expect(l.labels.net_profit).toBe("Profit for the financial period");
    expect(templateRows("standard_management")).toEqual([]);
  });

  it("an unknown template falls back to the default", () => {
    expect(layoutOf("nope").template).toBe("standard_management");
  });

  it("Feldspar draws impairment and FX below EBITDA; the standard templates leave it to non-cash", () => {
    expect(layoutOf("feldspar_management").belowEbitda).toEqual(["depreciation", "impairment", "fx", "penalties_fines"]);
    expect(layoutOf("standard_management").belowEbitda).toBeNull();
    const rows = Object.fromEntries(templateRows("feldspar_management").map((r) => [r.key, r]));
    expect(rows.impairment).toMatchObject({ cash_flow: "non_cash", section: "overheads" });
    expect(rows.fx.cash_flow).toBeNull();   // realised FX is cash
  });

  it("every below-EBITDA line is an overhead the template can draw", () => {
    for (const key of TEMPLATE_KEYS) {
      const t = TEMPLATES[key];
      const overheads = new Set(["staff_costs", "establishment", "professional_fees", "administrative", "depreciation", "fx",
        ...t.categories.filter((c) => c.section === "overheads").map((c) => c.key)]);
      for (const k of t.belowEbitda ?? []) expect(overheads.has(k), `${key}: ${k}`).toBe(true);
    }
  });

  it("statutory has no EBITDA", () => {
    expect(layoutOf("standard_statutory").ebitda).toBe(false);
  });

  it("template lines sit between the standard set and the client's own", () => {
    const own = { client_id: "c1", key: "staff_costs", label: "People", statement: "pnl", section: "overheads", sort_order: 31, cash_flow: null, active: true };
    const cats = effectiveCategories([...standard, ...templateRows("feldspar_management"), own]);
    expect(cats.get("turnover")).toMatchObject({ label: "Revenue", scope: "template" });
    expect(cats.get("marketing")).toMatchObject({ label: "Marketing", scope: "template" });
    expect(cats.get("staff_costs")).toMatchObject({ label: "People", scope: "override" });
    expect(cats.get("depreciation")).toMatchObject({ scope: "standard", cashFlow: "non_cash" });
    // Order follows sort order across all three layers.
    const order = [...cats.keys()];
    expect(order.indexOf("marketing")).toBeLessThan(order.indexOf("staff_costs"));
    expect(order.indexOf("capitalised_dev")).toBeLessThan(order.indexOf("depreciation"));
  });

  it("reads a master file's headings, ignoring case and spacing, and never guesses", () => {
    expect(categoryForHeading("feldspar_management", "IT Costs")).toBe("it_costs");
    expect(categoryForHeading("feldspar_management", "  it   costs ")).toBe("it_costs");
    expect(categoryForHeading("feldspar_management", "Amortisation")).toBe("depreciation");
    expect(categoryForHeading("feldspar_management", "Rounding")).toBeNull();   // a balance sheet account
    expect(categoryForHeading("feldspar_management", "Impairment")).toBe("impairment");
    expect(categoryForHeading("feldspar_management", "Penalties and Fines")).toBe("penalties_fines");
    expect(categoryForHeading("feldspar_management", "Exceptional items")).toBeNull();
    expect(categoryForHeading("standard_management", "Revenue")).toBe("turnover");
    expect(categoryForHeading("standard_management", "")).toBeNull();
  });

  it("every heading points at a line the template has", () => {
    const stdKeys = ["turnover", "cost_of_sales", "staff_costs", "establishment", "professional_fees", "administrative",
      "depreciation", "fx", "other_income", "interest_payable", "taxation"];
    for (const key of TEMPLATE_KEYS) {
      const have = new Set([...stdKeys, ...TEMPLATES[key].categories.map((c) => c.key)]);
      for (const [h, cat] of Object.entries(TEMPLATES[key].headings)) expect(have.has(cat), `${key}: ${h} -> ${cat}`).toBe(true);
    }
  });

  it("lists the templates for the picker", () => {
    expect(templateList().map((t) => t.key)).toEqual(TEMPLATE_KEYS);
  });
});
