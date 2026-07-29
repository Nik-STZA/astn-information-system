import { describe, expect, it } from "vitest";
import { enabledModules, isModuleEnabled } from "@/shared/config/features";

// FEATURES is what makes the Finance module extractable, so its edge cases are
// worth pinning: getting this wrong either exposes a module that should be
// hidden, or hides the whole platform.

describe("enabledModules", () => {
  it("parses a full list", () => {
    expect(enabledModules("registry,compliance,publishing,finance")).toEqual([
      "registry",
      "compliance",
      "publishing",
      "finance",
    ]);
  });

  it("supports the extraction target of finance alone", () => {
    expect(enabledModules("finance")).toEqual(["finance"]);
  });

  // An environment that predates the flag must keep working exactly as it did,
  // which means the three original modules and no Finance.
  it("falls back to the pre-flag modules when unset", () => {
    expect(enabledModules(undefined)).toEqual(["registry", "compliance", "publishing"]);
    expect(enabledModules(undefined)).not.toContain("finance");
  });

  // Empty is a deliberate choice, not a missing variable, so it is honoured.
  it("treats an empty value as nothing enabled", () => {
    expect(enabledModules("")).toEqual([]);
  });

  it("tolerates whitespace and casing", () => {
    expect(enabledModules(" Finance , REGISTRY ")).toEqual(["registry", "finance"]);
  });

  // Deployment tooling treats a comma inside an environment value as its own
  // delimiter. That once reduced FEATURES to "registry" in production and hid
  // three live modules, so space separation is what the workflow now writes
  // and both forms must parse identically.
  it("accepts space separation as well as commas", () => {
    const expected = ["registry", "compliance", "publishing", "finance"];
    expect(enabledModules("registry compliance publishing finance")).toEqual(expected);
    expect(enabledModules("registry,compliance,publishing,finance")).toEqual(expected);
    expect(enabledModules("registry, compliance;publishing  finance")).toEqual(expected);
  });

  it("ignores unknown names rather than trusting them", () => {
    expect(enabledModules("finance,payroll,nonsense")).toEqual(["finance"]);
  });

  it("returns modules in a stable order regardless of input order", () => {
    expect(enabledModules("finance,registry")).toEqual(["registry", "finance"]);
    expect(enabledModules("registry,finance")).toEqual(["registry", "finance"]);
  });

  it("deduplicates", () => {
    expect(enabledModules("finance,finance")).toEqual(["finance"]);
  });
});

describe("isModuleEnabled", () => {
  it("reports membership", () => {
    expect(isModuleEnabled("finance", "finance")).toBe(true);
    expect(isModuleEnabled("registry", "finance")).toBe(false);
  });

  it("hides the AfricanSTN modules under the extraction target", () => {
    for (const m of ["registry", "compliance", "publishing"] as const) {
      expect(isModuleEnabled(m, "finance")).toBe(false);
    }
  });
});
