import { describe, expect, it } from "vitest";
import {
  classify,
  classifyWithoutConfig,
  compareAmounts,
  parseRoutingConfig,
  RoutingConfigError,
  type RoutingConfig,
} from "./routing.ts";

const config: RoutingConfig = {
  version: 1,
  currency: "GBP",
  clientThreshold: "25000.00",
  trivialDifference: "50.00",
  typeRules: {
    ap: { class: "mechanical", threshold: "25000.00" },
    ar: { class: "mechanical", threshold: "25000.00" },
    reconciliation: { class: "mechanical", threshold: null },
    vat: { class: "mechanical", threshold: "5000.00" },
    "month-end": { class: "judgement" },
    tax: { class: "judgement" },
    fpa: { class: "judgement" },
  },
};

describe("compareAmounts", () => {
  it("compares without going through a float", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in floating point. The whole reason
    // amounts stay as strings is that a rounding error at the threshold decides
    // whether a human reads the item.
    expect(compareAmounts("0.30", "0.3")).toBe(0);
    expect(compareAmounts("4999.99", "5000.00")).toBe(-1);
    expect(compareAmounts("5000.00", "5000.00")).toBe(0);
    expect(compareAmounts("5000.01", "5000.00")).toBe(1);
  });

  it("handles differing decimal places and negatives", () => {
    expect(compareAmounts("10", "10.000")).toBe(0);
    expect(compareAmounts("-100.00", "50.00")).toBe(-1);
    expect(compareAmounts("2.5", "2.45")).toBe(1);
  });

  it("refuses anything that is not a decimal", () => {
    expect(() => compareAmounts("£1,000", "500")).toThrow(RoutingConfigError);
  });
});

describe("classify", () => {
  it("batches a small mechanical item", () => {
    const r = classify({ type: "ap", amountTotal: "8940.12" }, config);
    expect(r.class).toBe("mechanical");
    expect(r.reason).toContain("below");
  });

  it("escalates a mechanical item at the threshold", () => {
    // At, not merely above: the boundary belongs to the human.
    expect(classify({ type: "ap", amountTotal: "25000.00" }, config).class).toBe("judgement");
    expect(classify({ type: "ap", amountTotal: "24999.99" }, config).class).toBe("mechanical");
  });

  it("applies the lower threshold to systemic classes", () => {
    // A VAT return at 18,420 batches under the client threshold but not under
    // VAT's own, because error there is systemic rather than isolated.
    expect(classify({ type: "vat", amountTotal: "18420.50" }, config).class).toBe("judgement");
    expect(classify({ type: "ap", amountTotal: "18420.50" }, config).class).toBe("mechanical");
  });

  it("keeps judgement types individual whatever the amount", () => {
    expect(classify({ type: "month-end", amountTotal: "1.00" }, config).class).toBe("judgement");
    expect(classify({ type: "tax", amountTotal: null }, config).class).toBe("judgement");
  });

  it("escalates an item with no amount", () => {
    // A batch attestation states a population and a total. Something that
    // cannot be sized cannot honestly sit inside one.
    const r = classify({ type: "ap", amountTotal: null }, config);
    expect(r.class).toBe("judgement");
    expect(r.reason).toContain("cannot be sized");
  });

  it("escalates a type with no rule", () => {
    // Adding a work type should force a routing decision rather than
    // inheriting batch treatment by silence.
    const r = classify({ type: "payroll", amountTotal: "10.00" }, config);
    expect(r.class).toBe("judgement");
    expect(r.reason).toContain("no routing rule");
  });

  it("batches an unsized mechanical type only where no amount gate applies", () => {
    // reconciliation carries no amount, and its rule says so explicitly rather
    // than leaving it to fall through the null-amount guard.
    expect(classify({ type: "reconciliation", amountTotal: "0.00" }, config).class).toBe(
      "mechanical"
    );
    expect(classify({ type: "reconciliation", amountTotal: null }, config).class).toBe("judgement");
  });

  it("degrades to more human attention when a client has no config", () => {
    const r = classifyWithoutConfig({ type: "ap" });
    expect(r.class).toBe("judgement");
  });
});

describe("parseRoutingConfig", () => {
  it("reads a valid config", () => {
    const c = parseRoutingConfig(JSON.stringify(config));
    expect(c.clientThreshold).toBe("25000.00");
    expect(c.typeRules.vat.threshold).toBe("5000.00");
  });

  it("refuses a config with an unrecognised class", () => {
    const bad = { ...config, typeRules: { ap: { class: "routine" } } };
    expect(() => parseRoutingConfig(JSON.stringify(bad))).toThrow(/expected mechanical or judgement/);
  });

  it("refuses a config with no threshold", () => {
    expect(() => parseRoutingConfig(JSON.stringify({ typeRules: {} }))).toThrow(
      /no clientThreshold/
    );
  });
});
